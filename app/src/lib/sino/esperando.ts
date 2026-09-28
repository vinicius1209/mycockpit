// O que está PARADO esperando você agora, a primeira pergunta do sino
// (ADR-271).
//
// Derivado de estado vivo, nunca guardado: o item some quando você responde,
// onde quer que responda (conversa, Companion, terminal). O feed do sino é
// histórico e não serve pra isso, porque nada volta nele para dizer que o
// pedido acabou.
//
// A conta do selo é por CONVERSA, a régua da bandeja
// (`awaitingDecisionCount`): vinte pedidos na mesma conversa são uma espera
// só, e uma conversa com pedido e gate ao mesmo tempo também.

import type { Decision } from "@/lib/inbox"
import { decisionTs } from "@/lib/decisions"

export type TipoDePedido = "permissao" | "pergunta" | "plano" | "recurso"

/** Um pedido da fila de interações, já com os nomes resolvidos. */
export interface PedidoVivo {
  id: string
  tipo: TipoDePedido
  /** Conversa dona; null = sessão externa no terminal, que não tem conversa. */
  convId: string | null
  projectId: string
  convTitle: string
  projectName: string
  resumo: string
}

/** Missão pausada num gate ou numa recuperação. */
export interface MissaoParada {
  convId: string
  projectId: string
  convTitle: string
  projectName: string
  motivo: "gate" | "recuperacao"
  fase: string
}

export interface FerramentaBloqueada {
  agent: string
  label: string
}

interface Base {
  /** Chave estável da linha. */
  chave: string
  titulo: string
  meta: string
  /** Desde quando espera, quando há carimbo real. Sem carimbo, sem idade. */
  desde: number | null
}

export type Espera =
  | (Base & { tipo: "pedido"; convId: string | null; projectId: string; pedido: TipoDePedido })
  | (Base & { tipo: "missao"; convId: string; projectId: string })
  | (Base & { tipo: "decisao"; decisao: Decision })
  | (Base & { tipo: "ferramenta"; agent: string })

export interface EsperandoVoce {
  itens: Espera[]
  /** O número do selo. */
  total: number
}

const ROTULO_DO_PEDIDO: Record<TipoDePedido, string> = {
  permissao: "Permissão",
  pergunta: "Pergunta",
  plano: "Plano para aprovar",
  recurso: "Pedido",
}

export function esperandoVoce(o: {
  pedidos: PedidoVivo[]
  missoes: MissaoParada[]
  decisoes: Decision[]
  ferramentas: FerramentaBloqueada[]
  /** Desde quando a conversa espera: o carimbo do aviso guardado na chegada. */
  desdeDe?: (convId: string, motivo: "pedido" | "missao") => number | null
  now?: number
}): EsperandoVoce {
  const now = o.now ?? Date.now()
  const itens: Espera[] = []
  const unidades = new Set<string>()

  // Pedidos: uma linha por conversa, com o primeiro da fila (o que a conversa
  // mostra) e quantos vêm atrás dele.
  const porConversa = new Map<string, PedidoVivo[]>()
  for (const p of o.pedidos) {
    const chave = p.convId ? `conv:${p.convId}` : `pedido:${p.id}`
    const lista = porConversa.get(chave)
    if (lista) lista.push(p)
    else porConversa.set(chave, [p])
  }
  for (const [chave, lista] of porConversa) {
    const p = lista[0]
    const mais = lista.length > 1 ? ` (+${lista.length - 1})` : ""
    itens.push({
      tipo: "pedido",
      chave,
      convId: p.convId,
      projectId: p.projectId,
      pedido: p.tipo,
      titulo: p.convTitle,
      meta: juntar(`${ROTULO_DO_PEDIDO[p.tipo]} · ${p.resumo}${mais}`, p.projectName),
      desde: p.convId ? (o.desdeDe?.(p.convId, "pedido") ?? null) : null,
    })
    unidades.add(chave)
  }

  for (const m of o.missoes) {
    itens.push({
      tipo: "missao",
      chave: `missao:${m.convId}`,
      convId: m.convId,
      projectId: m.projectId,
      titulo: m.convTitle,
      meta: juntar(
        m.motivo === "gate"
          ? `Missão pausada · a fase ${m.fase} deixou perguntas`
          : `Missão parada · a fase ${m.fase} precisa de outro agente`,
        m.projectName,
      ),
      desde: o.desdeDe?.(m.convId, "missao") ?? null,
    })
    unidades.add(`conv:${m.convId}`)
  }

  for (const d of o.decisoes) {
    const chave = chaveDaDecisao(d)
    itens.push({
      tipo: "decisao",
      chave,
      decisao: d,
      titulo: tituloDaDecisao(d),
      meta: metaDaDecisao(d, now),
      desde: decisionTs(d),
    })
    unidades.add(d.kind === "fusion" ? `conv:${d.convId}` : chave)
  }

  for (const f of o.ferramentas) {
    const chave = `ferramenta:${f.agent}`
    itens.push({
      tipo: "ferramenta",
      chave,
      agent: f.agent,
      titulo: `${f.label} sem login`,
      meta: "Bloqueia o envio. Entre pela CLI no terminal, depois Verificar agora.",
      desde: null,
    })
    unidades.add(chave)
  }

  return { itens, total: unidades.size }
}

function juntar(...partes: (string | null | undefined)[]): string {
  return partes.filter((p) => p && p.trim()).join(" · ")
}

/** Chave estável por decisão (o índice do array mudaria de dono ao filtrar). */
export function chaveDaDecisao(d: Decision): string {
  return d.kind === "fusion"
    ? `fusion:${d.convId}`
    : d.kind === "card"
      ? `card:${d.cardId}`
      : `proposal:${d.proposalId}`
}

export function tituloDaDecisao(d: Decision): string {
  return d.kind === "fusion"
    ? "Escolher o vencedor da disputa"
    : d.kind === "card"
      ? `Card ${d.state === "blocked" ? "bloqueado" : "em revisão"}: ${d.title}`
      : "Ver proposta do lead"
}

/** Segunda linha: de qual projeto, e o que o título truncado não diz. */
export function metaDaDecisao(d: Decision, now: number): string {
  if (d.kind === "fusion") return `${d.title} · ${d.projectName}`
  if (d.kind === "proposal") return `${d.projectName ?? "board inteiro"} · ${d.excerpt}`
  return d.stalledSince != null
    ? `${d.projectName} · parado há ${Math.max(1, Math.round((now - d.stalledSince) / 60_000))} min`
    : d.projectName
}
