// A Frota em dados: quais linhas, em qual seção, em qual ordem, e o que cada
// célula diz. Tudo PURO, fora do componente (`components/fleet/FleetView.tsx`)
// para ser testável sem store e sem jsdom (ver o topo de lá).

import { fmtDuration } from "@/lib/format"
import { summarizeApproval } from "@/lib/approvalSummary"
import type { ConversationMeta } from "@/lib/db/conversations"
import type { ApprovalData, InteractionRequest, QuestionData } from "@/lib/interaction"
import { slotEstado, fmtQuando, type SlotEstado } from "@/components/layout/conversationWhen"
import type { ChatItem } from "@/store/chat"
import { questionHeadline } from "@/store/interactions"

// ---------------------------------------------------------------------------
// Chaves estáveis (uma string só muda em TRANSIÇÃO, nunca por delta de
// streaming — padrão de useRunningConvIds em ConversationList).
// ---------------------------------------------------------------------------

export interface FleetRow {
  id: string
  projectId: string
  agent: string
  startedAt: number | null
}

/** Desserializa a chave estável (id:projectId:agent:startedAt, uma por "|")
 *  de volta em linhas. Pura — sem isso, o hook não seria testável (ver topo). */
export function parseFleetKey(key: string): FleetRow[] {
  if (!key) return []
  return key.split("|").map((part): FleetRow => {
    const [id, projectId, agent, startedAt] = part.split(":")
    return { id, projectId, agent, startedAt: startedAt ? Number(startedAt) : null }
  })
}

export interface UnseenRow {
  id: string
  projectId: string
  resultado: "ok" | "error"
}

/** Espelho do parseFleetKey para `finishedUnseen` (id:projectId:ok|error). */
export function parseUnseenKey(key: string): UnseenRow[] {
  if (!key) return []
  return key.split("|").map((part): UnseenRow => {
    const [id, projectId, resultado] = part.split(":")
    return { id, projectId, resultado: resultado === "error" ? "error" : "ok" }
  })
}

// ---------------------------------------------------------------------------
// Derivação pura: quais linhas, em qual seção, em qual ordem.
// ---------------------------------------------------------------------------

type ProjetoMinimo = { id: string; name: string; color?: string | null }

export interface LinhaDaFrota {
  id: string
  projectId: string
  projectName: string
  agent: string | null
  titulo: string
  /** Cor da conversa, senão a do projeto (a regra do cometa na sidebar). */
  cor: string | null
  estado: SlotEstado
  /** O processo está no ar (uma linha que PEDE continua rodando: ela espera). */
  rodando: boolean
  /** Cronômetro do turno (só pinta na rodando; ver rowSubtitle pro porquê). */
  startedAt: number | null
  updatedAt: number | null
}

function metaDe(
  metas: Record<string, ConversationMeta[]>,
  projectId: string,
  id: string,
): ConversationMeta | undefined {
  return metas[projectId]?.find((m) => m.id === id)
}

function paraLinha(
  base: { id: string; projectId: string; agent: string | null },
  flags: { pede: boolean; rodando: boolean; falhou: boolean },
  startedAt: number | null,
  metas: Record<string, ConversationMeta[]>,
  projetos: readonly ProjetoMinimo[],
): LinhaDaFrota {
  const meta = metaDe(metas, base.projectId, base.id)
  const projeto = projetos.find((p) => p.id === base.projectId)
  return {
    id: base.id,
    projectId: base.projectId,
    projectName: projeto?.name ?? "?",
    agent: base.agent || meta?.agent || null,
    titulo: meta?.title ?? "Nova conversa",
    cor: meta?.color ?? projeto?.color ?? null,
    estado: slotEstado(flags),
    rodando: flags.rodando,
    startedAt,
    updatedAt: meta?.updatedAt ?? null,
  }
}

/** Monta as duas seções. Agora: pede primeiro (o mais recente a pedir em
 *  cima), depois o que roda (o mais ANTIGO em cima — é o que há mais tempo
 *  merece o olhar, e um travado não se esconde no fim). Mais cedo: falha
 *  antes de concluída; dentro, a mais recente primeiro. Pura. */
export function buildFleetLines(args: {
  vivas: FleetRow[]
  terminadas: UnseenRow[]
  aguardando: ReadonlySet<string>
  metas: Record<string, ConversationMeta[]>
  projetos: readonly ProjetoMinimo[]
}): { agora: LinhaDaFrota[]; maisCedo: LinhaDaFrota[] } {
  const { vivas, terminadas, aguardando, metas, projetos } = args
  const vivasPorId = new Map(vivas.map((r) => [r.id, r]))

  const pede: LinhaDaFrota[] = []
  const roda: LinhaDaFrota[] = []
  const ids = new Set<string>([...vivasPorId.keys(), ...aguardando])
  for (const id of ids) {
    const viva = vivasPorId.get(id)
    const projectId = viva?.projectId ?? projetoIdDaMeta(metas, id)
    if (!projectId) continue
    const linha = paraLinha(
      { id, projectId, agent: viva?.agent ?? null },
      { pede: aguardando.has(id), rodando: viva != null, falhou: false },
      viva?.startedAt ?? null,
      metas,
      projetos,
    )
    ;(linha.estado === "pede" ? pede : roda).push(linha)
  }
  pede.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  roda.sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity))

  const maisCedo = terminadas
    .filter((t) => !ids.has(t.id))
    .map((t) =>
      paraLinha(
        { id: t.id, projectId: t.projectId, agent: null },
        { pede: false, rodando: false, falhou: t.resultado === "error" },
        null,
        metas,
        projetos,
      ),
    )
    .sort((a, b) => {
      const fa = a.estado === "falhou" ? 0 : 1
      const fb = b.estado === "falhou" ? 0 : 1
      return fa - fb || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    })

  return { agora: [...pede, ...roda], maisCedo }
}

/** A conversa existe em alguma meta (pedido sem run vivo não está na chave
 *  de running; o projeto vem de onde der). */
function projetoIdDaMeta(
  metas: Record<string, ConversationMeta[]>,
  id: string,
): string | null {
  for (const [projectId, lista] of Object.entries(metas)) {
    if (lista.some((m) => m.id === id)) return projectId
  }
  return null
}

/** Ações CONCLUÍDAS do turno em curso: as ferramentas com resultado desde o
 *  seu último pedido. É o número que anda no fio ao lado do cronômetro, e o
 *  único dado de progresso que o app tem sem inventar verbo. Trabalho em
 *  background não conta (tem linha própria). Puro. */
export function acoesDoTurno(items: readonly ChatItem[]): number {
  let n = 0
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === "user" && !it.advisorTo) break
    if (it.kind === "tool" && it.result != null && !it.deferred) n++
  }
  return n
}

/** O subtítulo diz só o que é fato, no tempo verbal certo (§6/§7): gerúndio
 *  no vivo, pretérito no marco. `fundo` é o texto do deferredLiveLine;
 *  `pedido`, o resumo do que o agente pediu. */
export function rowSubtitle(e: {
  estado: SlotEstado
  finalizando: boolean
  fundo: string | null
  pedido?: string | null
  acoes?: number
}): string {
  if (e.estado === "pede") return e.pedido ? `pede: ${e.pedido}` : "aguardando sua resposta"
  if (e.estado === "falhou") return "o último turno falhou"
  if (e.estado === "quando") return "concluída"
  if (e.fundo) return e.fundo
  if (e.finalizando) return "finalizando…"
  const n = e.acoes ?? 0
  return n > 0 ? `está trabalhando · ${n} ${n === 1 ? "ação" : "ações"}` : "está trabalhando…"
}

/** O fato que a coluna Tempo mostra, e a dica que diz QUAL fato é. Puro. */
export function tempoDaLinha(e: {
  estado: SlotEstado
  inicio: number | null
  updatedAt: number | null
  agora: number
  agoraMinuto: number
}): { texto: string; dica: string } {
  if (e.estado === "rodando" && e.inicio) {
    return { texto: fmtDuration(e.agora - e.inicio), dica: "Duração do turno" }
  }
  const texto = fmtQuando(e.updatedAt, e.agoraMinuto)
  if (e.estado === "pede") return { texto, dica: "Última atividade antes do pedido" }
  if (e.estado === "rodando") return { texto, dica: "Última atividade" }
  return { texto, dica: "Quando terminou" }
}

/** O resumo de uma linha do pedido pendente, o mesmo que o sino usa: a
 *  pergunta pelo `header`, a permissão pelo `summarizeApproval`. Plano e
 *  recurso têm cartão próprio e texto que depende de contexto: `null`, e a
 *  linha cai no genérico em vez de inventar. */
export function resumoDoPedido(req: InteractionRequest): string | null {
  if (req.kind === "question") return questionHeadline(req.data as QuestionData | undefined)
  if (req.kind === "approval") {
    return summarizeApproval((req.data ?? {}) as ApprovalData).headline
  }
  return null
}
