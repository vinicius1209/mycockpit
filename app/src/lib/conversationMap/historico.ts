// O histórico de pedidos da aba Conversa (mock `docs/mocks/aba-conversa.html`,
// rev. 2, aprovado em 23/09/2026).
//
// A aba era desenhada em torno de um resumo automático que quase nunca
// funcionava (modelo local recusava a entrada em conversa de tamanho real), e o
// que sobrava era o PRIMEIRO pedido, fixo para sempre, e um "Turno concluído"
// sem conteúdo. O esqueleto agora é FATO, e fato já está no fio: pedido,
// desfecho, duração, custo (ou modelo, quando o motor não reporta custo),
// ações, arquivos, commits, imagens e o plano que aquele pedido criou. Nada
// daqui depende de inferência, então nada daqui fica "indisponível".
//
// Puro e com `now` injetável: o componente só decide a tipografia.

import {
  RESUME_REASON_LIMIT,
  RESUME_REASON_LIMIT_SEM_RESET,
  RESUME_REASON_TEXT,
  resumePrompt,
} from "@/lib/autoResume"
import { briefExcerpt } from "@/lib/conversationBrief"
import { taskPlansOf, type AgentPlan } from "@/lib/tasks"
import { classificarAcao } from "@/lib/acaoDoFio"
import type { CostSource } from "@/lib/agent"
import type { ChatItem } from "@/store/chat"

export type EstadoDoPedido =
  | "rodando"
  | "concluido"
  | "erro"
  | "interrompido"
  | "limite"
  | "sem-desfecho"

export interface PedidoDoFio {
  /** id do item `user` que abriu o pedido (é o alvo do "ver no fio"). */
  id: string
  texto: string
  /** O texto é do app (retomada automática), não seu (ADR-250). */
  retomada: boolean
  ts: number | null
  estado: EstadoDoPedido
  duracaoMs: number | null
  custoUsd: number | null
  custoFonte: CostSource | null
  /** O que rodou, para o motor que não reporta custo (o fio faz igual). */
  modelo: string | null
  acoes: number
  arquivos: number
  commits: number
  imagens: number
  processos: number
  /** Primeira linha do que o agente respondeu, quando respondeu. */
  resposta: string | null
  /** Plano publicado DENTRO deste pedido (o antigo mora no turno dele). */
  plano: AgentPlan | null
}

export interface HistoricoDePedidos {
  /** Do mais novo para o mais velho: é um log de decisão, lido do fim. */
  pedidos: PedidoDoFio[]
  rodando: number
  /** Soma só quando TODO pedido encerrado tem custo: somar parte seria
   *  mostrar um total que parece completo e não é. */
  custoTotalUsd: number | null
  custoTotalEstimado: boolean
  duracaoTotalMs: number
}

const TERMINAIS = new Set(["result", "error", "cancelled", "limit"])

function estadoDoTerminal(item: ChatItem): EstadoDoPedido {
  switch (item.kind) {
    case "result":
      return item.ok ? "concluido" : "erro"
    case "cancelled":
      return "interrompido"
    case "limit":
      return "limite"
    default:
      return "erro"
  }
}

function primeiraLinha(texto: string | undefined | null): string | null {
  const linha = texto?.split("\n").map((l) => l.trim()).find(Boolean)
  return linha ? briefExcerpt(linha) : null
}

/** Os textos que a retomada automática manda, na fonte única deles. */
const TEXTOS_DE_RETOMADA = new Set(
  [RESUME_REASON_LIMIT, RESUME_REASON_LIMIT_SEM_RESET, RESUME_REASON_TEXT].map(resumePrompt),
)

/** A marca `retomada` nasce com a ADR-250. O histórico de antes dela só tem o
 *  texto, e ele é constante do app (`resumePrompt`), nunca digitado: igualdade
 *  EXATA com ele é fato, não palpite. */
export function ehRetomada(item: { text: string; retomada?: true }): boolean {
  return !!item.retomada || TEXTOS_DE_RETOMADA.has(item.text.trim())
}

export function historicoDePedidos(
  items: readonly ChatItem[],
  runtime: { running: boolean; finalizing: boolean },
  now = Date.now(),
): HistoricoDePedidos {
  const planos = taskPlansOf(items as ChatItem[]).plans
  const pedidos: PedidoDoFio[] = []
  let atual: { pedido: PedidoDoFio; ids: Set<string>; terminal: ChatItem | null; ultimoTs: number | null; arquivos: Set<string> } | null = null

  const fechar = () => {
    if (!atual) return
    const { pedido, ids, terminal } = atual
    pedido.plano = planos.filter((p) => ids.has(p.turnId)).at(-1) ?? null
    pedido.arquivos = atual.arquivos.size
    if (!terminal) {
      pedido.estado = "sem-desfecho"
    }
    // Relógio de parede do pedido (do envio ao terminal): é o "quanto levou".
    // A soma dos recibos contaria duas vezes o envelope parcial que alguns
    // motores fecham no meio; ela só responde quando falta carimbo.
    if (terminal && pedido.ts != null && terminal.ts != null) {
      pedido.duracaoMs = Math.max(0, terminal.ts - pedido.ts)
    }
    pedidos.push(pedido)
    atual = null
  }

  for (const item of items) {
    if (item.kind === "user" && !item.advisorTo) {
      fechar()
      atual = {
        pedido: {
          id: item.id,
          texto: item.text.trim(),
          retomada: ehRetomada(item),
          ts: item.ts ?? null,
          estado: "sem-desfecho",
          duracaoMs: null,
          custoUsd: null,
          custoFonte: null,
          modelo: null,
          acoes: 0,
          arquivos: 0,
          commits: 0,
          imagens: (item.attachments ?? []).filter((a) => a.kind === "image").length,
          processos: 0,
          resposta: null,
          plano: null,
        },
        ids: new Set([item.id]),
        terminal: null,
        ultimoTs: item.ts ?? null,
        arquivos: new Set(),
      }
      continue
    }
    if (!atual) continue
    atual.ids.add(item.id)
    if (item.ts != null) atual.ultimoTs = item.ts
    const { pedido } = atual
    if (item.kind === "tool") {
      pedido.acoes += 1
      const acao = classificarAcao(item)
      if (acao.caminho) atual.arquivos.add(acao.caminho)
      if (!item.result || item.result.ok) pedido.commits += acao.commitsNoComando
      if (item.managedProcess) pedido.processos += 1
    } else if (item.kind === "text") {
      pedido.resposta = primeiraLinha(item.text) ?? pedido.resposta
    } else if (item.kind === "result") {
      if (item.costUsd != null) {
        pedido.custoUsd = (pedido.custoUsd ?? 0) + item.costUsd
        pedido.custoFonte = pedido.custoFonte === "estimated" ? "estimated" : (item.costSource ?? null)
      }
      if (item.model) pedido.modelo = item.model
      if (item.durationMs != null) pedido.duracaoMs = (pedido.duracaoMs ?? 0) + item.durationMs
      if (!pedido.resposta && item.ok) pedido.resposta = primeiraLinha(item.text)
    }
    if (TERMINAIS.has(item.kind)) {
      atual.terminal = item
      pedido.estado = estadoDoTerminal(item)
    }
  }

  // O último pedido sem terminal é o que está rodando (se o motor estiver
  // vivo); sem processo vivo, é "sem desfecho", nunca "rodando" de teatro.
  if (atual) {
    const vivo = runtime.running || runtime.finalizing
    const aberto: { pedido: PedidoDoFio; terminal: ChatItem | null } = atual
    fechar()
    if (vivo && !aberto.terminal) {
      aberto.pedido.estado = "rodando"
      aberto.pedido.duracaoMs = aberto.pedido.ts != null ? Math.max(0, now - aberto.pedido.ts) : null
    }
  }

  pedidos.reverse()
  const encerrados = pedidos.filter((p) => p.estado !== "rodando" && p.estado !== "sem-desfecho")
  const todosComCusto = encerrados.length > 0 && encerrados.every((p) => p.custoUsd != null)
  return {
    pedidos,
    rodando: pedidos.filter((p) => p.estado === "rodando").length,
    custoTotalUsd: todosComCusto ? pedidos.reduce((soma, p) => soma + (p.custoUsd ?? 0), 0) : null,
    custoTotalEstimado: pedidos.some((p) => p.custoFonte === "estimated"),
    duracaoTotalMs: pedidos.reduce((soma, p) => soma + (p.duracaoMs ?? 0), 0),
  }
}
