// ESTADO PERSISTENTE do pipeline de missão (P1 confiabilidade): o run vive em
// memória (store/mission.ts byConv) e morria com o app. Gravamos um snapshot em
// `.mycockpit/missions/<slug>/run-state.json` — pasta ISOLADA por missão (ver
// lib/missionPaths.ts; antes era `.mission/run-state.json` fixo, que missões no
// mesmo cwd sobrescreviam) — a cada MARCO: início, transição de fase, gate
// aberto/respondido, recovery, fim. No boot, o ponteiro por conversa
// (activePointerPath) aponta o dir da missão; se o run-state lá está `running`
// SEM missão em memória, a conversa ganha o card de RETOMADA.
//
// Decisões documentadas:
// - Best-effort SEMPRE: falha de escrita/leitura NUNCA derruba a missão.
// - Gate/recovery pendentes NÃO sobrevivem ao restart: retomar re-roda a fase
//   corrente do zero (ela re-pergunta se precisar). Um gate já RESPONDIDO
//   sobrevive via `gateDecisions` (bloco destinado à fase `current`).
// - Anexos do launcher (fase 1) não sobrevivem — o contexto real está no
//   worktree/handoffs, que são a fonte da retomada.
// - Fim normal NÃO apaga o arquivo: marca `done` (audit trail barato; a
//   detecção só oferece retomada para `running`).

import { invoke } from "@tauri-apps/api/core"
import { activePointerPath, runStatePath } from "@/lib/missionPaths"
import type {
  MissionPhaseStatus,
  MissionPreset,
  MissionRun,
  MissionStatus,
} from "@/lib/missionTypes"

export const RUN_STATE_VERSION = 1

/** Status do arquivo: os do run + "abandoned" (usuário descartou a retomada). */
export type RunStateStatus = MissionStatus | "abandoned"

/** Snapshot persistido de UMA fase (a def viaja no preset efetivo, paralela). */
export interface RunStatePhase {
  status: MissionPhaseStatus
  costUsd: number
  error?: string
}

/** Snapshot completo do pipeline num marco. */
export interface MissionRunState {
  version: number
  missionId: string
  /** Pasta RELATIVA (sob o cwd) desta missão — ex.:
   *  `.mycockpit/missions/<slug>`. Isola os artefatos de cada missão; o boot
   *  lê o run-state DAQUI (via ponteiro da conversa). */
  dir: string
  /** Dono do arquivo: só ESTA conversa pode retomar (o cwd pode ser a pasta do
   *  projeto quando não há worktree — o convId evita oferta cruzada). */
  convId: string
  task: string
  /** Preset EFETIVO no momento do marco: fases já corrigidas pela recuperação
   *  e/ou apendadas pelo loop de correção, + teto. */
  preset: MissionPreset
  current: number
  phases: RunStatePhase[]
  costTotal: number
  maxCostUsd: number | null
  /** Gate já RESPONDIDO cujas decisões pertencem à fase `current` (a próxima a
   *  rodar). Reinjetado no prompt ao retomar. null = nada pendente. */
  gateDecisions?: string | null
  status: RunStateStatus
  updatedAt: number
}

/** Entrada de missão interrompida detectada no boot (store.interrupted). */
export interface InterruptedMission {
  state: MissionRunState
  cwd: string
}

/** Serializa o run em memória num snapshot persistível. */
export function runToState(
  run: MissionRun,
  gateDecisions?: string | null,
): MissionRunState {
  return {
    version: RUN_STATE_VERSION,
    missionId: run.id,
    dir: run.dir,
    convId: run.convId,
    task: run.task,
    preset: {
      id: run.id,
      name: run.presetName,
      phases: run.phases.map((p) => p.def),
      maxCostUsd: run.maxCostUsd,
    },
    current: run.current,
    phases: run.phases.map((p) => ({
      status: p.status,
      costUsd: p.costUsd,
      ...(p.error ? { error: p.error } : {}),
    })),
    costTotal: run.costTotal,
    maxCostUsd: run.maxCostUsd,
    gateDecisions: gateDecisions ?? null,
    status: run.status,
    updatedAt: Date.now(),
  }
}

const STATUSES: RunStateStatus[] = [
  "running",
  "done",
  "error",
  "aborted",
  "abandoned",
]

/** Parse TOLERANTE do run-state.json: valida o esqueleto (versão, ids, preset
 *  com fases, status conhecido) e normaliza os numéricos. null = inaproveitável
 *  (o chamador simplesmente não oferece retomada). */
export function parseRunState(raw: string): MissionRunState | null {
  if (!raw || !raw.trim()) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== "object") return null
  const o = obj as Record<string, unknown>
  if (o.version !== RUN_STATE_VERSION) return null
  if (typeof o.missionId !== "string" || !o.missionId) return null
  // Sem `dir` = run-state legado (era do `.mission/` fixo, pré-isolamento): não
  // dá pra localizar com segurança e essas missões já estavam sujeitas à
  // sobrescrita — não oferece retomada (null), sem quebrar nada.
  if (typeof o.dir !== "string" || !o.dir) return null
  if (typeof o.convId !== "string" || !o.convId) return null
  if (typeof o.task !== "string") return null
  const preset = o.preset as MissionPreset | undefined
  if (
    !preset ||
    typeof preset !== "object" ||
    !Array.isArray(preset.phases) ||
    preset.phases.length === 0
  ) {
    return null
  }
  const status = o.status as RunStateStatus
  if (!STATUSES.includes(status)) return null
  const phases: RunStatePhase[] = Array.isArray(o.phases)
    ? (o.phases as RunStatePhase[]).map((p) => ({
        status: p?.status ?? "queued",
        costUsd: typeof p?.costUsd === "number" ? p.costUsd : 0,
        ...(typeof p?.error === "string" && p.error ? { error: p.error } : {}),
      }))
    : []
  return {
    version: RUN_STATE_VERSION,
    missionId: o.missionId,
    dir: o.dir,
    convId: o.convId,
    task: o.task,
    preset,
    current: typeof o.current === "number" ? o.current : 0,
    phases,
    costTotal: typeof o.costTotal === "number" ? o.costTotal : 0,
    maxCostUsd: typeof o.maxCostUsd === "number" ? o.maxCostUsd : null,
    gateDecisions: typeof o.gateDecisions === "string" ? o.gateDecisions : null,
    status,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
  }
}

/** A detecção deve oferecer RETOMADA? Só arquivo `running` (o app morreu com a
 *  missão em voo) e da PRÓPRIA conversa. done/error/aborted/abandoned são
 *  terminais — o usuário já viu (ou descartou) o desfecho. */
export function shouldOfferResume(
  state: MissionRunState,
  convId: string,
): boolean {
  return state.status === "running" && state.convId === convId
}

/** Lê o snapshot de UMA missão (pasta `dir` sob o cwd). null em qualquer falha
 *  (sem arquivo, JSON inválido, fora do Tauri) — o chamador não oferece
 *  retomada. */
export async function readRunState(
  cwd: string,
  dir: string,
): Promise<MissionRunState | null> {
  try {
    const rel = runStatePath(dir)
    const raw = await invoke<string>("read_text_file", {
      root: cwd,
      path: `${cwd}/${rel}`,
    })
    return parseRunState(raw)
  } catch {
    return null
  }
}

/** Ponteiro por conversa → dir da missão ativa/última (retomada sem varrer FS,
 *  já que as pastas são gitignoradas). */
interface ActivePointer {
  dir: string
}

/** Grava o ponteiro da conversa apontando pro dir da missão. Best-effort. */
export async function writeActivePointer(
  cwd: string,
  convId: string,
  dir: string,
): Promise<void> {
  try {
    await invoke("write_mission_state", {
      cwd,
      relPath: activePointerPath(convId),
      content: JSON.stringify({ dir } satisfies ActivePointer),
    })
  } catch (err) {
    console.warn("[missão] falha ao gravar ponteiro de missão ativa:", err)
  }
}

/** Lê o dir da missão ativa/última da conversa (null se não há ponteiro). */
export async function readActivePointer(
  cwd: string,
  convId: string,
): Promise<string | null> {
  try {
    const raw = await invoke<string>("read_text_file", {
      root: cwd,
      path: `${cwd}/${activePointerPath(convId)}`,
    })
    const o = JSON.parse(raw) as Partial<ActivePointer>
    return typeof o.dir === "string" && o.dir ? o.dir : null
  } catch {
    return null
  }
}

/** Detecta a missão interrompida de uma conversa: segue o ponteiro → lê o
 *  run-state daquela pasta. null se não há ponteiro ou run-state. */
export async function readInterruptedFor(
  cwd: string,
  convId: string,
): Promise<MissionRunState | null> {
  const dir = await readActivePointer(cwd, convId)
  if (!dir) return null
  return readRunState(cwd, dir)
}

/** Garante que `.mycockpit/.gitignore` (=`*`) exista no cwd da missão. O
 *  onboarding do projeto semeia isso, mas um worktree fresco (cwd de missão sem
 *  onboarding) não teria — e os artefatos de missão ficariam rastreáveis no git.
 *  Best-effort e SEM clobber: só escreve se o arquivo estiver AUSENTE. */
export async function ensureMissionsGitignore(cwd: string): Promise<void> {
  try {
    await invoke<string>("read_text_file", {
      root: cwd,
      path: `${cwd}/.mycockpit/.gitignore`,
    })
    return // já existe (semeado pelo onboarding ou por nós) → não toca
  } catch {
    // ausente → semeia; write_mission_state cria a pasta e valida o caminho.
    try {
      await invoke("write_mission_state", {
        cwd,
        relPath: ".mycockpit/.gitignore",
        content: "*\n",
      })
    } catch (err) {
      console.warn("[missão] falha ao semear .mycockpit/.gitignore:", err)
    }
  }
}

/** Fila de escrita POR cwd: os marcos disparam fire-and-forget e o comando
 *  Rust roda em thread pool — sem a corrente, duas escritas próximas poderiam
 *  pousar fora de ordem (um snapshot `running` velho por cima do `done`/`aborted`
 *  terminal ⇒ o boot re-ofereceria retomada de missão encerrada). */
const writeChain = new Map<string, Promise<void>>()

/** Grava o snapshot no worktree (escrita atômica no Rust, serializada por cwd
 *  na ordem das chamadas). BEST-EFFORT: falha vira warn no console e a missão
 *  segue — persistir nunca derruba o run. */
export function writeRunState(
  cwd: string,
  state: MissionRunState,
): Promise<void> {
  // serializa AGORA (snapshot do marco), grava na vez dela.
  const content = JSON.stringify(state, null, 2)
  const relPath = runStatePath(state.dir)
  // corrente por ARQUIVO (cwd+dir): missões diferentes no mesmo cwd têm dirs
  // distintos e não competem; a ordem só importa dentro da MESMA missão.
  const key = `${cwd}::${relPath}`
  const next = (writeChain.get(key) ?? Promise.resolve()).then(async () => {
    try {
      await invoke("write_mission_state", { cwd, relPath, content })
    } catch (err) {
      console.warn("[missão] falha ao persistir run-state no worktree:", err)
    }
  })
  writeChain.set(key, next)
  return next
}
