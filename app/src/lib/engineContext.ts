// Limiar de compactação lido do PRÓPRIO motor (ADR-196). A sonda Rust
// (`read_engine_context`) roda fora do turno; aqui mora quem decide QUANDO
// perguntar e por quanto tempo a resposta vale.
//
// Quando: o anel visível sem leitura para esta sessão e modelo (aquecimento),
// o popover aberto (gesto) e o fim de uma compactação (a medida velha morreu).
// Nunca no envio e nunca junto de um turno da mesma sessão.
//
// Validade: a leitura é da SESSÃO e do MODELO em que foi feita. Trocou um dos
// dois, ela não vale mais e o anel volta a usar a janela, sem afirmar limiar.
// Leitura com contagem própria do motor (agy) vale também só para o nível de
// contexto em que foi feita: o turno seguinte muda a estimativa, e o anel relê.

import { invoke } from "@tauri-apps/api/core"
import { create } from "zustand"
import { contextCeilingProbe } from "@/lib/agentContext"
import type { ContextCeiling, ContextCeilingOrigin } from "@/lib/contextMeter"
import { agentDef } from "@/lib/agents"
import { useChat, type ConvState } from "@/store/chat"

export interface EngineContextCategory {
  name: string
  tokens: number
  kind: string
}

/** Espelho de `context_probe::EngineContext` no Rust. */
export interface EngineContext {
  /** Footprint da sessão segundo o motor, quando ele informa (Claude). */
  totalTokens: number | null
  /** Contagem própria que o motor compara ao limiar (agy). */
  engineEstimate: number | null
  maxTokens: number | null
  autoCompactThreshold: number | null
  autoCompactEnabled: boolean
  source: string | null
  origin: ContextCeilingOrigin
  model: string | null
  categories: EngineContextCategory[]
  observedAt: number
}

export interface EngineContextEntry {
  sessionId: string
  model: string | null
  /** Nível de contexto da conversa quando a leitura foi pedida. */
  contextTokens: number | null
  /** Última leitura boa. Falha posterior preserva o que se sabia. */
  reading: EngineContext | null
  /** Motivo da última falha, exibido no popover. null = a última deu certo. */
  error: string | null
}

interface EngineContextStore {
  byConv: Record<string, EngineContextEntry>
  record: (convId: string, entry: EngineContextEntry) => void
}

export const useEngineContext = create<EngineContextStore>((set) => ({
  byConv: {},
  record: (convId, entry) =>
    set((s) => ({ byConv: { ...s.byConv, [convId]: entry } })),
}))

/** A entrada vale para esta conversa AGORA? Puro. */
export function entryFor(
  conv: Pick<ConvState, "sessionId" | "reqModel" | "contextTokens">,
  entry: EngineContextEntry | undefined,
): EngineContextEntry | null {
  if (!entry || !conv.sessionId) return null
  if (entry.sessionId !== conv.sessionId || entry.model !== conv.reqModel) return null
  if (
    entry.reading?.engineEstimate != null &&
    entry.contextTokens !== (conv.contextTokens ?? null)
  ) {
    return null
  }
  return entry
}

/** Leitura → teto do medidor. Ligada sem limiar não afirma nada. Puro. */
export function ceilingFrom(
  reading: EngineContext | null | undefined,
): ContextCeiling | null {
  if (!reading) return null
  if (reading.autoCompactEnabled && reading.autoCompactThreshold) {
    return {
      kind: "autocompact",
      tokens: reading.autoCompactThreshold,
      origin: reading.origin,
      ...(reading.engineEstimate != null ? { engineCount: reading.engineEstimate } : {}),
    }
  }
  return reading.autoCompactEnabled || reading.maxTokens == null
    ? null
    : { kind: "sem-autocompact", tokens: reading.maxTokens, origin: reading.origin }
}

const inFlight = new Map<string, Promise<EngineContext | null>>()

/** Pergunta ao motor, uma vez por (conversa, sessão, modelo) em voo.
 *  `turnoEncerrado`: o chamador garante que o processo do turno já saiu (fim
 *  da compactação, antes do `finish`). Fora disso, turno rodando = não pergunta. */
export function refreshEngineContext(
  convId: string,
  cwd: string,
  opts: { turnoEncerrado?: boolean } = {},
): Promise<EngineContext | null> {
  const conv = useChat.getState().byId[convId]
  if (!conv?.sessionId || !contextCeilingProbe(conv.agent)) {
    return Promise.resolve(null)
  }
  if (!opts.turnoEncerrado && (conv.running || conv.finalizing)) {
    return Promise.resolve(null)
  }
  const sessionId = conv.sessionId
  const model = conv.reqModel
  const contextTokens = conv.contextTokens ?? null
  const key = JSON.stringify([convId, sessionId, model, contextTokens])
  const pending = inFlight.get(key)
  if (pending) return pending
  const previous = entryFor(conv, useEngineContext.getState().byConv[convId])
  const work = invoke<EngineContext | null>("read_engine_context", {
    agent: conv.agent,
    cwd,
    sessionId,
    model,
    // Codex mede pelo modelo que rodou, não pela sentinela "Padrão".
    resolvedModel: conv.model,
  })
    .then((reading) => {
      useEngineContext
        .getState()
        .record(convId, { sessionId, model, contextTokens, reading, error: null })
      return reading
    })
    .catch((error: unknown) => {
      useEngineContext.getState().record(convId, {
        sessionId,
        model,
        contextTokens,
        reading: previous?.reading ?? null,
        error:
          typeof error === "string"
            ? error
            : "não consegui ler o contexto do motor",
      })
      return null
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, work)
  return work
}

const tokens = (value: number) => value.toLocaleString("pt-BR")

/** Fim de compactação nativa: mede o contexto resumido, põe o número no anel e
 *  devolve o marco do fio com antes → depois. Sem leitura, o marco é o de
 *  sempre (nada se afirma sem medida). */
export async function medirCompactacao(
  convId: string,
  cwd: string,
  outcome: string,
  before: number | undefined,
): Promise<string> {
  const reading = await refreshEngineContext(convId, cwd, {
    turnoEncerrado: true,
  })
  const conv = useChat.getState().byId[convId]
  if (!reading || !conv || reading.totalTokens == null) return outcome
  useChat.getState().handleEvent(convId, {
    type: "context_usage",
    tokens: reading.totalTokens,
    window_tokens: reading.maxTokens,
  })
  const label = agentDef(conv.agent)?.label ?? conv.agent
  const trecho =
    before && before > 0
      ? `${tokens(before)} → ${tokens(reading.totalTokens)}`
      : `agora ${tokens(reading.totalTokens)}`
  return `${outcome.replace(/\.$/, "")} · ${trecho} tokens, medido pelo ${label}.`
}
