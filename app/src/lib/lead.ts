// S4.2 — LEAD PROPOSITOR (opt-in, NUNCA despacha): lê os cards abertos do
// board, pede uma triagem curta ao helper barato (suggest, o mesmo primitivo
// one-shot do distillLesson) e PERSISTE a proposta em lead_proposals. A
// proposta vira Decision { kind: "proposal" } na fila "Precisam de você" e no
// sino; aprovar um item da proposta é o gesto humano normal de despachar o
// card no board. Este módulo não cria conversa, não roda agent de código e
// não tem nenhum caminho de dispatch — proposta é texto, o gate é humano.

import { homeDir } from "@tauri-apps/api/path"
import { suggest } from "@/lib/agent"
import { insertProposal, type CardState } from "@/lib/db"
import { useApp } from "@/store/app"
import { useCards, type CardRow } from "@/store/cards"

/** Estados que contam como "aberto" pra triagem do lead. */
const OPEN_STATES: readonly CardState[] = [
  "backlog",
  "working",
  "review",
  "blocked",
]

export function isOpenCardState(state: CardState): boolean {
  return OPEN_STATES.includes(state)
}

/** Rótulo pt-BR de cada estado no prompt (o modelo lê português). */
const STATE_PT: Record<CardState, string> = {
  backlog: "backlog",
  working: "em andamento",
  review: "em revisão",
  blocked: "bloqueado",
  done: "feito",
  cancelled: "cancelado",
}

/** Monta o prompt de triagem (puro/testável). Uma linha por card:
 *  estado + título + projeto (+ "parado" quando o vigia marcou). */
export function buildLeadPrompt(
  cards: Pick<CardRow, "title" | "state" | "projectId" | "stalledSince">[],
  projectNames: Map<string, string>,
): string {
  const lines = [
    "Você é o lead deste board de intenções de um cockpit de agents de código.",
    "Cards abertos:",
    "",
  ]
  for (const c of cards) {
    const proj = projectNames.get(c.projectId) ?? "projeto arquivado"
    const stalled = c.stalledSince != null ? ", parado sem atividade" : ""
    lines.push(`- [${STATE_PT[c.state]}] ${c.title} (${proj}${stalled})`)
  }
  lines.push(
    "",
    "Faça uma triagem curta, em português:",
    "1. Priorize os cards (o que importa primeiro e por quê, uma linha cada).",
    "2. Aponte o próximo passo dos que estão em revisão ou bloqueados.",
    "3. Sugira NO MÁXIMO 1 card do backlog pra despachar agora, com o motivo.",
    "Seja direto, no máximo 12 linhas. Não invente cards que não estão na lista.",
  )
  return lines.join("\n")
}

/** Pede UMA proposta de triagem ao lead e a persiste. `projectId` restringe ao
 *  board do projeto; sem ele a triagem é do board inteiro (cross-projeto).
 *  Retorna o id da proposta gravada, ou null quando não há o que propor
 *  (board sem cards abertos, ou o helper devolveu vazio). LANÇA com mensagem
 *  pt-BR quando o helper está desligado — o caller decide toast/failed.
 *  `run` é injetável nos testes (padrão do distillLesson). */
export async function proposePlan(
  projectId?: string,
  run: typeof suggest = suggest,
): Promise<string | null> {
  const app = useApp.getState()

  // Helper na MESMA regra das sugestões do ChatPanel: cfg do projeto vence
  // (inclusive helper null = desligado de propósito); senão o default global.
  const cfg = projectId ? app.mycockpit[projectId] : undefined
  const helperModel = cfg ? cfg.helper : app.settings.helperModel
  if (!helperModel) {
    throw new Error(
      "Configure um modelo helper nas Configurações para pedir propostas ao lead",
    )
  }

  const cards = useCards
    .getState()
    .all.filter(
      (c) =>
        isOpenCardState(c.state) &&
        (projectId == null || c.projectId === projectId),
    )
  if (cards.length === 0) return null // board vazio: nada a propor, sem gasto

  const projectNames = new Map(app.projects.map((p) => [p.id, p.name]))
  // cwd do helper: pasta do projeto quando a triagem é de um projeto; home no
  // board inteiro (o lead só escreve texto — não precisa de repo).
  const project = projectId
    ? app.projects.find((p) => p.id === projectId)
    : undefined
  const cwd = project?.path ?? (await homeDir().catch(() => "."))

  const body = (
    await run(helperModel, cwd, buildLeadPrompt(cards, projectNames))
  ).trim()
  if (!body) return null // helper mudo: sem proposta fantasma na fila

  return insertProposal({ projectId: projectId ?? null, body })
}
