// H1 (hooks-plan) — sessões EXTERNAS dos CLIs no front. O Rust
// (hook_sessions.rs) mantém o mapa em memória e emite a lista completa em
// `hooks://sessions`; aqui só hidratamos no boot + escutamos (padrão
// startUsageWindow). Nada é persistido: reiniciou o app, a presença zera
// (replay-safe honesto — não temos como saber se a sessão ainda vive).
//
// O app OBSERVA, não dirige: estas sessões nasceram no terminal do usuário.
// Nenhuma superfície ganha botão de controle (não temos como parar/mandar
// mensagem), e nada aqui cria conversa no fio.

import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { agentDef } from "@/lib/agents"
import { isTauri } from "@/lib/db"

/** Espelho de hook_sessions::ExternalSession (serde camelCase). */
export interface ExternalSession {
  agent: string
  sessionId: string
  cwd: string
  status: "working" | "waiting" | "blocked" | "idle"
  lastEvent: string
  tool: string | null
  lastSeen: number
  startedAt: number
}

interface ExternalSessionsState {
  sessions: ExternalSession[]
  set: (sessions: ExternalSession[]) => void
}

export const useExternalSessions = create<ExternalSessionsState>((set) => ({
  sessions: [],
  set: (sessions) => set({ sessions }),
}))

/** Copy pt-BR do status (vocabulário fechado do Rust; valor desconhecido
 *  degrada pra "ociosa" — fail-open no render, nunca crasha). */
export function statusLabel(status: ExternalSession["status"]): string {
  switch (status) {
    case "working":
      return "trabalhando"
    case "waiting":
    case "blocked":
      return "esperando você"
    case "idle":
      return "ociosa"
    default:
      return "ociosa"
  }
}

/** Papel de cor do status (STYLEGUIDE §2): azul = vivo agora; âmbar =
 *  precisa de você; cinza = simplesmente ok.
 *
 *  DECISÃO de cor (revisão H1, registrada no hooks-plan): o brief dizia
 *  "cinza/neutra", mas cinza só cabe em `idle` — uma sessão VIVA pintada de
 *  cinza pareceria morta, e "está trabalhando" é informação verdadeira, não
 *  teatro. `working` herda o azul de vivo; `waiting`/`blocked` o âmbar de
 *  "precisa de você". O que distingue a sessão externa da do app NÃO é o tom,
 *  é o RÓTULO ("No terminal · observando") + a ausência de qualquer controle
 *  (o app observa, não dirige). */
export function statusTone(
  status: ExternalSession["status"],
): "running" | "attention" | "neutral" {
  if (status === "working") return "running"
  if (status === "waiting" || status === "blocked") return "attention"
  return "neutral"
}

/** "visto há X" — idade do último sinal, curto e honesto. */
export function seenAgo(lastSeen: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - lastSeen) / 1000))
  if (s < 10) return "agora"
  if (s < 60) return `há ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  return `há ${h}h`
}

/** Projeto conhecido dono de um cwd: igualdade exata OU o cwd DENTRO da pasta
 *  do projeto (worktree/subpasta). Prefixo por SEGMENTO ("/a/b" não casa
 *  "/a/bc"). Trailing slash normalizado. null = projeto desconhecido (a UI
 *  mostra o basename do cwd — nunca inventa vínculo). */
export function projectForCwd<T extends { path: string }>(
  cwd: string,
  projects: T[],
): T | null {
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p)
  const c = norm(cwd)
  if (!c) return null
  let best: T | null = null
  for (const p of projects) {
    const base = norm(p.path)
    if (!base) continue
    if (c === base || c.startsWith(`${base}/`)) {
      // o match mais ESPECÍFICO vence (projeto aninhado em outro).
      if (!best || base.length > norm(best.path).length) best = p
    }
  }
  return best
}

/** Nome exibível da sessão: projeto conhecido ou o basename do cwd. */
export function sessionPlace<T extends { path: string; name: string }>(
  session: Pick<ExternalSession, "cwd">,
  projects: T[],
): string {
  const p = projectForCwd(session.cwd, projects)
  if (p) return p.name
  const base = session.cwd.replace(/\/+$/, "").split("/").pop()
  return base || "pasta desconhecida"
}

/** Rótulo do motor (registry; id desconhecido degrada pro próprio id). */
export function engineLabel(agent: string): string {
  return agentDef(agent)?.shortLabel ?? agent
}

/** Sessões exibíveis: some com o que está mudo há mais de 2h (o Rust poda em
 *  4h; a UI esconde antes — presença velha vira ruído, não informação). */
export const DISPLAY_TTL_MS = 2 * 60 * 60 * 1000

export function visibleSessions(
  sessions: ExternalSession[],
  now: number = Date.now(),
): ExternalSession[] {
  return sessions.filter((s) => now - s.lastSeen < DISPLAY_TTL_MS)
}

/** Chave semântica ESTÁVEL pro efeito do tray (App.tsx): muda quando o
 *  conjunto/estado muda, não a cada render. */
export function externalSessionsKey(sessions: ExternalSession[]): string {
  return sessions
    .map((s) => `${s.agent}:${s.sessionId}:${s.status}`)
    .sort()
    .join(",")
}

/** Liga a hidratação + o listener (padrão startUsageWindow: guard
 *  anti-StrictMode, cleanup devolvido pro efeito do App). */
export function startExternalSessions(): () => void {
  if (!isTauri()) return () => {}
  let stopped = false
  let unlisten: UnlistenFn | null = null
  void invoke<ExternalSession[]>("hook_sessions")
    .then((list) => {
      if (!stopped) useExternalSessions.getState().set(list)
    })
    .catch((e) => console.warn("[sessões externas] hidratação falhou", e))
  void listen<ExternalSession[]>("hooks://sessions", (ev) => {
    useExternalSessions.getState().set(ev.payload)
  })
    .then((un) => {
      if (stopped) un()
      else unlisten = un
    })
    .catch((e) =>
      // sem o listener a presença externa fica congelada no boot — visível
      // no console, sem toast (feature opcional, degrada sem drama).
      console.error("[sessões externas] listener não registrou", e),
    )
  return () => {
    stopped = true
    unlisten?.()
  }
}
