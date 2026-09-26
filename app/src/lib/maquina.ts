// A máquina na faixa de baixo (ADR-262, mock `docs/mocks/barra-de-baixo.html`):
// memória e CPU do computador, e o que disso é do Frota. As leituras vêm do
// Rust (`sistema.rs`); aqui só a forma e a régua, puras.

import { invoke } from "@tauri-apps/api/core"
import type { MeterTone } from "@/lib/meter"

export interface AmostraDoSistema {
  memUsadaMb: number
  memTotalMb: number
  /** `null` na primeira leitura: CPU é diferença entre duas amostras. */
  cpuPct: number | null
  nucleos: number
}

export type PapelDoProcesso = "motor" | "comando" | "mcp" | "frota" | "processo"

/** Um processo da árvore, como o Rust o lê (`sistema::ProcessoNaArvore`). */
export interface ProcessoNaArvore {
  pid: number
  profundidade: number
  papel: PapelDoProcesso
  nome: string
  executor: string | null
  comando: string
  rssMb: number
  cpuPct: number
  tempoS: number
}

export interface DetalheDaMaquina {
  /** A mesma soma que mede cada turno (ADR-263): um número só. */
  frotaMb: number
  turnos: { runId: string; mb: number; processos: ProcessoNaArvore[] }[]
  navegadores: { projectId: string; projectPath: string; mb: number; processos: ProcessoNaArvore[] }[]
}

export const lerAmostra = () => invoke<AmostraDoSistema>("sistema_amostra")
export const lerDetalhe = () => invoke<DetalheDaMaquina>("sistema_detalhe")
/** Encerra um processo do turno e os filhos dele. O Rust recusa o motor e o
 *  que já não é do turno. */
export const encerrarProcesso = (runId: string, pid: number) => invoke<void>("sistema_encerrar", { runId, pid })

/** Uma amostra a cada 2 s na faixa; o traço de CPU guarda o último minuto. */
export const INTERVALO_DA_AMOSTRA_MS = 2_000
export const AMOSTRAS_NO_TRACO = 30

/** Turno que passa disto sobe o tom da faixa: é o segundo degrau do aviso do
 *  fio (2, 4, 8 GB), o ponto em que ele deixa de ser curiosidade. */
export const TURNO_PESADO_MB = 4_096

/** GB para a faixa: inteiro a partir de 10, uma casa abaixo disso, e sem
 *  ",0" ("16", "2,4", "1"). Puro. */
export function fmtGb(mb: number): string {
  const gb = mb / 1024
  return (gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)).replace(".", ",").replace(/,0$/, "")
}

/** Cor da faixa: cinza no normal (estado assentado não ganha tinta); âmbar
 *  com a memória acima de 85% ou um turno acima de 4 GB; vermelho acima de
 *  95%. CPU não pinta: pico de CPU é o trabalho acontecendo. Puro. */
export function tomDaMaquina(a: AmostraDoSistema, maiorTurnoMb: number): MeterTone {
  const uso = a.memTotalMb > 0 ? a.memUsadaMb / a.memTotalMb : 0
  if (uso >= 0.95) return "danger"
  if (uso >= 0.85 || maiorTurnoMb >= TURNO_PESADO_MB) return "warn"
  return "ok"
}

export interface TurnoNaMaquina {
  convId: string
  mb: number
  processos: number | null
}

/** Os turnos vivos com memória medida, do maior para o menor. Puro. */
export function turnosNaMaquina(
  liveness: Record<string, { rssMb: number | null; descendants: number | null }>,
  rodando: Set<string>,
): TurnoNaMaquina[] {
  return Object.entries(liveness)
    .filter(([conv, l]) => rodando.has(conv) && l.rssMb != null)
    .map(([convId, l]) => ({ convId, mb: l.rssMb!, processos: l.descendants }))
    .sort((a, b) => b.mb - a.mb)
}
