// O motor de uma fase de missão (docs/mission-mode.md §3), puro: roda a fase e
// monta o prompt por persona. O store (store/mission.ts) encadeia as fases.

import { cancelAgent, runAgent, type AgentEvent, type CostSource } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import { matchesResumePattern } from "@/lib/autoResume"
import { reduceItems, type ChatItem, type ItemReducible } from "@/store/chat"
import type {
  GateAnswer,
  MissionGatePolicy,
  MissionPersona,
} from "@/lib/missionTypes"
import { handoffInstruction } from "@/lib/missionHandoff"
import type { RunPhaseArgs } from "@/lib/missionPhaseContract"
export type { PhaseCostEvent, RunPhaseArgs } from "@/lib/missionPhaseContract"

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

// ── Prompts por persona ──
// O handoff entre fases é o blackboard (lib/missionHandoff): intenção,
// decisões e pendências, não código. Os arquivos já estão no worktree; vai só
// a lista, e o agente roda `git diff` se precisar.

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
  /** Condições que devem ser verdadeiras antes de iniciar a fase. */
  entryCriteria?: string[]
  /** Checklist de pronto específico desta fase. */
  exitCriteria?: string[]
  /** Doutrina do projeto (.frota/instructions.md), já em bloco. Vale em
   *  TODAS as fases: cada fase é um run novo de CLI, e a maioria delas roda em
   *  codex/agy, que não leem CLAUDE.md. null = projeto sem doutrina. */
  doctrineBlock?: string | null
  /** M1: bloco "Entregas similares já feitas (recall)" — só no planner, quando
   *  há match high/medium. null = nada a injetar. */
  recallBlock?: string | null
  /** M2: bloco "Lições deste projeto" — planner e executor. null = sem lições. */
  lessonsBlock?: string | null
  /** Gate humano: respostas do usuário às perguntas da fase anterior (bloco
   *  pronto de buildGateDecisionsBlock). Só a fase seguinte ao gate recebe. */
  userDecisions?: string | null
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

  const entryCriteria = (input.entryCriteria ?? []).map((c) => c.trim()).filter(Boolean)
  if (entryCriteria.length > 0) {
    parts.push(
      "",
      "## Critérios de entrada",
      "Confirme estes pontos antes de agir; se algum não puder ser confirmado, registre a pendência no handoff:",
      ...entryCriteria.map((criterion) => `- ${criterion}`),
    )
  }

  const exitCriteria = (input.exitCriteria ?? []).map((c) => c.trim()).filter(Boolean)
  if (exitCriteria.length > 0) {
    parts.push(
      "",
      "## Critérios de saída",
      "Só conclua a fase depois de verificar este checklist:",
      ...exitCriteria.map((criterion) => `- ${criterion}`),
    )
  }

  // Doutrina do projeto ANTES do aprendizado: regra escrita pelo humano vem
  // antes de regra destilada por máquina (mesma cascata do chat).
  if (input.doctrineBlock && input.doctrineBlock.trim()) {
    parts.push("", input.doctrineBlock.trim())
  }

  // Recall de entregas similares (só o planner) e lições do projeto, antes do
  // handoff, para ancorar a fase.
  if (input.recallBlock && input.recallBlock.trim()) {
    parts.push("", input.recallBlock.trim())
  }
  if (input.lessonsBlock && input.lessonsBlock.trim()) {
    parts.push("", input.lessonsBlock.trim())
  }

  // As suas decisões do gate vêm antes do handoff: são a diretriz mais forte.
  if (input.userDecisions && input.userDecisions.trim()) {
    parts.push("", input.userDecisions.trim())
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

// ── Gate humano (onda 2): a missão PAUSA quando uma fase deixa perguntas ──

/** Perguntas que justificam pausar a missão: as open_questions do handoff da
 *  fase, SÓ quando existe uma próxima fase pra receber as respostas (no fim
 *  da missão elas vão pro resumo, não pro gate). */
export function gateQuestions(
  openQuestions: string[] | undefined,
  hasNextPhase: boolean,
): string[] {
  if (!hasNextPhase) return []
  return (openQuestions ?? []).map((q) => q.trim()).filter(Boolean)
}

// ── Política de gate (MH3.3): o preset decide QUANDO a missão pausa ──

/** Pergunta padrão do gate obrigatório de "sempre-apos-planejar" quando a fase
 *  de planejamento não deixou perguntas próprias. */
export const PLAN_GATE_QUESTION = "Revise o plano antes de executar"

/** Decisão de gate depois de uma fase:
 *  - "gate": pausa a missão com estas perguntas (fluxo clássico do answerGate).
 *  - "notice": NÃO pausa, mas as perguntas entram no fio como aviso
 *    (política "nunca" — informação nunca some).
 *  - "none": segue direto. */
export interface GateOutcome {
  kind: "gate" | "notice" | "none"
  questions: string[]
}

/** Aplica a política de gate do preset (ausente = "agente"):
 *  - "agente": gate quando a fase deixou open_questions e há próxima fase;
 *  - "nunca": nunca pausa, as perguntas viram notice;
 *  - "sempre-apos-planejar": também pausa depois da fase 1, com a pergunta
 *    padrão se ela não fez nenhuma.
 *  Sem próxima fase, nunca há gate (as pendências vão para o resumo). */
export function gateOutcome(input: {
  policy: MissionGatePolicy | null | undefined
  openQuestions: string[] | undefined
  phaseIndex: number
  hasNextPhase: boolean
}): GateOutcome {
  const questions = gateQuestions(input.openQuestions, input.hasNextPhase)
  const policy = input.policy ?? "agente"
  if (policy === "nunca") {
    return questions.length > 0
      ? { kind: "notice", questions }
      : { kind: "none", questions: [] }
  }
  if (
    policy === "sempre-apos-planejar" &&
    input.phaseIndex === 0 &&
    input.hasNextPhase
  ) {
    return {
      kind: "gate",
      questions: questions.length > 0 ? questions : [PLAN_GATE_QUESTION],
    }
  }
  return questions.length > 0
    ? { kind: "gate", questions }
    : { kind: "none", questions: [] }
}

/** Bloco de prompt com as decisões do usuário (injetado na fase seguinte ao
 *  gate). Resposta em branco vira delegação explícita — o agente decide. */
export function buildGateDecisionsBlock(
  questions: string[],
  answers: string[],
): string {
  const lines = [
    "## Decisões do usuário (gate humano)",
    "A fase anterior deixou perguntas em aberto; o usuário respondeu. Estas decisões são DIRETRIZES — siga-as:",
    "",
  ]
  questions.forEach((q, i) => {
    const a = (answers[i] ?? "").trim()
    lines.push(`${i + 1}. P: ${q}`)
    lines.push(`   R: ${a || "(sem resposta — decida você, com bom senso)"}`)
  })
  return lines.join("\n")
}

/** Normaliza as respostas do gate: string[] legado (Trabalho/Escritório atuais)
 *  vira GateAnswer[] sem anexos. Retrocompat total — os texts seguem o MESMO
 *  caminho (buildGateDecisionsBlock) nas duas formas. */
export function normalizeGateAnswers(
  answers: GateAnswer[] | string[],
): GateAnswer[] {
  return answers.map((a) => (typeof a === "string" ? { text: a } : a))
}

/** Anexos das respostas do gate divididos pela capacidade do agent da PRÓXIMA
 *  fase (agentCaps): `kept` vai pro runPhase dela; `dropped` vira notice no
 *  histórico (nunca erro). Agrega na ordem das respostas. */
export function splitGateAttachments(
  answers: GateAnswer[],
  caps: { image: boolean; pdf: boolean },
): { kept: Attachment[]; dropped: Attachment[] } {
  const kept: Attachment[] = []
  const dropped: Attachment[] = []
  for (const a of answers) {
    for (const att of a.attachments ?? []) {
      const supported =
        (att.kind === "image" && caps.image) || (att.kind === "pdf" && caps.pdf)
      ;(supported ? kept : dropped).push(att)
    }
  }
  return { kept, dropped }
}

/** O reviewer aprovou? Procura "APROVADO" no texto final. Aprovação qualificada
 *  ("com ressalvas", "ainda não", "NÃO APROVADO") é reprovação: na dúvida,
 *  fail-closed, porque aprovar à toa esconde o problema. */
export function reviewerApproved(items: ChatItem[]): boolean {
  const text = items
    .filter((i) => i.kind === "text")
    .map((i) => (i as Extract<ChatItem, { kind: "text" }>).text)
    .join("\n")
    .toUpperCase()
  // Fronteira de palavra: "DESAPROVADO" e "REPROVADO" contêm "APROVADO".
  if (!/(^|[^A-ZÀ-Ü])APROVADO/.test(text)) return false
  // negação com até 3 palavras no meio: "NÃO APROVADO", "NÃO-APROVADO" (hífen
  // conta como separador), "NÃO ESTÁ APROVADO", "NÃO FOI TOTALMENTE APROVADO"…
  if (/N[ÃA]O(?:[\s-]+\S+){0,3}[\s-]+APROVADO/.test(text)) return false
  // aprovação com ressalva é reprovação disfarçada — o template pede APROVADO
  // seco quando está correto E completo.
  if (/APROVADO[,:]?\s+(?:MAS|POR[ÉE]M|COM\s+RESSALVAS?)/.test(text)) return false
  return true
}

/** Extrai o texto final de uma fase (as correções do reviewer p/ reinjetar). */
export function phaseText(items: ChatItem[]): string {
  return items
    .filter((i) => i.kind === "text")
    .map((i) => (i as Extract<ChatItem, { kind: "text" }>).text)
    .join("\n\n")
    .trim()
}

// ── runPhase: dispara o agent, reduz eventos, retry e custo ──

export interface PhaseResult {
  ok: boolean
  items: ChatItem[]
  costUsd: number
  costSource: CostSource | undefined
  /** Mensagem de erro da ÚLTIMA tentativa (undefined se ok). */
  error?: string
  /** MH2.2 — a fase parou porque o custo acumulado cruzou o teto DURANTE a
   *  execução (stopAtCostUsd): o run corrente foi cancelado e não houve retry.
   *  O store leva a missão ao MESMO desfecho de teto do check entre fases. */
  budgetExceeded?: boolean
}

/** Roda uma fase com retry até maxRetries e reduz os eventos a ChatItem.
 *  Sucesso = o último result ok, sem error nem cancelled.
 *  Custo: numa tentativa o último result vence (o segundo é cumulativo);
 *  entre tentativas soma, porque cada uma é um run.
 *  Teto: com stopAtCostUsd, cruzar o teto num result cancela o run e nunca
 *  re-tenta. Se a tentativa ainda terminou ok, volta ok e o check entre fases
 *  dá o desfecho de teto. */
export async function runPhase(args: RunPhaseArgs): Promise<PhaseResult> {
  const run = args.run ?? runAgent
  const cancel = args.cancel ?? cancelAgent
  const maxRetries = Math.max(1, args.maxRetries)
  const attachments: Attachment[] = args.attachments ?? []

  /** Soma das tentativas já ENCERRADAS (a corrente entra ao terminar). */
  let doneCost = 0
  let costSource: CostSource | undefined
  let lastItems: ChatItem[] = []
  let lastError: string | undefined
  let budgetExceeded = false

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let acc = emptyReducible()
    let sawError: string | null = null
    let resultOk: boolean | null = null
    /** Custo da tentativa CORRENTE: o último result vence (cumulativo). */
    let attemptCost = 0

    const onEvent = (e: AgentEvent) => {
      acc = {
        ...acc,
        ...reduceItems(acc, e, { agent: args.agent, reqModel: args.model }),
      }
      if (e.type === "result") {
        // O TETO só conhece dinheiro (sem preço `attemptCost` não anda); o
        // LEDGER conhece consumo, e a fase entra mesmo sem preço (ADR-047).
        if (e.cost_usd != null) attemptCost = e.cost_usd
        args.onCost?.(attempt, {
          costUsd: e.cost_usd ?? null,
          costSource: e.cost_source,
          input: e.input_tokens,
          output: e.output_tokens,
          cache: e.cache_read + e.cache_creation,
        })
        costSource = e.cost_source
        resultOk = e.ok
        // Corte intra-fase: o parcial cruzou o teto, então cancela o run (no-op
        // se já saiu) e não re-tenta. Sem custo incremental, o check entre
        // fases cobre.
        if (
          !budgetExceeded &&
          args.stopAtCostUsd != null &&
          doneCost + attemptCost >= args.stopAtCostUsd
        ) {
          budgetExceeded = true
          // best-effort, mas nunca mudo: falha do cancel deixa rastro (o run
          // pode já ter saído — aí o erro é esperado e o warn é barato).
          cancel(args.runId).catch((e) =>
            console.warn("[missão] falha ao cancelar fase no corte de teto:", e),
          )
        }
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
        { instructionSources: args.instructionSources },
      )
    } catch (err) {
      sawError = err instanceof Error ? err.message : "falha ao iniciar a fase"
    }

    lastItems = acc.items
    doneCost += attemptCost // tentativa encerrada: consolida o gasto dela
    const ok = sawError == null && resultOk !== false
    if (ok) {
      // O run terminou ok antes do cancel: trabalho real entregue, e o
      // checkBudget entre fases corta.
      return { ok: true, items: lastItems, costUsd: doneCost, costSource }
    }
    if (budgetExceeded) {
      return {
        ok: false,
        items: lastItems,
        costUsd: doneCost,
        costSource,
        error: "teto de custo da missão atingido durante a fase",
        budgetExceeded: true,
      }
    }
    lastError = sawError ?? "a fase terminou sem sucesso"
    // esgotou as tentativas → sai com erro; senão tenta de novo (mesmo cwd).
  }

  return {
    ok: false,
    items: lastItems,
    costUsd: doneCost,
    costSource,
    error: lastError,
  }
}

// ── Recuperação de fase: falhou por LIMITE, não por bug ──

/** A falha é recuperável (trocar de agent resolve)? Sinal forte: item
 *  `limit` no transcript; heurístico: o erro casa os padrões de
 *  rate-limit/espera/crédito (lib/autoResume). Recuperável pausa em recovery
 *  em vez de morrer. */
export function isRecoverableFailure(result: PhaseResult): boolean {
  if (result.ok) return false
  if (result.items.some((it) => it.kind === "limit")) return true
  if (result.error && matchesResumePattern(result.error)) return true
  return false
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
