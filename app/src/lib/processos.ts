// Sessões de motor rodando FORA do app (ponte pro `processos.rs`).
//
// O app já mata o que ele spawna (`RunRegistry` + `kill_all` na saída). Isto
// aqui é sobre o que ele NÃO spawnou e por isso não enxergava: sessão de CLI
// esquecida no terminal, órfã de um pai que morreu, worktree preso por ela.
//
// Só se OLHA. Encerrar é gesto humano, um a um.

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

export interface ProcessoDeMotor {
  pid: number
  ppid: number
  /** Nome do executável: claude · codex · agy · opencode. */
  motor: string
  rss_mb: number
  idade_s: number
  /** `ppid === 1`: o pai morreu e deixou isto para trás. */
  orfao: boolean
}

/** Um dia parado. Sessão de ontem que você vai retomar hoje não é lixo; a de
 *  uma semana é. O corte mora no Rust também — este é o espelho. */
export const PARADO_SEGUNDOS = 24 * 60 * 60

export interface ResumoDeProcessos {
  parados: number
  orfaos: number
}

/**
 * Quantas merecem aparecer na faixa.
 *
 * Órfã conta SEMPRE (idade não importa: pai morto é fato, não suspeita) e
 * parada conta pela idade. Uma sessão órfã e antiga conta uma vez só — senão o
 * número da faixa seria maior que a lista do painel, e o usuário abriria pra
 * procurar uma que não existe.
 */
export function resumirProcessos(lista: readonly ProcessoDeMotor[]): ResumoDeProcessos {
  let parados = 0
  let orfaos = 0
  for (const p of lista) {
    if (p.orfao) orfaos++
    else if (p.idade_s >= PARADO_SEGUNDOS) parados++
  }
  return { parados, orfaos }
}

/** "17 dias" · "4 h" · "12 min" — a idade em uma palavra. */
export function idadeCurta(segundos: number): string {
  const dias = Math.floor(segundos / 86_400)
  if (dias >= 1) return `${dias} dia${dias > 1 ? "s" : ""}`
  const horas = Math.floor(segundos / 3_600)
  if (horas >= 1) return `${horas} h`
  return `${Math.max(1, Math.floor(segundos / 60))} min`
}

export async function listarProcessos(): Promise<ProcessoDeMotor[]> {
  if (!isTauri()) return []
  try {
    return await invoke<ProcessoDeMotor[]>("listar_processos_de_motor")
  } catch {
    // Best-effort: não saber o que roda na máquina não pode atrapalhar o app.
    return []
  }
}

export async function matarProcesso(pid: number): Promise<void> {
  await invoke("matar_processo_de_motor", { pid })
}
