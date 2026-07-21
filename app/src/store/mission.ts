// MOTOR do modo Mission (docs/mission-mode.md §3, M1): pipeline SEQUENCIAL de
// agents heterogêneos numa conversa. Store IRMÃO do useChat, modelado no
// store/fusion.ts (set síncrono, guarda anti-duplo-start, custo acumulado).
// Feature INDEPENDENTE do SDD — nada aqui importa lib/sdd.ts.
import { create } from "zustand"
import { cancelAgent } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import type {
  GateAnswer,
  MissionPhaseDef,
  MissionPhaseRun,
  MissionPreset,
  MissionRun,
  MissionStatus,
  RecoveryChoice,
} from "@/lib/missionTypes"
import { agentCaps } from "@/lib/agents"
import { notifyGate } from "@/lib/notify"
import { buildHandoff } from "@/lib/handoff"
import { loadGitDiff } from "@/lib/git"
import { insertDelivery } from "@/lib/db"
import {
  buildLearningBlocks,
  distillLesson,
  markLessonsUsed,
} from "@/lib/learning"
import { useApp } from "@/store/app"
import { useChat, type ChatItem } from "@/store/chat"
import {
  buildGateDecisionsBlock,
  checkBudget,
  gateQuestions,
  isRecoverableFailure,
  normalizeGateAnswers,
  phasePrompt,
  phaseText,
  recoveryMessage,
  reviewerApproved,
  runPhase,
  splitGateAttachments,
  type PhaseResult,
} from "@/lib/mission"
import {
  changedFilesRef,
  formatPriorHandoffs,
  handoffFileName,
  readHandoff,
  type PriorHandoff,
} from "@/lib/missionHandoff"

export interface MissionState {
  /** Missão por conversa (uma por vez; guarda anti-duplo-start no launch). */
  byConv: Record<string, MissionRun>

  launch: (
    convId: string,
    preset: MissionPreset,
    task: string,
    projectId: string,
    projectPath: string,
    permission: string,
    /** Anexos do launcher (imagem/PDF): só a FASE 1 recebe, junto da task —
     *  mesmo caminho frontend do handleSend (nenhuma mudança em Rust). */
    attachments?: Attachment[],
  ) => Promise<void>

  abort: (convId: string) => void

  clear: (convId: string) => void

  /** Gate humano: entrega as respostas do usuário e RETOMA a missão pausada.
   *  answers[i] corresponde a gate.questions[i] (em branco = agente decide).
   *  Aceita GateAnswer[] (rico: texto + anexos) OU string[] legado — a UI atual
   *  segue funcionando; anexos vão pro runPhase da PRÓXIMA fase (filtrados pelo
   *  agentCaps do agent dela; não suportado ⇒ notice, nunca erro). */
  answerGate: (convId: string, answers: GateAnswer[] | string[]) => void

  /** Recuperação: o usuário escolheu outro agent/modelo/effort → troca a def da
   *  fase corrente e RE-RODA a MESMA fase (sem avançar). No-op se não há
   *  recovery pendente. */
  resolveRecovery: (convId: string, choice: RecoveryChoice) => void

  /** Recuperação: o usuário desistiu → a missão vai a error (resolve com null,
   *  mesmo efeito de não escolher agent). No-op se não há recovery pendente. */
  abortRecovery: (convId: string) => void
}

/** Máx. de rodadas de correção quando o reviewer reprova (cada uma = executor
 *  corretivo + re-review). Limita custo/loop; o teto de US$ ainda vale por cima. */
const MAX_REVIEW_LOOPS = 2

/** MissionRun em execução ainda tem fase corrente rodando/na fila. */
function isActive(status: MissionStatus): boolean {
  return status === "running"
}

/** Cria o registro de fase (MissionPhaseRun) em estado inicial (fila). */
function queuedRun(def: MissionPhaseDef): MissionPhaseRun {
  return { def, status: "queued", attempt: 1, costUsd: 0, startedAt: null }
}

/** Acha a def do executor mais recente ANTES do índice `i` (p/ reinjetar a
 *  correção). null se não houver executor antes do reviewer. */
function lastExecutorBefore(
  phases: MissionPhaseDef[],
  i: number,
): MissionPhaseDef | null {
  for (let j = i - 1; j >= 0; j--) {
    if (phases[j].persona === "executor") return phases[j]
  }
  return null
}

/** runId estável por fase p/ cancelamento (index-based, uma missão por conv). */
function phaseRunId(missionId: string, phaseIdx: number): string {
  return `${missionId}::phase-${phaseIdx}`
}

// ── Histórico persistente da missão (pendência M2 do docs/mission-mode.md):
// a missão roda em memória (byConv), então sem gravar nada a conversa reabria
// VAZIA após restart. Gravamos nos MARCOS (launch/fase/gate/recovery/fim) via
// useChat.appendItems — barato e legível, não é o transcript pleno das fases.

/** Tamanho máx. do resumo de fase gravado na conversa (o transcript inteiro
 *  não cabe e não é o objetivo dos marcos). */
const PHASE_SUMMARY_MAX = 2000

/** Trunca o resumo de fase no teto (com reticências). */
function summarize(text: string): string {
  return text.length > PHASE_SUMMARY_MAX
    ? `${text.slice(0, PHASE_SUMMARY_MAX)}…`
    : text
}

function noticeItem(message: string): ChatItem {
  return { kind: "notice", id: crypto.randomUUID(), message }
}

/** Grava itens de MARCO no fio da conversa. BEST-EFFORT: falha de persistência
 *  NUNCA derruba a missão (o run em memória segue sendo a fonte da timeline);
 *  o appendItems já no-opa se a conversa não está carregada (launcher garante). */
async function recordHistory(convId: string, items: ChatItem[]): Promise<void> {
  try {
    await useChat.getState().appendItems(convId, items)
  } catch (err) {
    console.warn("[missão] falha ao gravar histórico na conversa:", err)
  }
}

/** Gate humano: resolvedores das missões pausadas (por missionId). O loop do
 *  launch fica aguardando; answerGate resolve com as respostas (já normalizadas
 *  p/ GateAnswer[]), abort com null. */
const gateWaiters = new Map<string, (answers: GateAnswer[] | null) => void>()

/** Recuperação: resolvedores das missões pausadas numa falha recuperável (por
 *  missionId). MESMO padrão do gate — o while da fase aguarda; resolveRecovery
 *  resolve com a escolha (re-roda), abortRecovery/abort resolvem com null
 *  (desiste). */
const recoveryWaiters = new Map<string, (choice: RecoveryChoice | null) => void>()

export const useMission = create<MissionState>((set, get) => {
  /** Patch parcial do MissionRun de UMA conversa (no-op se não existir). */
  const patchConv = (
    convId: string,
    p: Partial<MissionRun> | ((cur: MissionRun) => Partial<MissionRun>),
  ) =>
    set((s) => {
      const cur = s.byConv[convId]
      if (!cur) return {}
      const partial = typeof p === "function" ? p(cur) : p
      return { byConv: { ...s.byConv, [convId]: { ...cur, ...partial } } }
    })

  /** Patch de UMA fase (pelo índice) dentro do MissionRun. */
  const patchPhase = (
    convId: string,
    phaseIdx: number,
    fn: (p: MissionPhaseRun) => MissionPhaseRun,
  ) =>
    patchConv(convId, (cur) => ({
      phases: cur.phases.map((ph, i) => (i === phaseIdx ? fn(ph) : ph)),
    }))

  /** Marco terminal de ERRO no fio: result !ok com o custo total + motivo. */
  const recordError = (convId: string, reason: string) => {
    const cost = get().byConv[convId]?.costTotal ?? 0
    return recordHistory(convId, [
      {
        kind: "result",
        id: crypto.randomUUID(),
        ok: false,
        costUsd: cost,
        text: `Missão interrompida: ${reason}`,
      },
    ])
  }

  return {
    byConv: {},

    launch: async (
      convId,
      preset,
      task,
      projectId,
      projectPath,
      permission,
      attachments = [],
    ) => {
      // guarda anti-duplo-start (padrão do Fusion): missão rodando → ignora.
      const existing = get().byConv[convId]
      if (existing && isActive(existing.status)) return

      // cwd: worktree da conversa se houver, senão a pasta do projeto.
      const conv = useChat.getState().byId[convId]
      const cwd = conv?.worktreePath ?? projectPath

      // Modelo helper (Haiku) p/ destilar lições (M2). Config por projeto vence o
      // default global; null = destilação desligada (mesma regra das sugestões).
      const appState = useApp.getState()
      const projCfg = appState.mycockpit[projectId]
      const helperModel = projCfg
        ? projCfg.helper
        : appState.settings.helperModel

      const missionId = crypto.randomUUID()
      const run: MissionRun = {
        id: missionId,
        convId,
        presetName: preset.name,
        task,
        phases: preset.phases.map((def) => ({
          def,
          status: "queued",
          attempt: 1,
          costUsd: 0,
          startedAt: null,
        })),
        current: 0,
        costTotal: 0,
        // teto do preset EFETIVO: o launcher pode ter sobrescrito o teto (e as
        // fases) editados no dialog — mesmo caminho, nada além do preset viaja.
        maxCostUsd: preset.maxCostUsd,
        status: "running",
        startedAt: Date.now(),
      }
      set((s) => ({ byConv: { ...s.byConv, [convId]: run } }))

      // marco: largada no fio da conversa (task + resumo do preset). O launcher
      // já garantiu byId (ensureConversationLoaded) — Escritório e Trabalho.
      await recordHistory(convId, [
        {
          kind: "user",
          id: crypto.randomUUID(),
          text: task,
          attachments: attachments.length ? attachments : undefined,
        },
        noticeItem(
          `🚀 Missão iniciada · preset ${preset.name} · ${preset.phases.length} fases`,
        ),
      ])

      // itens da fase anterior (p/ fallback do handoff) — o diff sai do worktree.
      let prevItems: ChatItem[] = []
      // lista MUTÁVEL: o loop de correção do M2 acrescenta fases (executor
      // corretivo + re-review) quando o reviewer reprova, até MAX_REVIEW_LOOPS.
      const phases: MissionPhaseDef[] = [...preset.phases]
      let reviewLoops = 0
      // M2: feedbacks de reprovação do reviewer que dispararam correção. Só
      // destilamos lição se a missão terminar "done" (a correção foi REAL e
      // resolvida — evento de alto sinal reprovado→corrigido→aprovado).
      const corrections: string[] = []
      // M1: matéria-prima da entrega (gravada no fim, se "done"). O plano vem do
      // 1º planner; agent/model do 1º executor (quem de fato mexeu no código).
      let plannerSummary = ""
      let execAgent = ""
      let execModel: string | null = null
      // Gate humano: bloco de decisões do usuário — SÓ a fase seguinte ao gate
      // recebe (zera depois de usar).
      let gateDecisions: string | null = null
      // Gate rico: anexos das respostas (já filtrados pelo agentCaps da próxima
      // fase no answerGate) — mesma regra: SÓ a fase seguinte recebe.
      let gateAttachments: Attachment[] = []
      let i = 0

      while (i < phases.length) {
        // abortada por fora (byConv sumiu ou marcada aborted) → para o loop.
        const now = get().byConv[convId]
        if (!now || now.status !== "running") return

        // budget HARD antes de gastar na próxima fase (risco nº1 do design).
        const budget = checkBudget(now.costTotal, now.maxCostUsd)
        if (!budget.ok) {
          patchConv(convId, { status: "error", current: i })
          patchPhase(convId, i, (ph) => ({
            ...ph,
            status: "error",
            error: budget.reason,
          }))
          await recordError(convId, budget.reason ?? "orçamento esgotado")
          return
        }

        const def = phases[i]
        const handoffPath = handoffFileName(i, def.persona)

        // fase 1 = task pura; fases seguintes = blackboard tipado (.mission/*.json
        // que os agentes escreveram) + lista LEVE de arquivos mudados. O código
        // não viaja no prompt — está no worktree. Se ninguém emitiu JSON, cai no
        // fallback do tail do transcript (buildHandoff).
        let priorHandoffs: string | null = null
        let changedFiles: string | null = null
        let fallbackContext: string | null = null
        if (i > 0) {
          const priors: PriorHandoff[] = []
          for (let j = 0; j < i; j++) {
            const pdef = phases[j]
            const doc = await readHandoff(cwd, handoffFileName(j, pdef.persona))
            if (doc) priors.push({ label: pdef.label, persona: pdef.persona, doc })
          }
          if (priors.length > 0) priorHandoffs = formatPriorHandoffs(priors)
          else fallbackContext = buildHandoff(prevItems)
          changedFiles = changedFilesRef(await loadGitDiff(cwd))
        }

        // M1/M2 — injeta o que o projeto já aprendeu. Recall só no planner
        // (alimenta o plano); lições em planner E executor. Best-effort: falha
        // de DB degrada p/ blocos nulos (buildLearningBlocks já é tolerante).
        const learn = await buildLearningBlocks(
          projectId,
          task,
          def.persona === "planner",
        )
        if (learn.lessonIds.length) void markLessonsUsed(learn.lessonIds)

        const prompt = phasePrompt({
          persona: def.persona,
          task,
          handoffPath,
          priorHandoffs,
          changedFiles,
          fallbackContext,
          instructions: def.instructions,
          recallBlock: learn.recall,
          lessonsBlock: learn.lessons,
          userDecisions: gateDecisions,
        })
        gateDecisions = null // só a fase imediatamente após o gate recebe
        // anexos do gate: consumidos aqui (fase seguinte ao gate) e zerados —
        // um re-run por recuperação da MESMA fase ainda os recebe (phaseAtts).
        const phaseGateAtts: Attachment[] | undefined =
          gateAttachments.length > 0 ? gateAttachments : undefined
        gateAttachments = []

        patchConv(convId, { current: i })
        patchPhase(convId, i, (ph) => ({
          ...ph,
          status: "running",
          startedAt: Date.now(),
        }))

        // ── RECUPERAÇÃO: re-roda a MESMA fase i (mesmo prompt, sem i++) quando a
        // falha é RECUPERÁVEL (limite/rate-limit/crédito) e o usuário escolhe
        // outro agent. Espelha o gate: pausa em recovery e aguarda a escolha. O
        // custo é REAL a cada tentativa (soma todas), o prompt não muda entre
        // elas — só o agent/modelo/effort da def da fase corrente.
        let result: PhaseResult
        while (true) {
          const cur = phases[i]
          result = await runPhase({
            runId: phaseRunId(missionId, i),
            convId,
            agent: cur.agent,
            model: cur.model,
            effort: cur.effort,
            prompt,
            cwd,
            permission,
            maxRetries: cur.maxRetries,
            // anexos: 1ª fase (i === 0) = os do launcher, junto do pedido
            // original; fase seguinte a um GATE = os das respostas ricas
            // (phaseGateAtts). As demais herdam o contexto pelo handoff/worktree.
            attachments: i === 0 ? attachments : phaseGateAtts,
            onProgress: (attempt, items) =>
              patchPhase(convId, i, (ph) => ({ ...ph, attempt, items } as MissionPhaseRun)),
          })

          // abortada DURANTE a fase (o run saiu por cancel) → não sobrescreve.
          const after = get().byConv[convId]
          if (!after || after.status !== "running") return

          // custo acumulado da fase E da missão — cada tentativa gastou de fato.
          patchConv(convId, (c) => ({ costTotal: c.costTotal + result.costUsd }))

          if (result.ok) {
            patchPhase(convId, i, (ph) => ({
              ...ph,
              status: "done",
              costUsd: ph.costUsd + result.costUsd,
              error: undefined,
            }))
            break
          }

          // falha NÃO-recuperável (bug, timeout, cancel) → kill atual: a fase e a
          // missão vão a error e o loop morre (comportamento herdado).
          if (!isRecoverableFailure(result)) {
            patchPhase(convId, i, (ph) => ({
              ...ph,
              status: "error",
              costUsd: ph.costUsd + result.costUsd,
              error: result.error,
            }))
            patchConv(convId, { status: "error", current: i })
            await recordError(convId, result.error ?? "falha na fase")
            return
          }

          // falha RECUPERÁVEL → PAUSA em recovery e aguarda a escolha do usuário.
          patchPhase(convId, i, (ph) => ({
            ...ph,
            status: "error",
            costUsd: ph.costUsd + result.costUsd,
            error: result.error,
          }))
          patchConv(convId, {
            recovery: {
              phase: i,
              error: result.error ?? "falha recuperável",
              message: recoveryMessage(result),
            },
          })
          const choice = await new Promise<RecoveryChoice | null>((resolve) => {
            recoveryWaiters.set(missionId, resolve)
          })
          recoveryWaiters.delete(missionId)
          // abortada por fora durante a espera (abort/clear resolveram null e já
          // marcaram aborted): não força error, só sai do loop da missão.
          const still = get().byConv[convId]
          if (!still || still.status !== "running") return
          patchConv(convId, { recovery: null })
          if (choice === null) {
            // desistiu (abortRecovery) → a missão vai a error, como antes.
            patchConv(convId, { status: "error", current: i })
            await recordError(
              convId,
              result.error ?? "fase parou por limite (recuperação abandonada)",
            )
            return
          }
          // budget HARD também no re-run (o checkBudget do topo só roda ao ENTRAR
          // numa fase nova; sem isto o teto seria furado ao retomar — o caminho
          // mais caro é justamente re-rodar a fase que falhou). Recusa a
          // recuperação já estourada em vez de gastar e só então morrer.
          const rebud = checkBudget(still.costTotal, still.maxCostUsd)
          if (!rebud.ok) {
            patchPhase(convId, i, (ph) => ({
              ...ph,
              status: "error",
              error: rebud.reason,
            }))
            patchConv(convId, { status: "error", current: i })
            await recordError(convId, rebud.reason ?? "orçamento esgotado")
            return
          }
          // marco: a pausa por limite + retomada com o agent escolhido no fio.
          await recordHistory(convId, [
            noticeItem(
              `Fase ${i + 1} · ${phases[i].label} parou por limite; retomada com ${choice.agent}`,
            ),
          ])
          // troca a def da fase corrente e RE-RODA a MESMA fase (volta ao topo do
          // while). O índice i NÃO avança; o prompt já montado é reusado.
          phases[i] = {
            ...phases[i],
            agent: choice.agent,
            model: choice.model,
            effort: choice.effort,
          }
          patchPhase(convId, i, (ph) => ({
            ...ph,
            def: {
              ...ph.def,
              agent: choice.agent,
              model: choice.model,
              effort: choice.effort,
            },
            status: "running",
            attempt: 1,
            startedAt: Date.now(),
            error: undefined,
          }))
        }

        prevItems = result.items

        // marco: fase concluída → notice (label/agent/custo) + resumo CURTO da
        // fase no fio (phaseText truncado — o transcript pleno não é o objetivo).
        {
          const phCost =
            get().byConv[convId]?.phases[i]?.costUsd ?? result.costUsd
          const marks: ChatItem[] = [
            noticeItem(
              `Fase ${i + 1}/${phases.length} · ${phases[i].label} (${phases[i].agent}) — concluída · US$ ${phCost.toFixed(2)}`,
            ),
          ]
          const summary = phaseText(result.items)
          if (summary) {
            marks.push({
              kind: "text",
              id: crypto.randomUUID(),
              text: summarize(summary),
            })
          }
          await recordHistory(convId, marks)
        }

        // M1: captura o plano (1º planner) e o executor (1º executor) p/ a
        // entrega. `phaseText` já filtra só o texto (sem tool calls). O agent do
        // executor sai de phases[i] (pode ter trocado na recuperação).
        if (def.persona === "planner" && !plannerSummary) {
          plannerSummary = phaseText(result.items)
        }
        if (def.persona === "executor" && !execAgent) {
          execAgent = phases[i].agent
          execModel = phases[i].model
        }

        // M2 — loop de correção: reviewer terminou mas NÃO aprovou → reinjeta as
        // correções num executor corretivo + re-review, até MAX_REVIEW_LOOPS
        // (e sempre sob o teto de custo, checado no topo do while).
        if (
          def.persona === "reviewer" &&
          reviewLoops < MAX_REVIEW_LOOPS &&
          !reviewerApproved(result.items)
        ) {
          const execDef = lastExecutorBefore(phases, i)
          if (execDef) {
            reviewLoops++
            const round = reviewLoops
            const feedback = phaseText(result.items)
            corrections.push(feedback)
            const corrective: MissionPhaseDef = {
              ...execDef,
              id: `fix-${round}-${missionId.slice(0, 6)}`,
              label: `Corrigir (rodada ${round})`,
              instructions:
                "O reviewer NÃO aprovou. Corrija exatamente estes pontos e nada " +
                `além do necessário:\n\n${feedback}`,
            }
            const rereview: MissionPhaseDef = {
              ...phases[i],
              id: `rereview-${round}-${missionId.slice(0, 6)}`,
              label: `Revisar (rodada ${round})`,
            }
            phases.push(corrective, rereview)
            patchConv(convId, (cur) => ({
              phases: [
                ...cur.phases,
                queuedRun(corrective),
                queuedRun(rereview),
              ],
            }))
          }
        }

        // ── GATE HUMANO: a fase deixou perguntas em aberto e HÁ próxima fase →
        // PAUSA a missão até o usuário responder (answerGate). As respostas
        // viram diretriz no prompt da próxima fase. Abortar resolve com null.
        const handoffDoc = await readHandoff(cwd, handoffPath)
        const questions = gateQuestions(
          handoffDoc?.open_questions,
          i + 1 < phases.length,
        )
        if (questions.length > 0) {
          const stillRunning = get().byConv[convId]
          if (!stillRunning || stillRunning.status !== "running") return
          patchConv(convId, { gate: { phase: i, questions } })
          // notificação nativa: o gate ABRIU — a missão está parada esperando
          // você, em qualquer modo/app em background. 1 por gate (só aqui).
          {
            const projName =
              useApp.getState().projects.find((p) => p.id === projectId)?.name ??
              ""
            notifyGate(convId, projName, phases[i].label)
          }
          // waiter registrado ANTES do record: o await do marco não pode abrir
          // janela pro answerGate resolver no vazio.
          const waiter = new Promise<GateAnswer[] | null>((resolve) => {
            gateWaiters.set(missionId, resolve)
          })
          // marco: perguntas do gate no fio.
          await recordHistory(convId, [
            noticeItem(
              `⏸️ Gate humano — a fase ${i + 1} deixou perguntas:\n${questions.map((q, k) => `${k + 1}. ${q}`).join("\n")}`,
            ),
          ])
          const answers = await waiter
          gateWaiters.delete(missionId)
          patchConv(convId, { gate: null })
          if (answers === null) return // abortada durante o gate
          gateDecisions = buildGateDecisionsBlock(
            questions,
            answers.map((a) => a.text),
          )
          // anexos das respostas → runPhase da PRÓXIMA fase, filtrados pelo
          // caps do agent dela (não suportado ⇒ descarta com notice, sem erro).
          const nextAgent = phases[i + 1]?.agent ?? ""
          const split = splitGateAttachments(answers, agentCaps(nextAgent))
          gateAttachments = split.kept
          // marco: respostas do usuário no fio (em branco = agente decide;
          // resposta com anexos ganha o sufixo "+ N anexos").
          const answered = questions.map((_q, k) => {
            const a = answers[k]
            const text =
              (a?.text ?? "").trim() || "(sem resposta — o agente decide)"
            const n = a?.attachments?.length ?? 0
            return `${k + 1}. ${text}${n > 0 ? ` (+ ${n} ${n === 1 ? "anexo" : "anexos"})` : ""}`
          })
          const marks: ChatItem[] = [
            noticeItem(`▶️ Gate respondido:\n${answered.join("\n")}`),
          ]
          if (split.dropped.length > 0) {
            marks.push(
              noticeItem(
                `⚠️ ${split.dropped.length} ${split.dropped.length === 1 ? "anexo descartado" : "anexos descartados"} — ${nextAgent} não suporta: ${split.dropped.map((d) => d.name).join(", ")}`,
              ),
            )
          }
          await recordHistory(convId, marks)
        }

        i++
      }

      // todas as fases passaram → done, current aponta além do fim.
      const finalCost = get().byConv[convId]?.costTotal ?? 0
      patchConv(convId, { status: "done", current: phases.length })

      // ── Resumo estruturado da conclusão (UI "concluída"): intenção + arquivos
      // + pendências, do handoff mais RECENTE que existir. Best-effort.
      try {
        for (let j = phases.length - 1; j >= 0; j--) {
          const doc = await readHandoff(cwd, handoffFileName(j, phases[j].persona))
          if (doc) {
            patchConv(convId, {
              doneSummary: {
                intent: doc.intent || null,
                openQuestions: doc.open_questions ?? [],
                filesTouched: doc.files_touched ?? [],
              },
            })
            break
          }
        }
      } catch {
        // sem resumo estruturado — a UI cai no texto final da fase.
      }

      // marco: conclusão no fio — result (ok + custo total) + o doneSummary
      // (veredito/arquivos/pendências) quando houver.
      {
        const ds = get().byConv[convId]?.doneSummary
        const marks: ChatItem[] = [
          {
            kind: "result",
            id: crypto.randomUUID(),
            ok: true,
            costUsd: finalCost,
            text: `Missão concluída · preset ${preset.name}`,
          },
        ]
        const lines: string[] = []
        if (ds?.intent) lines.push(ds.intent)
        if (ds?.filesTouched.length)
          lines.push(`Arquivos: ${ds.filesTouched.join(", ")}`)
        if (ds?.openQuestions.length)
          lines.push(
            `Pendências:\n${ds.openQuestions.map((q) => `- ${q}`).join("\n")}`,
          )
        if (lines.length) {
          marks.push({
            kind: "text",
            id: crypto.randomUUID(),
            text: lines.join("\n\n"),
          })
        }
        await recordHistory(convId, marks)
      }

      // ── M1: grava a ENTREGA (evento de alto sinal: passou nos gates) ──
      // Arquivos = paths do diff do worktree; fallback = files_touched dos
      // handoffs .mission/. Best-effort: nada aqui pode quebrar o "done".
      try {
        let files: string[] = []
        const diff = await loadGitDiff(cwd)
        if (diff.isRepo && diff.files.length) {
          files = diff.files.map((f) => f.path)
        } else {
          const seen = new Set<string>()
          for (let j = 0; j < phases.length; j++) {
            const doc = await readHandoff(cwd, handoffFileName(j, phases[j].persona))
            for (const f of doc?.files_touched ?? []) seen.add(f)
          }
          files = [...seen]
        }
        await insertDelivery({
          projectId,
          task,
          planSummary: plannerSummary,
          filesTouched: files,
          costUsd: finalCost,
          agent: execAgent,
          model: execModel,
        })
      } catch {
        // entrega não gravada não invalida a missão — só perde o recall futuro.
      }

      // ── M2: destila UMA lição das correções REAIS que foram resolvidas ──
      // Estágio 1 do funil: distillLesson grava como CANDIDATE (não injeta até
      // ser promovida na auditoria) — sinal do loop é mais fraco que o save
      // explícito do Linear.
      if (corrections.length && helperModel) {
        void distillLesson({
          projectId,
          cwd,
          helperModel,
          reviewerFeedback: corrections.join("\n\n---\n\n"),
        })
      }
    },

    // Stop de verdade: cancela o run da fase corrente via cancel_agent e marca
    // aborted; fases feitas ficam no estado (nada se perde — está no worktree).
    // Se estava PAUSADA num gate, libera o loop (resolve com null).
    abort: (convId) => {
      const run = get().byConv[convId]
      if (!run || !isActive(run.status)) return
      const idx = run.current
      if (idx >= 0 && idx < run.phases.length) {
        void cancelAgent(phaseRunId(run.id, idx))
      }
      patchConv(convId, (cur) => ({
        status: "aborted",
        gate: null,
        recovery: null,
        phases: cur.phases.map((ph, i) =>
          i === idx && ph.status === "running" ? { ...ph, status: "aborted" } : ph,
        ),
      }))
      // libera o loop se estava pausado num gate OU numa recuperação (resolve
      // null; o while checa status !== "running" e sai sem forçar error).
      gateWaiters.get(run.id)?.(null)
      recoveryWaiters.get(run.id)?.(null)
      // marco terminal no fio (fire-and-forget: nunca segura o Stop; o
      // appendItems no-opa se a conversa já saiu de byId, ex. deleção).
      void recordHistory(convId, [
        {
          kind: "result",
          id: crypto.randomUUID(),
          ok: false,
          costUsd: run.costTotal,
          text: "Missão interrompida pelo usuário (Stop)",
        },
      ])
    },

    clear: (convId) =>
      set((s) => {
        // gate/recovery pendente em missão descartada → libera o loop (null).
        const run = s.byConv[convId]
        if (run) {
          gateWaiters.get(run.id)?.(null)
          recoveryWaiters.get(run.id)?.(null)
        }
        const rest = { ...s.byConv }
        delete rest[convId]
        return { byConv: rest }
      }),

    answerGate: (convId, answers) => {
      const run = get().byConv[convId]
      if (!run?.gate) return
      // string[] legado (UI atual) vira GateAnswer[] sem anexos — retrocompat.
      gateWaiters.get(run.id)?.(normalizeGateAnswers(answers))
    },

    resolveRecovery: (convId, choice) => {
      const run = get().byConv[convId]
      if (!run?.recovery) return
      recoveryWaiters.get(run.id)?.(choice)
    },

    abortRecovery: (convId) => {
      const run = get().byConv[convId]
      if (!run?.recovery) return
      recoveryWaiters.get(run.id)?.(null)
    },
  }
})
