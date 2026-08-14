// AMOSTRAGEM do worktree para o segundo fator do R11 (lib/missionRepeat).
//
// Regra de convívio, e ela é o ponto: NÃO existe polling de fundo. O worktree
// só é perguntado depois que o primeiro fator já disparou (o mesmo comando ≥ 4
// vezes seguidas), e aí a cada `PULSE_INTERVAL_MS`, enquanto a suspeita durar.
// Fora disso o app não roda git nenhum por conta própria — o que também é a
// diferença entre "medir quando importa" e "criar um daemon".
//
// A leitura é read-only e barata (git_worktree_pulse: numstat + lista de novos,
// sem patch). Falha ou repo ausente devolve string vazia, e daí o `changedAt`
// fica null: sem impressão digital o aviso não aparece.
//
// A memória é por cwd e vive no MÓDULO (some com o app, como todo estado vivo).

import { invoke } from "@tauri-apps/api/core"

/** Espaçamento entre amostras enquanto a suspeita de repetição está de pé. */
export const PULSE_INTERVAL_MS = 30_000

export interface PulseMemory {
  /** Última impressão digital vista. */
  fingerprint: string
  /** Quando ela MUDOU pela última vez (epoch ms). */
  changedAt: number
}

/** Puro: aplica uma amostra à memória. Primeira amostra conta como mudança
 *  (é o marco a partir do qual dá pra afirmar "não mudou desde então"), e por
 *  isso o aviso só nasce quando a primeira amostra é ANTERIOR à primeira
 *  repetição — nunca no instante em que se começou a olhar. */
export function applyPulse(
  prev: PulseMemory | null,
  fingerprint: string,
  now: number,
): PulseMemory {
  if (prev && prev.fingerprint === fingerprint) return prev
  return { fingerprint, changedAt: now }
}

const memory = new Map<string, PulseMemory>()

/** Só pros testes: zera a memória de módulo. */
export function resetPulseMemory(): void {
  memory.clear()
}

/**
 * Amostra o worktree e devolve QUANDO ele mudou pela última vez. null = não deu
 * pra olhar (fora do Tauri, fora de repo, git ausente) — e o chamador NÃO liga
 * o aviso, porque um fator só é alarme falso.
 */
export async function sampleWorktreeChangedAt(
  cwd: string,
  now: number = Date.now(),
): Promise<number | null> {
  if (!cwd) return null
  let fingerprint = ""
  try {
    fingerprint = await invoke<string>("git_worktree_pulse", { cwd })
  } catch {
    // ADR-017: engolir aqui é correto e declarado — quem espera resultado
    // recebe `null`, que a régua do R11 lê como "não sei", nunca como
    // "não mudou". Nada além do aviso depende disto.
    return null
  }
  if (!fingerprint) return null
  const next = applyPulse(memory.get(cwd) ?? null, fingerprint, now)
  memory.set(cwd, next)
  return next.changedAt
}
