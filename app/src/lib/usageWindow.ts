// Medidor da JANELA DE USO do plano (rate limits por provider), o lado TS do
// usage_window.rs: tipos, política de poll (regra do Orca), staleness, a pill
// e a passada do vigia (no ticker único de lib/watchdog.ts). É separado do
// custo em $: custo é o que o turno gastou, janela é quanto do plano queimou.
//
// Fontes, por capability (`usageWindow`/`usagePoll`, nunca nome de agent):
//   • "oauth" (poll): a conta do provider com a credencial do CLI; é a do
//     claude, cuja statusline não roda headless.
//   • "rpc" (poll): probe local do CLI (codex app-server).
//   • "print" (poll): o CLI em modo print (agy `-p "/usage"`), sem abrir turno.
//   • "statusline" (push): o script posta a cada turno no terminal; carona,
//     nunca a fonte principal.

import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { agentDef } from "@/lib/agents"
import { usageWindowAgents } from "@/lib/agentRoster"
import type { AgentProbe } from "@/lib/detect"
import { isTauri } from "@/lib/db"
import { METER_DANGER_PCT, METER_WARN_PCT, meterTone } from "@/lib/meter"
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
  /** "oauth" (leitura da conta) | "statusline" (push de carona) | "rpc"
   *  (poll read-only local) | "print" (consulta headless ao CLI) — a
   *  procedência que a UI mostra. */
  source: string
  windows: UsageWindowInfo[]
  planType: string | null
  /** Epoch ms de quando o dado chegou (alimenta o "de 2 min atrás"). */
  fetchedAt: number
}

/** Falha de poll registrada no store (a UI mostra "falhando desde X"). */
export interface UsageFailure {
  /** "spawn" | "timeout" | "protocol" | "rate-limited" | "unsupported" |
   *  "auth" (sem credencial ou credencial recusada). */
  kind: string
  message: string
  /** Desde quando ESTE episódio de falha começou (1ª falha da streak). */
  since: number
  streak: number
}

// ---------------------------------------------------------------------------
// Política de poll (regra do Orca): quota é informativa, snapshot velho vence
// erro piscando.
// ---------------------------------------------------------------------------

/** Cadências escolhíveis, em MINUTOS. Conjunto FECHADO e não campo livre: o
 *  poll spawna processo (ou bate na conta do provider), e um "1" digitado ali
 *  viraria martelada silenciosa contra o fornecedor. */
export const USAGE_POLL_CHOICES = [5, 10, 15] as const
export type UsagePollMinutes = (typeof USAGE_POLL_CHOICES)[number]

/** Cadência padrão do poll (sucesso → próximo em 15 min). */
export const POLL_MS = 15 * 60_000

/** Minutos escolhidos → ms; fora do conjunto cai no padrão. Setting persistido
 *  é dado de FORA (arquivo à mão, versão antiga), e validar aqui é o que impede
 *  um `0` gravado de virar poll em laço. */
export function pollCadenceMs(minutes: number | null | undefined): number {
  return (USAGE_POLL_CHOICES as readonly number[]).includes(minutes ?? 0)
    ? minutes! * 60_000
    : POLL_MS
}
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

/** Paleta da barra, a mesma de todo medidor (lib/meter): cinza até 60%, âmbar
 *  60 a 80, vermelho 80+. Aliases para quem já importava. */
export const USAGE_WARN_PCT = METER_WARN_PCT
export const USAGE_DANGER_PCT = METER_DANGER_PCT

/** Falhas que NÃO são transientes: retry rápido não resolve nenhuma delas e
 *  martelar só piora (429 é limite; sem login, quem resolve é o usuário). */
const KINDS_SEM_PRESSA = new Set(["rate-limited", "auth"])

/** Espera até a próxima tentativa. Sucesso = cadência cheia; falha transiente
 *  = retry crescendo (30s, 60s, 2min…) até a cadência; 429 e auth nunca
 *  aceleram. A `cadencia` escolhida encurta o caminho feliz e o teto do
 *  backoff, nunca o piso. */
export function nextPollDelayMs(
  streak: number,
  lastKind: string | null,
  cadencia: number = POLL_MS,
): number {
  if (streak <= 0) return cadencia
  if (lastKind != null && KINDS_SEM_PRESSA.has(lastKind)) return cadencia
  const exp = Math.min(streak - 1, POLL_BACKOFF_CAP)
  return Math.min(cadencia, POLL_FLOOR_MS * 2 ** exp)
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

/** Tom visual do percentual: delega pro medidor único do app (lib/meter). */
export const usageTone = meterTone

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

/** Provider da pill fechada: o agent da CONVERSA ATIVA, e só ele. A janela de
 *  outro motor não se mexe enquanto o turno é deste, então mostrá-la aqui
 *  seria número parado vestido de vivo (ADR-040); os outros ficam a um clique,
 *  no popover. Sem conversa aberta, o pior global responde "como está minha
 *  frota". */
export function pillWindow(
  activeAgent: string | null,
  snapshots: Record<string, UsageSnapshot>,
  failures: Record<string, UsageFailure>,
  now: number,
): { agent: string; window: UsageWindowInfo } | null {
  if (activeAgent) {
    // Motor sem fonte de janela no registry (camada 1 de esconder) não tem o
    // que medir — e o vizinho não empresta número. Pergunta por CAPABILITY,
    // nunca por nome do motor.
    if (agentDef(activeAgent)?.usageWindow == null) return null
    const snap = snapshots[activeAgent]
    if (snap == null || !snapshotUsable(snap, failures[activeAgent], now)) {
      // Tem fonte e não tem leitura fresca: a pill não inventa e não pega
      // emprestado. Se houver falha REGISTRADA, o componente ainda a mostra
      // com o motivo (camada 3: configurado-falhando fica visível).
      return null
    }
    let worst: UsageWindowInfo | null = null
    for (const w of snap.windows) {
      if (!worst || w.usedPercent > worst.usedPercent) worst = w
    }
    if (worst) return { agent: activeAgent, window: worst }
    return null
  }
  return worstWindow(snapshots, failures, now)
}

/** Nome curto do provider na pill (shortLabel do registry; id desconhecido
 *  degrada pro próprio id — fail-open no render, nunca crasha nem esconde). */
export function usagePillLabel(agent: string): string {
  return agentDef(agent)?.shortLabel ?? agent
}

/** Procedência do snapshot em pt-BR (sem jargão de protocolo): de onde veio o
 *  número que está na tela. Fonte nova degrada pro próprio id, nunca some. */
export function sourceLabel(source: string): string {
  switch (source) {
    case "oauth":
      return "leitura da conta"
    case "rpc":
      return "leitura local"
    case "print":
      return "consulta ao CLI"
    case "statusline":
      return "statusline"
    default:
      return source
  }
}

/** Motivo da falha em pt-BR, legível por quem não conhece o pipeline. O
 *  "auth" é o caso que importa: sem login não há erro pra caçar, há um gesto
 *  a fazer no terminal. Kind novo degrada pro próprio kind (nunca vazio). */
export function failureLabel(kind: string): string {
  switch (kind) {
    case "auth":
      return "reautentique o CLI"
    case "rate-limited":
      return "consultas limitadas, tentando mais tarde"
    case "timeout":
      return "sem resposta a tempo"
    case "spawn":
      return "não consegui consultar"
    case "protocol":
      return "resposta inesperada"
    case "unsupported":
      return "sem fonte de medição"
    default:
      return kind
  }
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

/** Horário absoluto do reset: "às 21:50" hoje, "dia 22, 21:50" em outro dia. O
 *  dia importa: a janela de 7 dias reseta a dias de distância, e "às 21:50"
 *  sozinho afirmaria hoje. */
export function fmtResetAbsolute(
  resetsAtSecs: number | null,
  now: number = Date.now(),
): string | null {
  if (resetsAtSecs == null) return null
  const date = new Date(resetsAtSecs * 1000)
  if (Number.isNaN(date.getTime())) return null
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  const hoje = new Date(now)
  const mesmoDia =
    date.getFullYear() === hoje.getFullYear() &&
    date.getMonth() === hoje.getMonth() &&
    date.getDate() === hoje.getDate()
  return mesmoDia ? `às ${hh}:${mm}` : `dia ${date.getDate()}, ${hh}:${mm}`
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
// Passada de poll do vigia (Map de módulo com reset para teste; o ticker é o
// do watchdog, nunca um setInterval novo).
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

/** Agents de poll devidos agora (pura): dialeto no registry (`usagePoll`), CLI
 *  presente e logado (a fonte "oauth" lê a credencial dele), fora do delay da
 *  política e sem probe em voo. */
export function duePollAgents(
  enabled: boolean,
  detected: Record<string, AgentProbe>,
  now: number,
  cadencia: number = POLL_MS,
): string[] {
  if (!enabled) return []
  const out: string[] = []
  for (const def of usageWindowAgents()) {
    if (def.usagePoll == null) continue
    const probe = detected[def.id]
    if (!probe?.installed || probe.auth === "missing") continue
    const mark = pollMarks.get(def.id)
    if (mark?.inflight) continue
    if (
      mark &&
      now - mark.lastAttempt < nextPollDelayMs(mark.streak, mark.lastKind, cadencia)
    )
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

/** Uma passada de poll (no tick de 30s do watchdog, o piso da política). Todo
 *  desfecho vai para o store: erro vira failure visível no popover (ADR-017). */
export function checkUsageWindowPoll(now: number = Date.now()): void {
  if (!isTauri()) return
  const settings = useApp.getState().settings
  const due = duePollAgents(
    settings.usageMeterEnabled,
    settings.detected,
    now,
    pollCadenceMs(settings.usagePollMinutes),
  )
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

/** Poll manual imediato (Atualizar do popover). Atalha a cadência, não o limite
 *  do provider: `rate-limited` pula (bater num 429 pode estender o bloqueio, e
 *  o cartão já diz o motivo); `auth` tenta (quem acabou de logar clica para
 *  confirmar). */
export async function refreshUsageNow(): Promise<void> {
  if (!isTauri()) return
  const settings = useApp.getState().settings
  const detected = settings.detected
  const failures = useUsage.getState().failures
  const now = Date.now()
  const promises: Promise<void>[] = []
  for (const def of usageWindowAgents()) {
    if (def.usagePoll == null) continue
    const probe = detected[def.id]
    if (!probe?.installed || probe.auth === "missing") continue
    if (failures[def.id]?.kind === "rate-limited") continue
    markPollAttempt(def.id, now)
    const p = invoke<UsageSnapshot>("usage_fetch", { agent: def.id })
      .then((snap) => {
        recordPollResult(def.id, true, null, Date.now())
        useUsage.getState().ingest(snap)
      })
      .catch((e) => {
        const { kind, message } = parseFetchError(e)
        recordPollResult(def.id, false, kind, Date.now())
        useUsage.getState().recordFailure(def.id, kind, message, Date.now())
      })
    promises.push(p)
  }
  await Promise.allSettled(promises)
}

// ---------------------------------------------------------------------------
// Boot: hidrata os snapshots do Rust e assina o push da statusline. Uma vez,
// no App.tsx.
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
