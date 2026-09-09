/** Diagnóstico efêmero do processo do run. Métrica/sonda não é progresso e,
 * por isso, nunca participa da assinatura do watchdog. */
export interface RunLiveness {
  mainAlive: boolean | null
  descendants: number | null
  rssMb: number | null
  lastByteAt: number | null
  lastEventAt: number | null
  observedAt: number | null
}
