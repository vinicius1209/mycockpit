// Store dos snapshots de JANELA DE USO (medidor de rate limit por provider).
// Alimentado por DOIS caminhos, ambos fora daqui (lib/usageWindow): o push da
// statusline (evento `usage://snapshot` do receptor H0) e o poll do vigia
// (usage_fetch). NÃO persiste: snapshot é dado vivo com stale-drop de 30 min —
// depois de um restart, o poll repõe em segundos e a statusline no próximo
// turno; ressuscitar dado velho do disco seria fingir frescor (estado real,
// nunca teatro). O que persiste (toggle, CTA dispensado) mora em
// settings (lib/settings.ts).

import { create } from "zustand"
import type { UsageFailure, UsageSnapshot } from "@/lib/usageWindow"

interface UsageStore {
  /** Último snapshot por agent (fonte única da pill/popover). */
  byAgent: Record<string, UsageSnapshot>
  /** A leitura ANTERIOR à atual de cada agent: com ela o ritmo da janela vira
   *  projeção (`lib/cotaAntecipada`). Uma leitura só não projeta nada. */
  anterior: Record<string, UsageSnapshot>
  /** Episódio de falha de poll por agent ("falhando desde X"). Statusline
   *  (push) não gera falha — a idade do snapshot cobre o silêncio. */
  failures: Record<string, UsageFailure>
  /** Quando o agent CONCLUIU um turno pela última vez. Não é telemetria: é
   *  contraprova. O poll roda a cada 15 min e o snapshot vale por 30, então uma
   *  leitura de "100%" sobrevive muito depois de a janela ter virado — e quem
   *  soube primeiro que ela virou foi o turno que passou. Ver
   *  `checkAgentQuota`. */
  lastSuccessAt: Record<string, number>
  /** Snapshot novo substitui o do agent e FECHA o episódio de falha (dado
   *  fresco é a prova de que a fonte voltou). */
  ingest: (snap: UsageSnapshot) => void
  /** Falha de poll: abre (ou estende) o episódio — `since` fica na 1ª falha
   *  da streak, é o "desde X" honesto do popover. */
  recordFailure: (agent: string, kind: string, message: string, now: number) => void
  /** Um turno deste agent terminou com `result.ok`. */
  recordTurnSuccess: (agent: string, now: number) => void
}

export const useUsage = create<UsageStore>((set) => ({
  byAgent: {},
  anterior: {},
  failures: {},
  lastSuccessAt: {},
  ingest: (snap) =>
    set((s) => {
      const { [snap.agent]: _closed, ...rest } = s.failures
      const antes = s.byAgent[snap.agent]
      return {
        byAgent: { ...s.byAgent, [snap.agent]: snap },
        anterior: antes && antes.fetchedAt < snap.fetchedAt ? { ...s.anterior, [snap.agent]: antes } : s.anterior,
        failures: rest,
      }
    }),
  recordTurnSuccess: (agent, now) =>
    set((s) => ({ lastSuccessAt: { ...s.lastSuccessAt, [agent]: now } })),
  recordFailure: (agent, kind, message, now) =>
    set((s) => {
      const prev = s.failures[agent]
      return {
        failures: {
          ...s.failures,
          [agent]: {
            kind,
            message,
            since: prev?.since ?? now,
            streak: (prev?.streak ?? 0) + 1,
          },
        },
      }
    }),
}))
