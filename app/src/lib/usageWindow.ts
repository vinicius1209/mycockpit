// Medidor de JANELA DE USO do plano (rate limits por provider) — lado TS da
// frente do usage_window.rs: tipos espelho, POLÍTICA DE POLL (regra copiada do
// Orca, docs/competitors-orca.md achado 1), staleness honesta, agregação da
// pill e a PASSADA do vigia (chamada pelo ticker único de lib/watchdog.ts —
// estender, nunca duplicar setInterval).
//
// PIPELINE SEPARADO do custo em $ (turn_costs/ledger não se toca): custo é o
// que o turno gastou; janela é quanto do PLANO queimou e quando reseta.
//
// Duas fontes (capability `usageWindow` do registry, nunca nome de agent):
//   • "statusline" (PUSH): o script instalado posta pro receptor local a cada
//     turno; aqui só chega o snapshot via evento `usage://snapshot`.
//   • "rpc" (POLL): a passada do vigia decide QUANDO chamar `usage_fetch`
//     (a política abaixo); o Rust faz o probe read-only.

import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { agentDef, usageWindowAgents } from "@/lib/agents"
import type { AgentProbe } from "@/lib/detect"
import { isTauri } from "@/lib/db"
import { useApp } from "@/store/app"
import { useUsage } from "@/store/usage"

// ---------------------------------------------------------------------------
// Tipos espelho do Rust (usage_window.rs, serde camelCase).
// ---------------------------------------------------------------------------

export interface UsageWindowInfo {
  /** Id estável da janela ("5h", "7d"; chave nova degrada pra ela mesma). */
  id: string
  /** Rótulo curto pt-BR ("5 h", "7 dias"). */
  label: string
  usedPercent: number
  /** Epoch em SEGUNDOS do reset (como os CLIs reportam). null = não veio. */
  resetsAt: number | null
  windowMinutes: number | null
}

export interface UsageSnapshot {
  agent: string
  /** "statusline" (push de carona) | "rpc" (poll read-only local). */
  source: string
  windows: UsageWindowInfo[]
  planType: string | null
  /** Epoch ms de quando o dado chegou (alimenta o "de 2 min atrás"). */
  fetchedAt: number
}

/** Falha de poll registrada no store (a UI mostra "falhando desde X"). */
export interface UsageFailure {
  /** "spawn" | "timeout" | "protocol" | "rate-limited" | "unsupported" */
  kind: string
  message: string
  /** Desde quando ESTE episódio de falha começou (1ª falha da streak). */
  since: number
  streak: number
}

// ---------------------------------------------------------------------------
// Política de poll — copiada como REGRA do Orca (achado 1): quota é
// informativa, snapshot velho > erro piscando.
// ---------------------------------------------------------------------------

/** Cadência padrão do poll (sucesso → próximo em 15 min). */
export const POLL_MS = 15 * 60_000
/** Piso absoluto: nunca perguntar mais rápido que isto (o probe spawna um
 *  processo; e o tick do vigia é de 30s — o piso casa com ele). */
export const POLL_FLOOR_MS = 30_000
/** Teto do EXPOENTE do backoff por streak de falha (2^8: aritmética contida;
 *  o min() com POLL_MS já limita o delay efetivo a 15 min). */
export const POLL_BACKOFF_CAP = 8
/** Stale-drop: snapshot mais velho que isto sai do medidor (vira "sem dados
 *  desde X", nunca um percentual mentindo). */
export const STALE_MS = 30 * 60_000
/** MAS: se a última falha foi 429, o snapshot velho segura 24h — mostrar a
 *  última leitura conhecida é mais útil que "Limited" (regra do Orca). */
export const STALE_RATE_LIMITED_MS = 24 * 60 * 60_000

/** Paleta da barra (regra do Orca/STYLEGUIDE): CINZA até 60% (uso normal não
 *  pede atenção), âmbar 60 a 80 (aquecendo), vermelho 80+ (perto do teto). */
export const USAGE_WARN_PCT = 60
export const USAGE_DANGER_PCT = 80

/** Delay até a PRÓXIMA tentativa dado o histórico de falha. Sucesso (streak
 *  0) = cadência cheia. Falha transiente = retry rápido crescendo (30s, 60s,
 *  2min…) até a cadência cheia. 429 = NUNCA acelera (martelar um limite só
 *  piora o limite). */
export function nextPollDelayMs(streak: number, lastKind: string | null): number {
  if (streak <= 0) return POLL_MS
  if (lastKind === "rate-limited") return POLL_MS
  const exp = Math.min(streak - 1, POLL_BACKOFF_CAP)
  return Math.min(POLL_MS, POLL_FLOOR_MS * 2 ** exp)
}

/** Idade máxima que um snapshot pode ter e ainda aparecer no medidor. */
export function staleLimitMs(failure: UsageFailure | undefined): number {
  return failure?.kind === "rate-limited" ? STALE_RATE_LIMITED_MS : STALE_MS
}

/** O snapshot ainda é mostrável? (fora disso a UI diz "sem dados desde X") */
export function snapshotUsable(
  snap: UsageSnapshot,
  failure: UsageFailure | undefined,
  now: number,
): boolean {
  return now - snap.fetchedAt <= staleLimitMs(failure)
}

/** Tom visual do percentual (constantes comentadas acima). */
export function usageTone(pct: number): "ok" | "warn" | "danger" {
  if (pct >= USAGE_DANGER_PCT) return "danger"
  if (pct >= USAGE_WARN_PCT) return "warn"
  return "ok"
}

/** A janela MAIS queimada entre os snapshots mostráveis — é o número da pill
 *  agregada (o pior caso é o que interessa pra "vou bater no teto?"). */
export function worstWindow(
  snapshots: Record<string, UsageSnapshot>,
  failures: Record<string, UsageFailure>,
  now: number,
): { agent: string; window: UsageWindowInfo } | null {
  let out: { agent: string; window: UsageWindowInfo } | null = null
  for (const snap of Object.values(snapshots)) {
    if (!snapshotUsable(snap, failures[snap.agent], now)) continue
    for (const w of snap.windows) {
      if (!out || w.usedPercent > out.window.usedPercent) {
        out = { agent: snap.agent, window: w }
      }
    }
  }
  return out
}

/** Provider mostrado na pill FECHADA: prioriza o agent da CONVERSA ATIVA
 *  quando ele tem janela medida (o número acompanha o contexto do usuário,
 *  nunca o "pior global" de outro motor); agent ativo sem medição (ex.:
 *  statusline não instalada) cai pro pior global — que a pill sempre NOMEIA
 *  (um "30%" nu do Codex numa conversa Claude foi o bug de honestidade). */
export function pillWindow(
  activeAgent: string | null,
  snapshots: Record<string, UsageSnapshot>,
  failures: Record<string, UsageFailure>,
  now: number,
): { agent: string; window: UsageWindowInfo } | null {
  if (activeAgent) {
    const snap = snapshots[activeAgent]
    if (snap != null && snapshotUsable(snap, failures[activeAgent], now)) {
      let worst: UsageWindowInfo | null = null
      for (const w of snap.windows) {
        if (!worst || w.usedPercent > worst.usedPercent) worst = w
      }
      if (worst) return { agent: activeAgent, window: worst }
    }
  }
  return worstWindow(snapshots, failures, now)
}

/** Nome curto do provider na pill (shortLabel do registry; id desconhecido
 *  degrada pro próprio id — fail-open no render, nunca crasha nem esconde). */
export function usagePillLabel(agent: string): string {
  return agentDef(agent)?.shortLabel ?? agent
}

/** Percentual pra exibição: inteiro (o CLI manda float sujo tipo
 *  28.999999999999996 — arredondar é honesto, a fonte só tem essa precisão). */
export function fmtPct(pct: number): string {
  return `${Math.round(pct)}%`
}

/** "reseta em 4h 22min" (compacto, sem travessão). resets_at em SEGUNDOS.
 *  Já passou/não veio → null (a UI omite a frase, sem inventar contagem). */
export function fmtResetIn(resetsAtSecs: number | null, now: number): string | null {
  if (resetsAtSecs == null) return null
  const ms = resetsAtSecs * 1000 - now
  if (ms <= 0) return null
  const min = Math.round(ms / 60_000)
  if (min < 60) return `reseta em ${Math.max(1, min)}min`
  const h = Math.floor(min / 60)
  if (h < 24) {
    const m = min % 60
    return m > 0 ? `reseta em ${h}h ${m}min` : `reseta em ${h}h`
  }
  const d = Math.floor(h / 24)
  const hr = h % 24
  return hr > 0 ? `reseta em ${d}d ${hr}h` : `reseta em ${d}d`
}

/** Idade do dado: "agora" / "de 2min atrás" / "de 3h atrás" — a procedência
 *  temporal na cara, parte dos metadados honestos. */
export function fmtAge(fetchedAt: number, now: number): string {
  const min = Math.floor((now - fetchedAt) / 60_000)
  if (min < 1) return "agora"
  if (min < 60) return `de ${min}min atrás`
  const h = Math.floor(min / 60)
  if (h < 24) return `de ${h}h atrás`
  return `de ${Math.floor(h / 24)}d atrás`
}

// ---------------------------------------------------------------------------
// Passada de poll do vigia (mesmo padrão de memória do watchdog: Map de
// módulo + reset pra teste; o ticker é o de lá, nunca um setInterval novo).
// ---------------------------------------------------------------------------

type PollMark = {
  lastAttempt: number
  streak: number
  lastKind: string | null
  inflight: boolean
}
const pollMarks = new Map<string, PollMark>()

/** (testes) zera a memória de poll. */
export function _resetUsagePollState(): void {
  pollMarks.clear()
}

/** Carimba a tentativa (chamado ANTES do fetch: um probe em voo nunca é
 *  re-disparado pelo tick seguinte). */
export function markPollAttempt(agent: string, now: number): void {
  const prev = pollMarks.get(agent)
  pollMarks.set(agent, {
    lastAttempt: now,
    streak: prev?.streak ?? 0,
    lastKind: prev?.lastKind ?? null,
    inflight: true,
  })
}

/** Registra o desfecho do fetch (fecha o inflight; sucesso zera a streak). */
export function recordPollResult(
  agent: string,
  ok: boolean,
  kind: string | null,
  now: number,
): void {
  const prev = pollMarks.get(agent)
  pollMarks.set(agent, {
    lastAttempt: prev?.lastAttempt ?? now,
    streak: ok ? 0 : (prev?.streak ?? 0) + 1,
    lastKind: ok ? null : kind,
    inflight: false,
  })
}

/** Agents de POLL devidos AGORA (pura dado settings + memória + relógio):
 *  fonte "rpc" no registry, CLI presente e não deslogada (deslogado = sem
 *  quota pra mostrar: some, camada 2 do Orca; sem probe = nunca detectado:
 *  não spawnamos binário que não sabemos existir), fora do delay da política
 *  e sem probe em voo. */
export function duePollAgents(
  enabled: boolean,
  detected: Record<string, AgentProbe>,
  now: number,
): string[] {
  if (!enabled) return []
  const out: string[] = []
  for (const def of usageWindowAgents()) {
    if (def.usageWindow !== "rpc") continue
    const probe = detected[def.id]
    if (!probe?.installed || probe.auth === "missing") continue
    const mark = pollMarks.get(def.id)
    if (mark?.inflight) continue
    if (mark && now - mark.lastAttempt < nextPollDelayMs(mark.streak, mark.lastKind))
      continue
    out.push(def.id)
  }
  return out
}

/** Erro do invoke → UsageFailure parcial (o backend manda {kind, message};
 *  qualquer outra forma degrada pra "protocol" com a mensagem crua). */
export function parseFetchError(e: unknown): { kind: string; message: string } {
  if (e && typeof e === "object" && "kind" in e) {
    const o = e as { kind?: unknown; message?: unknown }
    return {
      kind: typeof o.kind === "string" ? o.kind : "protocol",
      message: typeof o.message === "string" ? o.message : String(e),
    }
  }
  return { kind: "protocol", message: typeof e === "string" ? e : String(e) }
}

/** UMA passada de poll (chamada pelo check() do watchdog, tick de 30s = o
 *  piso da política). Dispara os fetches devidos e registra desfecho no
 *  store — erro NUNCA é engolido sem registro (ADR-017): vira failure
 *  visível no popover. */
export function checkUsageWindowPoll(now: number = Date.now()): void {
  if (!isTauri()) return
  const settings = useApp.getState().settings
  const due = duePollAgents(settings.usageMeterEnabled, settings.detected, now)
  for (const agent of due) {
    markPollAttempt(agent, now)
    void invoke<UsageSnapshot>("usage_fetch", { agent })
      .then((snap) => {
        recordPollResult(agent, true, null, Date.now())
        useUsage.getState().ingest(snap)
      })
      .catch((e) => {
        const { kind, message } = parseFetchError(e)
        recordPollResult(agent, false, kind, Date.now())
        useUsage.getState().recordFailure(agent, kind, message, Date.now())
      })
  }
}

// ---------------------------------------------------------------------------
// Boot: hidrata o store com os snapshots vivos do Rust e assina o push da
// statusline (evento `usage://snapshot`). Chamado UMA vez no App.tsx.
// ---------------------------------------------------------------------------

export function startUsageWindow(): () => void {
  if (!isTauri()) return () => {}
  let unlisten: UnlistenFn | null = null
  let stopped = false
  void invoke<UsageSnapshot[]>("usage_snapshots")
    .then((snaps) => {
      for (const s of snaps) useUsage.getState().ingest(s)
    })
    .catch((e) => console.error("[usage] hidratação falhou:", e))
  void listen<UsageSnapshot>("usage://snapshot", (ev) => {
    useUsage.getState().ingest(ev.payload)
  }).then((un) => {
    if (stopped) un()
    else unlisten = un
  })
  return () => {
    stopped = true
    unlisten?.()
  }
}
