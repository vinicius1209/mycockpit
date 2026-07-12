// MOTOR do modo Mission (docs/mission-mode.md §3): orquestração PURA de UMA
// fase do pipeline heterogêneo. Feature INDEPENDENTE do SDD — nada daqui
// importa lib/sdd.ts. Modelado nos padrões do Fusion (reduceItems + soma de
// cost_usd dos results). O store (store/mission.ts) encadeia as fases; aqui
// mora só a lógica de uma fase + montagem de prompt por persona.

import { runAgent, type AgentEvent, type CostSource } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import { reduceItems, type ChatItem, type ItemReducible } from "@/store/chat"
import type { MissionPersona } from "@/lib/missionTypes"
import { handoffInstruction } from "@/lib/missionHandoff"

/** Estado acumulável de UMA fase enquanto os eventos chegam (subset reduzível). */
function emptyReducible(): ItemReducible {
  return {
    items: [],
    streamingTextId: null,
    model: null,
    sessionId: null,
    startedAt: Date.now(),
    contextTokens: undefined,
  }
}

// ── Prompts por persona (templates curtos, pt-BR) ──
//
// Handoff = blackboard tipado (lib/missionHandoff): o contexto entre fases
// carrega INTENÇÃO/decisões/pendências, não o código. Os arquivos alterados já
// estão no worktree (mesmo cwd) — passamos só a lista como referência e o
// agente roda `git diff` se precisar do conteúdo.

const PERSONA_HEADER: Record<MissionPersona, string> = {
  planner:
    "Você é o PLANNER de uma missão. NÃO implemente nada. " +
    "Quebre o pedido abaixo num plano de execução claro e enxuto: liste os " +
    "passos concretos, os arquivos prováveis a tocar e os critérios de pronto. " +
    "O plano será entregue a outro agent que vai executá-lo.",
  executor:
    "Você é o EXECUTOR de uma missão. Implemente de fato as mudanças no código " +
    "seguindo o PLANO e o contexto abaixo. Os arquivos no disco já refletem o " +
    "trabalho feito até aqui (mesmo diretório) — continue de onde parou, não " +
    "refaça o que já existe. Faça o mínimo necessário para cumprir o plano.",
  reviewer:
    "Você é o REVIEWER de uma missão. Os arquivos alterados já estão no seu " +
    "diretório de trabalho — rode `git diff` para ver o código real e avalie " +
    "contra o PLANO/handoff abaixo. Se estiver correto e completo, responda " +
    "APROVADO e explique em 1 linha. Se houver problemas, liste correções " +
    "concretas e acionáveis (arquivo + o quê). NÃO reescreva o código; só avalie.",
}

export interface PhasePromptInput {
  persona: MissionPersona
  task: string
  /** Caminho onde ESTA fase deve gravar seu handoff JSON. */
  handoffPath: string
  /** Handoffs tipados das fases anteriores, já achatados (null na 1ª fase). */
  priorHandoffs?: string | null
  /** Lista leve dos arquivos mudados no worktree (referência, não o patch). */
  changedFiles?: string | null
  /** Fallback: tail do transcript da fase anterior, SÓ quando não houve
   *  handoff tipado (o agente não emitiu o JSON). */
  fallbackContext?: string | null
  /** Instrução extra específica da fase (do preset). */
  instructions?: string
}

/** Monta o prompt de uma fase: persona + tarefa + handoff tipado das fases
 *  anteriores + referência de arquivos + instrução para gravar o próprio
 *  handoff. O código NUNCA viaja no prompt — está no worktree. */
export function phasePrompt(input: PhasePromptInput): string {
  const { persona, task, handoffPath } = input
  const parts: string[] = [PERSONA_HEADER[persona]]

  parts.push("", "## Pedido da missão", task)

  if (input.instructions && input.instructions.trim()) {
    parts.push("", "## Instruções desta fase", input.instructions.trim())
  }

  if (input.priorHandoffs && input.priorHandoffs.trim()) {
    parts.push("", "## Handoff das fases anteriores", input.priorHandoffs.trim())
  } else if (input.fallbackContext && input.fallbackContext.trim()) {
    // agente anterior não emitiu handoff JSON → cai no tail do transcript.
    parts.push(
      "",
      "## Contexto da fase anterior (resumo do transcript)",
      input.fallbackContext.trim(),
    )
  }

  if (input.changedFiles && input.changedFiles.trim()) {
    parts.push(
      "",
      "## Arquivos alterados no worktree (referência — rode `git diff` p/ o código)",
      input.changedFiles.trim(),
    )
  }

  parts.push("", handoffInstruction(handoffPath))

  return parts.join("\n")
}

// ── runPhase: dispara o agent, reduz eventos, retry e custo ──

export interface PhaseResult {
  ok: boolean
  items: ChatItem[]
  costUsd: number
  costSource: CostSource | undefined
  /** Mensagem de erro da ÚLTIMA tentativa (undefined se ok). */
  error?: string
}

export interface RunPhaseArgs {
  runId: string
  convId: string
  agent: string
  model: string | null
  effort: string | null
  prompt: string
  cwd: string
  permission: string
  maxRetries: number
  /** Callback por tentativa: informa a tentativa corrente (1-based) e os itens
   *  reduzidos até aqui, p/ o store espelhar na timeline. */
  onProgress?: (attempt: number, items: ChatItem[]) => void
  /** Injetável nos testes; default = runAgent real. */
  run?: typeof runAgent
}

/** Roda UMA fase com retry até maxRetries. Reduz os AgentEvent num array de
 *  ChatItem (como o chat/Fusion), soma cost_usd de TODOS os results (inclusive
 *  os das tentativas descartadas — o gasto é real) e devolve o resultado.
 *  Sucesso = o último result teve ok=true e não houve error/cancelled. */
export async function runPhase(args: RunPhaseArgs): Promise<PhaseResult> {
  const run = args.run ?? runAgent
  const maxRetries = Math.max(1, args.maxRetries)
  const attachments: Attachment[] = []

  let totalCost = 0
  let costSource: CostSource | undefined
  let lastItems: ChatItem[] = []
  let lastError: string | undefined

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let acc = emptyReducible()
    let sawError: string | null = null
    let resultOk: boolean | null = null

    const onEvent = (e: AgentEvent) => {
      acc = { ...acc, ...reduceItems(acc, e) }
      if (e.type === "result") {
        totalCost += e.cost_usd ?? 0
        costSource = e.cost_source
        resultOk = e.ok
      } else if (e.type === "error") {
        sawError = e.message
      } else if (e.type === "cancelled") {
        sawError = "fase cancelada"
      }
      args.onProgress?.(attempt, acc.items)
    }

    try {
      await run(
        args.runId,
        args.convId,
        args.agent,
        args.model,
        args.effort,
        args.prompt,
        args.cwd,
        null, // sessão fresca por fase (agents heterogêneos, sem resume cruzado)
        args.permission,
        attachments,
        onEvent,
      )
    } catch (err) {
      sawError = err instanceof Error ? err.message : "falha ao iniciar a fase"
    }

    lastItems = acc.items
    const ok = sawError == null && resultOk !== false
    if (ok) {
      return { ok: true, items: lastItems, costUsd: totalCost, costSource }
    }
    lastError = sawError ?? "a fase terminou sem sucesso"
    // esgotou as tentativas → sai com erro; senão tenta de novo (mesmo cwd).
  }

  return {
    ok: false,
    items: lastItems,
    costUsd: totalCost,
    costSource,
    error: lastError,
  }
}

// ── Budget ──

export interface BudgetCheck {
  ok: boolean
  reason?: string
}

/** Checa ANTES de disparar a próxima fase se o custo acumulado já estourou o
 *  teto (risco nº1 do design). Sem teto (null) → sempre ok. */
export function checkBudget(
  costTotal: number,
  maxCostUsd: number | null,
): BudgetCheck {
  if (maxCostUsd == null) return { ok: true }
  if (costTotal >= maxCostUsd) {
    return {
      ok: false,
      reason: `orçamento da missão esgotado (US$ ${costTotal.toFixed(2)} de US$ ${maxCostUsd.toFixed(2)})`,
    }
  }
  return { ok: true }
}
