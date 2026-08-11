// /compactar — o primeiro comando BUILTIN do app (lib/slashCommands,
// APP_SLASH_COMMANDS): compacta o contexto da conversa por CAPABILITY do motor
// (H5/G1: nunca por nome).
//
// - Motor com `nativeCompact` (claude 2.1.220, §7.1 do agent-runner): turno
//   TÉCNICO com o texto literal "/compact" via resume nativo — sem doutrina,
//   sem preâmbulo, sem expansão de .md. O `compact_boundary` que voltar já
//   vira aviso no fio (ADR-015).
// - Motor sem a capability mas com `sessionResume` (codex): TRANSPLANTE PARA
//   SI MESMO na máquina do revezamento (beginTransplant + `session` commit):
//   sessão nativa NOVA do MESMO motor, prompt de retomada = recap comprimido
//   (serializeContext, moldura H3) + doutrina por decideDoctrine(freshSession)
//   + persona carimbada. O fio (items) continua o MESMO; só o sessionId renova.
// - Motor sem `sessionResume` (agy): NADA a compactar — cada turno já é sessão
//   fresca e o recap do fio já viaja a cada envio (buildMemoryPrompt). Renovar
//   seria teatro pago; a resposta é honesta.
//
// As duas superfícies de envio (ChatPanel.handleSend e lib/fleet/send)
// interceptam o /compactar ANTES da expansão de .md e chamam runCompactTurn —
// a coreografia de store/fila/persist fica aqui, uma vez só.

import { toast } from "sonner"
import { agentLabel, runAgent } from "@/lib/agent"
import { agentDef, dispatchBlockReason } from "@/lib/agents"
import { buildDoctrineBlock, decideDoctrine, readDoctrine } from "@/lib/doctrine"
import { serializeContext } from "@/lib/fusion"
import { hasAssistantReply, personaHandoffBlock } from "@/lib/presets"
import { useApp } from "@/store/app"
import { useChat, hasExecutorTurn, type ChatItem } from "@/store/chat"

/** O texto EXATO que o caminho nativo manda ao motor (empírico 04/08/2026:
 *  `claude -p --resume <sid> "/compact"` processa o comando em print mode). */
export const NATIVE_COMPACT_PROMPT = "/compact"

/** Limiar do anel de contexto (ADR-015): a partir daqui o popover do anel
 *  oferece a ação "Compactar contexto". Abaixo disso a ação seria ruído. */
export const COMPACT_OFFER_THRESHOLD = 0.7

/** O anel oferece a ação de compactar neste nível de uso? Puro (testável). */
export function offersCompactAction(pct: number): boolean {
  return pct >= COMPACT_OFFER_THRESHOLD
}

export type CompactPlan =
  | { mode: "native"; prompt: string }
  | { mode: "renew" }
  | { mode: "none"; reason: string }

/** Decide O QUE o /compactar faz nesta conversa — por capability, puro.
 *  Fail-closed no efeito: sem pré-condição (turnos, sessão), nada dispara. */
export function planCompact(
  agent: string,
  opts: { hasExecutorTurn: boolean; sessionId: string | null },
): CompactPlan {
  if (!opts.hasExecutorTurn) {
    return {
      mode: "none",
      reason: "Nada para compactar: a conversa ainda não tem turnos.",
    }
  }
  const def = agentDef(agent)
  if (def?.nativeCompact) {
    return opts.sessionId
      ? { mode: "native", prompt: NATIVE_COMPACT_PROMPT }
      : {
          mode: "none",
          reason:
            "Nada para compactar: a conversa não tem sessão nativa ativa.",
        }
  }
  if (def?.sessionResume) {
    return opts.sessionId
      ? { mode: "renew" }
      : {
          mode: "none",
          reason:
            "Nada para compactar: a conversa não tem sessão nativa ativa.",
        }
  }
  return {
    mode: "none",
    reason:
      "Nada para compactar: este motor roda cada turno numa sessão fresca e já recebe um resumo do fio a cada envio.",
  }
}

/** Tooltip da ação no anel de contexto: o que VAI acontecer, por motor. */
export function compactActionHint(agent: string): string {
  const def = agentDef(agent)
  const label = def?.label ?? agent
  if (def?.nativeCompact) {
    return `Compactar contexto: o ${label} compacta a própria sessão (o detalhe antigo vira resumo).`
  }
  if (def?.sessionResume) {
    return `Compactar contexto: renova a sessão com um resumo do fio (o ${label} não compacta em modo headless).`
  }
  return "Este motor roda cada turno numa sessão fresca; não há contexto acumulado para compactar."
}

/** Marco honesto no fio quando a renovação COMMITOU (o `session` novo chegou).
 *  Sem número inventado: quanto liberou não é mensurável num motor que não
 *  compacta em headless. */
export function renewalNotice(agent: string): string {
  const label = agentDef(agent)?.label ?? agent
  return `Sessão renovada com resumo: o quanto de contexto foi liberado não é mensurável (o ${label} não compacta em modo headless).`
}

/** Instrução fixa da retomada (fica FORA da moldura H3 do recap): a sessão é
 *  nova, o fio é o mesmo, e o turno só confirma a retomada. */
export const RENEWAL_INSTRUCTION =
  "Renovação de sessão do MyCockpit para liberar contexto: a conversa do bloco acima continua AQUI, nesta sessão nova. Não repita trabalho já feito. Responda em uma linha confirmando que retomou o contexto e aguarde o próximo pedido."

/** Prompt da renovação: identidade → regras → recap emoldurado → instrução.
 *  Puro (o caller resolve persona/doutrina pelos canais certos). */
export function buildRenewalPrompt(opts: {
  /** serializeContext(items) — já vem com a moldura H3 (frameHistory). */
  recap: string
  doctrineBlock?: string | null
  personaBlock?: string | null
}): string {
  return [opts.personaBlock, opts.doctrineBlock, opts.recap, RENEWAL_INSTRUCTION]
    .filter(Boolean)
    .join("\n\n")
}

/** Meta honesta do turno técnico nativo: só afirma "Contexto compactado"
 *  quando o stream trouxe o marco real (o Notice de compact_boundary que o
 *  adapter emite, ADR-015 — a copy contém "compactou"). Sem marco, nada é
 *  afirmado: a resposta do motor (ex. "Not enough messages to compact") fica
 *  no fio como veio. Puro. */
export function compactOutcomeNotice(itemsAdded: ChatItem[]): string | null {
  const compacted = itemsAdded.some(
    (it) =>
      it.kind === "notice" && it.message.toLowerCase().includes("compactou"),
  )
  return compacted ? "Contexto compactado." : null
}

export interface CompactRunArgs {
  convId: string
  projectId: string
  projectPath: string
  /** O que o humano digitou ("/compactar…") — vira a bolha do usuário. */
  commandText: string
  /** Disparado logo após o commit do start/beginTransplant (a superfície pode
   *  limpar rascunho / sinalizar aceite). */
  onStarted?: () => void
  /** Drenagem da fila da superfície ao fim do turno (paridade com o finally
   *  dos sends — mensagens digitadas durante a compactação não podem morrer). */
  drainQueue?: () => void
}

function recordCompactError(convId: string, error: unknown, fallback: string) {
  const message = typeof error === "string" ? error : fallback
  const conv = useChat.getState().byId[convId]
  const last = conv?.items[conv.items.length - 1]
  if (!last || last.kind !== "error" || last.message !== message) {
    useChat.getState().handleEvent(convId, { type: "error", message })
  }
  toast.error(message)
}

/** Executa o /compactar numa conversa PARADA (as superfícies já enfileiram
 *  quando há turno rodando; aqui só re-checa a corrida). Uma implementação
 *  para as duas superfícies — o que diverge (drenagem da fila, aceite) entra
 *  por callback. */
export async function runCompactTurn(args: CompactRunArgs): Promise<void> {
  const chat = useChat.getState()
  const conv = chat.byId[args.convId]
  if (!conv) return
  // corrida (mesma classe do D2 dos sends): um turno pode ter começado entre a
  // interceptação e este ponto → volta pra fila, nunca um run concorrente.
  if (conv.running || conv.finalizing) {
    chat.enqueue(args.convId, args.commandText)
    return
  }
  const agent = conv.agent
  const plan = planCompact(agent, {
    hasExecutorTurn: hasExecutorTurn(conv.items),
    sessionId: conv.sessionId ?? null,
  })
  if (plan.mode === "none") {
    toast(plan.reason)
    return
  }
  // guarda de availability (F-A): compactar em CLI ausente/deslogada só rende
  // erro cru no fim do run.
  const blocked = dispatchBlockReason(
    agent,
    useApp.getState().settings.detected ?? {},
  )
  if (blocked) {
    toast.error(blocked)
    return
  }
  const runId = crypto.randomUUID()
  const cwd = conv.worktreePath ?? args.projectPath
  const permission =
    useApp.getState().projects.find((p) => p.id === args.projectId)
      ?.permissionMode ?? "padrao"
  const label = agentLabel(agent)
  const itemsBefore = conv.items.length

  if (plan.mode === "native") {
    // Turno TÉCNICO: a bolha mostra o que você digitou; o prompt é o literal
    // "/compact" via resume — sem doutrina/persona/lições/fallback (qualquer
    // prefixo mataria a invocação, e recap num turno de compactação é ruído).
    chat.start(args.convId, args.commandText, runId, agent, conv.reqModel, conv.effort, [])
    args.onStarted?.()
    useChat.getState().handleEvent(args.convId, {
      type: "notice",
      message: `compactar: comando ${plan.prompt} enviado ao ${label} (turno técnico)`,
    })
    try {
      await runAgent(
        runId,
        args.convId,
        agent,
        conv.reqModel,
        conv.effort,
        plan.prompt,
        cwd,
        conv.sessionId,
        permission,
        [],
        (e) => useChat.getState().handleEvent(args.convId, e),
        false,
        null, // sem memoryFallback: prefixo de recap mataria a invocação
        null, // sem system prompt: turno técnico, nada de doutrina/persona
        useChat.getState().byId[args.convId]?.injected?.mcp ?? null,
      )
      const after = useChat.getState().byId[args.convId]
      const outcome = compactOutcomeNotice(
        (after?.items ?? []).slice(itemsBefore),
      )
      if (outcome) {
        useChat.getState().handleEvent(args.convId, {
          type: "notice",
          message: outcome,
        })
      }
    } catch (e) {
      recordCompactError(args.convId, e, "Falha ao compactar o contexto")
    } finally {
      useChat.getState().finish(args.convId)
      void useChat.getState().persist(args.convId)
      args.drainQueue?.()
    }
    return
  }

  // RENOVAÇÃO: transplante para si mesmo. O recap sai dos items ANTES da bolha
  // do comando (o /compactar não entra no próprio resumo); o commit em duas
  // fases do beginTransplant garante que falha ANTES do `session` novo deixa a
  // sessão de origem intacta e retomável.
  const recap = serializeContext(conv.items)
  const hasReply = hasAssistantReply(conv.items)
  const prevSession = conv.sessionId
  chat.beginTransplant(args.convId, runId, agent, {
    model: conv.reqModel,
    effort: conv.effort,
    user: { text: args.commandText, attachments: [] },
  })
  args.onStarted?.()
  useChat.getState().handleEvent(args.convId, {
    type: "notice",
    message: `compactar: renovando a sessão do ${label} com resumo (este motor não compacta em modo headless)`,
  })
  try {
    // sessão FRESCA nunca viu regra nenhuma: doutrina com freshSession (mesma
    // régua do wheel-switch) + persona carimbada da conversa. Best-effort nas
    // leituras (readDoctrine/personaHandoffBlock degradam pra null); a
    // preparação fica DENTRO do try — um throw aqui sem o finish deixaria a
    // conversa "rodando" pra sempre (teatro proibido).
    const doctrine = decideDoctrine({
      agent,
      block: buildDoctrineBlock((await readDoctrine(args.projectPath)).content),
      locked: true,
      hasReply,
      freshSession: true,
      lastFingerprint: useChat.getState().byId[args.convId]?.injected?.doctrine,
    })
    if (doctrine.fingerprint) {
      useChat
        .getState()
        .recordInjectedFingerprint(args.convId, "doctrine", doctrine.fingerprint)
    }
    let personaBlock = await personaHandoffBlock(
      conv.presetId,
      conv.presetDigest,
      args.projectPath,
    )
    let systemPrompt: string | null = null
    if (agentDef(agent)?.systemChannel) {
      systemPrompt =
        [personaBlock, doctrine.system].filter(Boolean).join("\n\n") || null
      personaBlock = null
    }
    const prompt = buildRenewalPrompt({
      recap,
      doctrineBlock: doctrine.body,
      personaBlock,
    })
    await runAgent(
      runId,
      args.convId,
      agent,
      conv.reqModel,
      conv.effort,
      prompt,
      cwd,
      null, // sessão FRESCA: renovar É abrir mão da sessão cheia
      permission,
      [],
      (e) => useChat.getState().handleEvent(args.convId, e),
      false,
      null,
      systemPrompt,
      useChat.getState().byId[args.convId]?.injected?.mcp ?? null,
    )
    // marco HONESTO: só afirma a renovação se o `session` novo commitou (o
    // beginTransplant descarta a intenção em falha e a origem fica intacta).
    const after = useChat.getState().byId[args.convId]
    if (after?.sessionId && after.sessionId !== prevSession) {
      useChat.getState().handleEvent(args.convId, {
        type: "notice",
        message: renewalNotice(agent),
      })
    }
  } catch (e) {
    recordCompactError(args.convId, e, "Falha ao renovar a sessão")
  } finally {
    useChat.getState().finish(args.convId)
    void useChat.getState().persist(args.convId)
    args.drainQueue?.()
  }
}
