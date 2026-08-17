// MOTOR do modo Mission (docs/mission-mode.md §3): orquestração PURA de UMA
// fase do pipeline heterogêneo. Feature INDEPENDENTE do SDD — nada daqui
// importa lib/sdd.ts. Modelado nos padrões do Fusion (reduceItems + soma de
// cost_usd dos results). O store (store/mission.ts) encadeia as fases; aqui
// mora só a lógica de uma fase + montagem de prompt por persona.

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
  /** Condições que devem ser verdadeiras antes de iniciar a fase. */
  entryCriteria?: string[]
  /** Checklist de pronto específico desta fase. */
  exitCriteria?: string[]
  /** Doutrina do projeto (.mycockpit/instructions.md), já em bloco. Vale em
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

  // Auto-aprendizado (M1/M2): recall de entregas similares (só planner) e
  // lições do projeto. Vêm ANTES do handoff pra ancorar o raciocínio da fase.
  if (input.recallBlock && input.recallBlock.trim()) {
    parts.push("", input.recallBlock.trim())
  }
  if (input.lessonsBlock && input.lessonsBlock.trim()) {
    parts.push("", input.lessonsBlock.trim())
  }

  // Gate humano: as decisões do usuário vêm ANTES do handoff — são a diretriz
  // mais forte da fase (respondem exatamente às open_questions anteriores).
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

/** Aplica a política de gate do preset (MH3.3). `policy` ausente = "agente"
 *  (fail-open: presets salvos antes do campo mantêm o comportamento clássico).
 *  - "agente": gate quando a fase deixou open_questions E há próxima fase.
 *  - "nunca": nunca abre gate; perguntas que abririam viram notice.
 *  - "sempre-apos-planejar": além da regra do "agente", a fase 1 SEMPRE abre
 *    gate (sem perguntas próprias entra a pergunta padrão PLAN_GATE_QUESTION).
 *  Sem próxima fase nunca há gate (as pendências vão pro resumo final). */
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

/** O reviewer aprovou? Varre o texto final da fase por "APROVADO" (o template
 *  pede essa palavra). ENDURECIDO (MH1.1): aprovação qualificada NÃO conta —
 *  "aprovado com ressalvas", "ainda não está aprovado", "não totalmente
 *  aprovado" e "NÃO APROVADO" são reprovação. Na dúvida, fail-closed: contar
 *  como reprovado dispara correção/ressalva; contar como aprovado esconde o
 *  problema. Usado pelo loop de correção do M2 e pelo desfecho com ressalva. */
export function reviewerApproved(items: ChatItem[]): boolean {
  const text = items
    .filter((i) => i.kind === "text")
    .map((i) => (i as Extract<ChatItem, { kind: "text" }>).text)
    .join("\n")
    .toUpperCase()
  // fronteira de PALAVRA, não substring: "DESAPROVADO"/"REPROVADO" contêm
  // "APROVADO" e passariam como aprovação (o bug do gate). Vale a ocorrência
  // no início do texto ou precedida de não-letra (espaço, pontuação, hífen).
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

/** MH2.1 — campos de custo de UM result (o subset do AgentEvent que o ledger
 *  precisa). `costUsd` null = consumiu sem preço conhecido (ADR-047), nunca 0. */
export interface PhaseCostEvent {
  costUsd: number | null
  costSource: CostSource | undefined
  input: number
  output: number
  cache: number
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
  /** Anexos do usuário (imagem/PDF): na FASE 1 vêm do launcher (junto do
   *  pedido); na fase seguinte a um GATE vêm das respostas ricas (answerGate).
   *  Mesmo caminho do handleSend (runAgent já aceitava a lista; nada muda no
   *  Rust). Default = sem anexos. */
  attachments?: Attachment[]
  /** Callback por tentativa: informa a tentativa corrente (1-based) e os itens
   *  reduzidos até aqui, p/ o store espelhar na timeline. */
  onProgress?: (attempt: number, items: ChatItem[]) => void
  /** MH2.1 — chamado a CADA result com cost_usd (parciais e tentativas
   *  descartadas inclusive; o gasto é real mesmo quando o retry joga o
   *  transcript fora). O store grava o ledger por TENTATIVA: results do MESMO
   *  attempt carregam custo CUMULATIVO do run (padrão do CLI, ver
   *  docs/stream-json-notes.md), então o REPLACE por runId-da-tentativa
   *  colapsa os parciais sem contar em dobro. */
  onCost?: (attempt: number, e: PhaseCostEvent) => void
  /** MH2.2 — teto RESTANTE da missão em US$ pra esta invocação (maxCostUsd
   *  menos o costTotal já gasto pelas fases/tentativas anteriores). Cruzou
   *  DURANTE a fase → cancela o run corrente e NÃO re-tenta (budgetExceeded).
   *  Degradação HONESTA: os motores só reportam custo em eventos result
   *  (claude no fim do run; codex estimado no fim) — sem custo incremental
   *  mid-fase o corte simplesmente não dispara, e o teto morde no check entre
   *  fases (checkBudget) como sempre. null/undefined = sem teto. */
  stopAtCostUsd?: number | null
  /** Injetável nos testes; default = runAgent real. */
  run?: typeof runAgent
  /** Injetável nos testes; default = cancelAgent real (corte do MH2.2). */
  cancel?: typeof cancelAgent
}

/** Roda UMA fase com retry até maxRetries. Reduz os AgentEvent num array de
 *  ChatItem (como o chat/Fusion) e devolve o resultado. Sucesso = o último
 *  result teve ok=true e não houve error/cancelled.
 *
 *  CUSTO (MH2.1): dentro de UMA tentativa o último result VENCE (o CLI pode
 *  emitir 2 results no mesmo run e o custo do segundo é CUMULATIVO, ver
 *  docs/stream-json-notes.md — somar os dois contaria em dobro, mesma razão do
 *  REPLACE por run_id no ledger do chat); ENTRE tentativas o custo SOMA
 *  (cada tentativa é um run novo, gasto próprio — inclusive as descartadas).
 *
 *  TETO (MH2.2): com stopAtCostUsd, cruzou o teto num result → cancela o run
 *  corrente (o gasto para de crescer) e nunca re-tenta. Se mesmo assim a
 *  tentativa terminou ok (o result era o último suspiro do run, corrida
 *  benigna), a fase volta ok e o check entre fases dá o desfecho de teto. */
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
        // MH2.2 — corte intra-fase: o parcial cruzou o teto → cancela o run
        // corrente (best-effort: se ele já saiu, o cancel é no-op) e marca pra
        // nunca re-tentar. Só dispara quando um result com custo CHEGA antes do
        // fim — sem custo incremental, degrada pro check entre fases.
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
      )
    } catch (err) {
      sawError = err instanceof Error ? err.message : "falha ao iniciar a fase"
    }

    lastItems = acc.items
    doneCost += attemptCost // tentativa encerrada: consolida o gasto dela
    const ok = sawError == null && resultOk !== false
    if (ok) {
      // corrida benigna do corte: o run terminou ok antes do cancel morder —
      // devolve ok (trabalho REAL entregue) e o checkBudget entre fases morde.
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

// ── Recuperação de fase (onda 2): a fase falhou por LIMITE, não por bug ──

/** A falha de uma fase é RECUPERÁVEL (trocar de agent/modelo resolve)? Sinais:
 *  - FORTE: um item kind:"limit" no transcript da fase (limite da CLI durante o
 *    run — o mesmo cartão acionável do chat).
 *  - HEURÍSTICO: a mensagem de erro casa os padrões de rate-limit/espera/crédito
 *    (reuso de lib/autoResume — mesmo detector do auto-resume).
 *  Falha recuperável → a missão PAUSA em recovery em vez de morrer. */
export function isRecoverableFailure(result: PhaseResult): boolean {
  if (result.ok) return false
  if (result.items.some((it) => it.kind === "limit")) return true
  if (result.error && matchesResumePattern(result.error)) return true
  return false
}

/** Mensagem humana do card de recuperação: explica a pausa e o que fazer. O
 *  sinal FORTE (limit) e o heurístico têm textos levemente diferentes. */
export function recoveryMessage(result: PhaseResult): string {
  const hitLimit = result.items.some((it) => it.kind === "limit")
  const base = hitLimit
    ? "A fase bateu num limite de uso do agent."
    : "A fase parou por limite de uso, espera ou crédito."
  return `${base} Escolha outro agent/modelo para retomar de onde parou (o worktree e o handoff já estão prontos).`
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
