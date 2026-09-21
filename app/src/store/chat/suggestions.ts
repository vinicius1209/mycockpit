// SUGESTÕES pós-turno: o debounce, o token de invalidação e a geração.
//
// Extraído de store/chat.ts (no teto do ratchet), mesmo padrão de clone.ts,
// notes.ts, remove.ts, planGate.ts e sessionMode.ts. Recorte fechado: tem
// memória própria (timer + geração por conversa) e é a única coisa no store que
// chama o helper pago.

import type { ChatState } from "@/store/chat"
import { generateUtilityText } from "@/lib/utility"
import {
  SUGGEST_PROMPT,
  SUGGEST_DEBOUNCE_MS,
  buildContext,
  parseSuggestions,
} from "@/lib/suggestions"
import { isTauri } from "@/lib/db"
import { useApp } from "@/store/app"
import { helperDoProjeto } from "@/lib/helperDoProjeto"

type Get = () => ChatState

/** Debounce por conversa; `gen` é o token que descarta geração atravessada por
 *  um run novo. Memória de MÓDULO, como era no criador do store. */
const timer: Record<string, ReturnType<typeof setTimeout>> = {}
const gen: Record<string, number> = {}

export function invalidateSuggestionsImpl(convId: string) {
  gen[convId] = (gen[convId] ?? 0) + 1
  clearTimeout(timer[convId])
}

export function scheduleSuggestionsImpl(get: Get, convId: string) {
  clearTimeout(timer[convId])
  timer[convId] = setTimeout(() => {
    void get().generateSuggestions(convId)
  }, SUGGEST_DEBOUNCE_MS)
}

// Gera sugestões contextuais após o turno (fire-and-forget; degrada pros chips).
export async function generateSuggestionsImpl(get: Get, convId: string) {
  if (!isTauri()) return
  const c = get().byId[convId]
  if (!c || c.running || c.finalizing) return // run em andamento → não gera
  if (!c.items.some((it) => it.kind === "text")) return
  const proj = useApp.getState().projects.find((p) => p.id === c.projectId)
  if (!proj) {
    console.warn("[sugestões] projeto não encontrado p/ convId", convId, c.projectId)
    return
  }
  // modelo helper por projeto (.frota/config.toml); null = off
  const helperModel = helperDoProjeto(c.projectId)
  if (!helperModel) return
  // token desta geração: se um novo run começar enquanto geramos, descartamos.
  const myGen = gen[convId] ?? 0
  get().setSuggesting(convId, true)
  try {
    const raw = await generateUtilityText({
      task: "composer_suggestions",
      model: helperModel,
      cwd: proj.path,
      prompt: `${SUGGEST_PROMPT}\n\nConversa recente:\n${buildContext(c.items)}`,
    })
    // descarta se um novo run começou enquanto gerava (anti-concorrência)
    if ((gen[convId] ?? 0) !== myGen) return
    const list = parseSuggestions(raw)
    if (!list.length) {
      console.warn("[sugestões] resposta sem JSON parseável:", raw)
    }
    const after = get().byId[convId]
    if (list.length && after && !after.running) {
      get().setSuggestions(convId, list)
      // persiste p/ as sugestões sobreviverem a fechar/minimizar/reabrir
      void get().persist(convId)
    }
  } catch (e) {
    console.warn("[sugestões] erro ao gerar:", e)
  } finally {
    // só limpa o "buscando…" se ainda formos a geração corrente
    if ((gen[convId] ?? 0) === myGen) {
      get().setSuggesting(convId, false)
    }
  }
}
