// A cota avisa ANTES de acabar (F2, ADR-276): quando o motor da conversa passa
// do limiar numa janela lida, ou o ritmo medido diz que ela acaba antes de
// voltar, e outro plano tem folga lida, o composer oferece revezar. Nada troca
// sozinho; escolher só prepara o próximo envio (ADR-165, ADR-206).
//
// Estado real: só leitura recente conta, ritmo só com duas leituras da MESMA
// janela, e motor sem medidor nunca ganha folga inventada.

import { agentDef } from "@/lib/agents"
import { METER_WARN_PCT } from "@/lib/meter"
import { snapshotUsable, type UsageSnapshot, type UsageWindowInfo } from "@/lib/usageWindow"

/** A partir daqui o motor está "perto do limite". */
export const LIMIAR_PERTO = 85
/** Folga mínima (% livre) para um plano ser sugerido como destino. */
export const FOLGA_MINIMA = 30

export interface Perto {
  janela: UsageWindowInfo
  motivo: "limiar" | "ritmo"
  /** Quando o ritmo medido leva a 100% (epoch ms). `null` sem ritmo. */
  acabaEm: number | null
  /** Quando a leitura chegou (epoch ms), para dizer a idade. */
  leituraEm: number
}

/** A janela ainda não virou: reset no futuro, ou reset desconhecido. Puro. */
function aindaVale(w: UsageWindowInfo, now: number): boolean {
  return w.resetsAt == null || w.resetsAt * 1000 > now
}

/** Quando o ritmo entre duas leituras da mesma janela leva a 100%. Puro. */
export function acabaEm(atual: UsageSnapshot, anterior: UsageSnapshot | undefined, w: UsageWindowInfo): number | null {
  const antes = anterior?.windows.find((x) => x.id === w.id && x.resetsAt === w.resetsAt)
  if (!anterior || !antes) return null
  const dt = atual.fetchedAt - anterior.fetchedAt
  const subiu = w.usedPercent - antes.usedPercent
  if (dt <= 0 || subiu <= 0) return null
  return atual.fetchedAt + ((100 - w.usedPercent) / subiu) * dt
}

/** O motor está perto do limite? Limiar numa janela lida, ou o ritmo diz que
 *  acaba antes de voltar (a partir do tom de alerta do medidor). Janela
 *  esgotada (100%) não é "perto": é o caso de `checkAgentQuota`. Puro. */
export function cotaPerto(
  atual: UsageSnapshot | undefined,
  anterior: UsageSnapshot | undefined,
  now: number,
): Perto | null {
  if (!atual || !snapshotUsable(atual, undefined, now)) return null
  const vivas = atual.windows.filter((w) => aindaVale(w, now) && w.usedPercent < 100)
  const pelaLeitura = vivas
    .filter((w) => w.usedPercent >= LIMIAR_PERTO)
    .sort((a, b) => b.usedPercent - a.usedPercent)[0]
  if (pelaLeitura) {
    return { janela: pelaLeitura, motivo: "limiar", acabaEm: acabaEm(atual, anterior, pelaLeitura), leituraEm: atual.fetchedAt }
  }
  let melhor: Perto | null = null
  for (const w of vivas) {
    if (w.usedPercent < METER_WARN_PCT || w.resetsAt == null) continue
    const fim = acabaEm(atual, anterior, w)
    if (fim == null || fim >= w.resetsAt * 1000) continue
    if (!melhor || fim < (melhor.acabaEm ?? Infinity)) {
      melhor = { janela: w, motivo: "ritmo", acabaEm: fim, leituraEm: atual.fetchedAt }
    }
  }
  return melhor
}

export type Folga =
  | { tipo: "folga"; livre: number; janela: string; leituraEm: number }
  | { tipo: "sem-leitura" }
  | { tipo: "sem-medidor" }

/** Quanto do plano deste motor está livre, pela pior janela lida. Pergunta ao
 *  registry quem tem medidor (`usageWindow`), nunca o nome. Puro. */
export function folgaDoMotor(agent: string, snap: UsageSnapshot | undefined, now: number): Folga {
  if (!agentDef(agent)?.usageWindow) return { tipo: "sem-medidor" }
  if (!snap || !snapshotUsable(snap, undefined, now)) return { tipo: "sem-leitura" }
  const pior = snap.windows.filter((w) => aindaVale(w, now)).sort((a, b) => b.usedPercent - a.usedPercent)[0]
  if (!pior) return { tipo: "sem-leitura" }
  return { tipo: "folga", livre: Math.max(0, Math.round(100 - pior.usedPercent)), janela: pior.label, leituraEm: snap.fetchedAt }
}

/** Algum destino tem folga lida que vale sugerir? Puro. */
export function temPlanoComFolga(folgas: readonly Folga[]): boolean {
  return folgas.some((f) => f.tipo === "folga" && f.livre >= FOLGA_MINIMA)
}

// "Agora não" encerra o EPISÓDIO: a mesma conversa, o mesmo motor e a mesma
// janela até ela virar. Memória de módulo, como os avisos do watchdog.
const dispensados = new Set<string>()

export function chaveDoEpisodio(convId: string, agent: string, p: Perto): string {
  return `${convId}:${agent}:${p.janela.id}:${p.janela.resetsAt ?? "?"}`
}

export function dispensarEpisodio(chave: string): void {
  dispensados.add(chave)
}

export function episodioDispensado(chave: string): boolean {
  return dispensados.has(chave)
}

/** Só para os testes. */
export function _resetEpisodios(): void {
  dispensados.clear()
}
