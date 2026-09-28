// /compactar: o primeiro comando builtin do app. Compacta por CAPABILITY:
// - `nativeCompact` (claude): turno técnico com "/compact" literal por resume
//   nativo, sem doutrina nem expansão; o `compact_boundary` vira aviso no fio.
// - `sessionResume` sem compact nativo (codex): transplante para si mesmo,
//   sessão nova do mesmo motor com a memória por significado, ponteiro,
//   doutrina e persona. O fio continua; só o sessionId renova.
// - Sem `sessionResume` (opencode, model): nada a compactar, cada turno já é
//   sessão fresca com a memória do fio. Renovar seria teatro pago.
// As duas superfícies de envio interceptam antes da expansão de .md e chamam
// runCompactTurn: a coreografia de store, fila e persist fica aqui.

import { avisar, mensagemDe } from "@/lib/avisos"
import { agentLabel, runAgent } from "@/lib/agent"
import { agentDef, dispatchBlockReason } from "@/lib/agents"
import { blocoDaDoutrina, decideDoctrine, readDoctrine } from "@/lib/doctrine"
import { contextMeter, type ContextMeter } from "@/lib/contextMeter"
import { medirCompactacao } from "@/lib/engineContext"
import { memoriaDaConversa } from "@/lib/memoriaDaConversa"
import { orcamentoDaMemoria } from "@/lib/orcamentoDaMemoria"
import { hasAssistantReply, personaHandoffBlock } from "@/lib/presets"
import {
  exportConvContext,
  memoryPointerLine,
  renderTranscript,
} from "@/lib/transcript"
import { HUMANO } from "@/lib/sendOrigin"
import { useApp } from "@/store/app"
import {
  useChat,
  hasExecutorTurn,
  type ChatItem,
  type ConvState,
} from "@/store/chat"

/** O texto exato do caminho nativo (`claude -p --resume <sid> "/compact"`
 *  processa o comando em print mode). */
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
      "Nada para compactar: este motor roda cada turno numa sessão fresca e já recebe a memória essencial do fio a cada envio.",
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
    return `Compactar contexto: renova a sessão com a memória essencial do fio e um ponteiro para o histórico completo (o ${label} não compacta em modo headless).`
  }
  return "Este motor roda cada turno numa sessão fresca; não há contexto acumulado para compactar."
}

type ContextObservation = Pick<
  ConvState,
  "contextBasis" | "contextTokens" | "contextWindow" | "model"
>

function observedTokens(meter: ContextMeter): number | null {
  return meter.kind === "absolute" ||
    meter.kind === "incompatible" ||
    meter.kind === "ratio"
    ? meter.tokens
    : null
}

const exactTokens = (value: number) => value.toLocaleString("pt-BR")

/** Marco honesto no fio quando a renovação COMMITOU (o `session` novo chegou).
 *  Com snapshots confiáveis, mostra o antes/depois OBSERVADO. Sem snapshot,
 *  não converte custo/uso acumulado em contexto nem inventa percentual. */
export function renewalNotice(
  agent: string,
  before: ContextObservation,
  after: ContextObservation,
): string {
  const label = agentDef(agent)?.label ?? agent
  const oldMeter = contextMeter({
    basis: before.contextBasis,
    tokens: before.contextTokens,
    runtimeWindow: before.contextWindow,
    model: before.model,
  })
  const newMeter = contextMeter({
    basis: after.contextBasis,
    tokens: after.contextTokens,
    runtimeWindow: after.contextWindow,
    model: after.model,
  })
  const oldTokens = observedTokens(oldMeter)
  const newTokens = observedTokens(newMeter)
  if (oldMeter.kind === "ratio" && newMeter.kind === "ratio") {
    return `Sessão renovada com memória · contexto observado: ${Math.round(oldMeter.pct * 100)}% → ${Math.round(newMeter.pct * 100)}% (${exactTokens(oldMeter.tokens)} → ${exactTokens(newMeter.tokens)} tokens).`
  }
  if (oldTokens != null && newTokens != null) {
    return `Sessão renovada com memória · contexto observado: ${exactTokens(oldTokens)} → ${exactTokens(newTokens)} tokens.`
  }
  if (newMeter.kind === "ratio") {
    return `Sessão renovada com memória · novo contexto observado: ${Math.round(newMeter.pct * 100)}% (${exactTokens(newMeter.tokens)} tokens).`
  }
  if (newTokens != null) {
    return `Sessão renovada com memória · novo contexto observado: ${exactTokens(newTokens)} tokens.`
  }
  return `Sessão renovada com memória. O ${label} não informou uma medição comparável da nova sessão.`
}

/** Instrução fixa da retomada (fica FORA da moldura H3 da memória): a sessão é
 *  nova, o fio é o mesmo, e o turno só confirma a retomada. */
export const RENEWAL_INSTRUCTION =
  "Renovação de sessão do Frota para liberar contexto: a conversa do bloco acima continua AQUI, nesta sessão nova. Não repita trabalho já feito. Responda em uma linha confirmando que retomou o contexto e aguarde o próximo pedido."

/** Prompt da renovação: identidade → regras → memória emoldurada → instrução.
 *  Puro (o caller resolve persona/doutrina pelos canais certos). */
export function buildRenewalPrompt(opts: {
  /** Memória por significado + ponteiro — já vem com a moldura H3. */
  memory: string
  doctrineBlock?: string | null
  personaBlock?: string | null
}): string {
  return [opts.personaBlock, opts.doctrineBlock, opts.memory, RENEWAL_INSTRUCTION]
    .filter(Boolean)
    .join("\n\n")
}

/** Memória da renovação: seleção por SIGNIFICADO dentro do orçamento de uma
 *  janela vazia + endereço da memória plena. O ponteiro é obrigatório porque
 *  a projeção declara cortes e precisa oferecer recuperação real. */
export function buildRenewalMemory(opts: {
  items: ChatItem[]
  contextWindow: number | null
  pointer: string
}): string {
  const selected = memoriaDaConversa(
    opts.items,
    orcamentoDaMemoria(opts.contextWindow, "transplante"),
  ).texto
  return [selected, memoryPointerLine(opts.pointer)].join("\n\n")
}

/** Só afirma "Contexto compactado" quando o stream trouxe o marco real
 *  (compact_boundary, ADR-015); sem ele, a resposta do motor fica como veio.
 *  Puro. */
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
  avisar.erro(message)
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
    // O /compactar é um gesto SEU (digitado no composer ou no ⌘K), então ele
    // espera na fila do humano como qualquer mensagem sua (ADR-046).
    chat.enqueue(args.convId, args.commandText, [], HUMANO)
    return
  }
  const agent = conv.agent
  const plan = planCompact(agent, {
    hasExecutorTurn: hasExecutorTurn(conv.items),
    sessionId: conv.sessionId ?? null,
  })
  if (plan.mode === "none") {
    avisar.nota(plan.reason)
    return
  }
  // guarda de availability (F-A): compactar em CLI ausente/deslogada só rende
  // erro cru no fim do run.
  const blocked = dispatchBlockReason(
    agent,
    useApp.getState().settings.detected ?? {},
  )
  if (blocked) {
    avisar.erro(blocked)
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
    let accepted = false
    chat.beginPreparation(args.convId, runId)
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
        (e) => {
          if (e.type === "preflight_blocked") {
            chat.blockPreparation(args.convId, runId, e.gate)
            return
          }
          if (e.type === "run_manifest" && !accepted) {
            accepted = true
            chat.start(
              args.convId,
              args.commandText,
              runId,
              agent,
              conv.reqModel,
              conv.effort,
              [],
            )
            args.onStarted?.()
            chat.handleEvent(args.convId, {
              type: "notice",
              message: `compactar: comando ${plan.prompt} enviado ao ${label} (turno técnico)`,
            })
          }
          if (accepted) chat.handleEvent(args.convId, e)
        },
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
        // ADR-196: o motor mede o contexto resumido; o anel sai da medida velha.
        const message = await medirCompactacao(args.convId, cwd, outcome, conv.contextTokens)
        useChat.getState().handleEvent(args.convId, { type: "notice", message })
      }
    } catch (e) {
      if (accepted) recordCompactError(args.convId, e, "Falha ao compactar o contexto")
      else avisar.erro("Não consegui verificar as capacidades da compactação.")
    } finally {
      if (accepted) {
        chat.finish(args.convId)
        void chat.persist(args.convId)
        args.drainQueue?.()
      } else {
        chat.clearPreparation(args.convId, runId)
      }
    }
    return
  }

  // Renovação: transplante para si mesmo. Memória e transcript saem dos items
  // antes da bolha do comando; o commit em duas fases deixa a origem
  // retomável se falhar antes do `session` novo.
  const transcript = renderTranscript(conv.items, { agent: conv.agent })
  const hasReply = hasAssistantReply(conv.items)
  const prevSession = conv.sessionId
  const beforeContext: ContextObservation = {
    contextBasis: conv.contextBasis,
    contextTokens: conv.contextTokens,
    contextWindow: conv.contextWindow,
    model: conv.model,
  }
  let accepted = false
  chat.beginPreparation(args.convId, runId)
  try {
    // Fail-closed: sem memória plena recuperável, não abrimos mão da sessão de
    // origem. O erro ocorre antes do `runAgent`, então o transplante pendente é
    // descartado no finish e prevSession/contexto continuam retomáveis.
    let pointer: string
    try {
      pointer = await exportConvContext(cwd, args.convId, transcript)
    } catch {
      throw "Não foi possível salvar a memória completa; a sessão original foi preservada."
    }
    const memory = buildRenewalMemory({
      items: conv.items,
      contextWindow: conv.contextWindow ?? null,
      pointer,
    })
    // Sessão fresca não viu regra nenhuma: doutrina (freshSession) e persona
    // carimbada. Leituras best-effort; a preparação fica dentro do try, porque
    // um throw sem o finish deixaria a conversa "rodando".
    const doctrine = decideDoctrine({
      agent,
      block: blocoDaDoutrina(await readDoctrine(args.projectPath)),
      locked: true,
      hasReply,
      freshSession: true,
      lastFingerprint: useChat.getState().byId[args.convId]?.injected?.doctrine,
    })
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
      memory,
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
      (e) => {
        if (e.type === "preflight_blocked") {
          chat.blockPreparation(args.convId, runId, e.gate)
          return
        }
        if (e.type === "run_manifest" && !accepted) {
          accepted = true
          chat.beginTransplant(args.convId, runId, agent, {
            model: conv.reqModel,
            effort: conv.effort,
            user: { text: args.commandText, attachments: [] },
          })
          args.onStarted?.()
          chat.handleEvent(args.convId, {
            type: "notice",
            message: `compactar: preparando memória e renovando a sessão do ${label} (este motor não compacta em modo headless)`,
          })
          if (doctrine.fingerprint) {
            chat.recordInjectedFingerprint(
              args.convId,
              "doctrine",
              doctrine.fingerprint,
            )
          }
        }
        if (accepted) chat.handleEvent(args.convId, e)
      },
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
        message: renewalNotice(agent, beforeContext, after),
      })
    }
  } catch (e) {
    if (accepted) recordCompactError(args.convId, e, "Falha ao renovar a sessão")
    else avisar.erro("A renovação não foi iniciada.", { detalhe: mensagemDe(e) })
  } finally {
    if (accepted) {
      chat.finish(args.convId)
      void chat.persist(args.convId)
      args.drainQueue?.()
    } else {
      chat.clearPreparation(args.convId, runId)
    }
  }
}
