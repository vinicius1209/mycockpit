// O aviso ANTES de a cota acabar (F2, ADR-276), na mesma porta de
// continuidade do composer (`ContinuityBanner`): a mesma casca, as mesmas
// opções de motor e o mesmo gesto de preparar o próximo envio. O que muda é o
// momento: o motor ainda responde, e cada destino diz a folga que foi LIDA.

import { useEffect, useState } from "react"
import { Clock, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { agentDef } from "@/lib/agents"
import {
  chaveDoEpisodio,
  cotaPerto,
  dispensarEpisodio,
  episodioDispensado,
  folgaDoMotor,
  temPlanoComFolga,
  type Folga,
  type Perto,
} from "@/lib/cotaAntecipada"
import { loadLedger } from "@/lib/db"
import { fmtAgo, fmtCost, fmtTime } from "@/lib/format"
import { gastoDaFaixa } from "@/lib/gastoDaFaixa"
import { eligibleHandoffTargets } from "@/lib/quotaExhausted"
import { useApp } from "@/store/app"
import { useChat, type ConvState } from "@/store/chat"
import { useUsage } from "@/store/usage"
import { SELECTED_FILL, UNSELECTED } from "@/lib/selection"
import { cn } from "@/lib/utils"

export interface DestinoComFolga {
  id: string
  label: string
  folga: Folga
  /** Gasto de hoje, para quem não tem medidor (o que a Frota sabe dele). */
  gastoHoje: number | null
}

/** "em 2h 10min", "em 40min". Puro. */
function emQuanto(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  const h = Math.floor(min / 60)
  const m = min % 60
  return h === 0 ? `em ${m}min` : m === 0 ? `em ${h}h` : `em ${h}h ${m}min`
}

/** Título e detalhe do aviso. Puro. */
export function textoDoAviso(sourceLabel: string, p: Perto, now: number): { titulo: string; detalhe: string } {
  const usado = Math.round(p.janela.usedPercent)
  const volta = p.janela.resetsAt != null ? p.janela.resetsAt * 1000 : null
  const quandoVolta = volta != null ? `volta às ${fmtTime(volta)} (${emQuanto(volta - now)})` : "sem horário de volta informado"
  if (p.motivo === "ritmo" && p.acabaEm != null) {
    return {
      titulo: `No ritmo de agora, ${sourceLabel} acaba antes de voltar`,
      detalhe: `${usado}% usado (${p.janela.label}). Chega a 100% por volta das ${fmtTime(p.acabaEm)}; ${quandoVolta}. Estimativa pelo ritmo medido, não promessa.`,
    }
  }
  const ritmo = p.acabaEm != null && volta != null && p.acabaEm < volta ? ` No ritmo de agora, chega a 100% por volta das ${fmtTime(p.acabaEm)}.` : ""
  return {
    titulo: `${sourceLabel} perto do limite (${p.janela.label})`,
    detalhe: `${usado}% usado · ${quandoVolta}.${ritmo} Se preferir não esperar, o próximo pedido pode ir para um plano com folga. Nada muda até você escolher.`,
  }
}

/** A folga como se lê ao lado do nome do motor. Puro. */
export function textoDaFolga(d: DestinoComFolga): string {
  if (d.folga.tipo === "folga") return `${d.folga.livre}% livre · ${d.folga.janela}`
  if (d.folga.tipo === "sem-leitura") return "sem leitura recente"
  return d.gastoHoje != null && d.gastoHoje > 0 ? `sem medidor · ${fmtCost(d.gastoHoje)} hoje` : "sem medidor"
}

export function CotaPertoBanner({
  sourceLabel,
  perto,
  destinos,
  now,
  onSelect,
  onDismiss,
}: {
  sourceLabel: string
  perto: Perto
  destinos: DestinoComFolga[]
  now: number
  onSelect: (agent: string) => void
  onDismiss: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = destinos.find((d) => d.id === selectedId) ?? null
  const { titulo, detalhe } = textoDoAviso(sourceLabel, perto, now)
  const Icone = perto.motivo === "ritmo" ? Clock : Gauge
  return (
    <section
      data-continuity-state="perto"
      className="mb-2 rounded-lg border border-border-strong bg-card shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <Icone className="mt-0.5 size-4 shrink-0 text-st-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground">{titulo}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {detalhe} <span className="tabular-nums">Leitura {fmtAgo(now - perto.leituraEm)}.</span>
          </p>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2">
            <span className="text-[11px] text-muted-foreground">Próximo envio com:</span>
            <div
              role="group"
              aria-label="Escolher o plano do próximo envio"
              className="flex max-w-full min-w-0 flex-wrap gap-0.5 rounded-md border bg-background p-0.5"
            >
              {destinos.map((d) => {
                const escolhivel = d.folga.tipo !== "sem-leitura"
                const chosen = d.id === selected?.id
                return (
                  <Button
                    key={d.id}
                    type="button"
                    size="compacto"
                    variant="ghost"
                    disabled={!escolhivel}
                    aria-pressed={chosen}
                    title={escolhivel ? undefined : "Sem leitura recente do plano: escolha pelo seletor de motor, se quiser."}
                    className={cn(chosen ? SELECTED_FILL : UNSELECTED)}
                    onClick={() => setSelectedId(d.id)}
                  >
                    {d.label}
                    <span className="text-muted-foreground tabular-nums">{textoDaFolga(d)}</span>
                  </Button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/40 bg-background px-2 py-1.5 pl-10">
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="compacto" variant="ghost" className="text-muted-foreground" onClick={onDismiss}>
            Agora não
          </Button>
          {selected && (
            <Button type="button" size="compacto" onClick={() => onSelect(selected.id)}>
              Usar {selected.label} no próximo envio
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

/** Gasto de hoje por motor, lido do livro de custos só quando algum destino
 *  não tem medidor (é o que a Frota sabe dele). Falha de leitura: sem número. */
function useGastoDeHoje(ativo: boolean): Map<string, number> | null {
  const [gasto, setGasto] = useState<Map<string, number> | null>(null)
  useEffect(() => {
    if (!ativo) return
    let vivo = true
    void loadLedger(Date.now() - DIA_MS)
      .then((rows) => {
        if (vivo) setGasto(new Map(gastoDaFaixa(rows).porMotor.map((m) => [m.agent, m.hoje])))
      })
      .catch((err) => console.warn("[cota] não consegui ler o livro de custos:", err))
    return () => {
      vivo = false
    }
  }, [ativo])
  return gasto
}

const DIA_MS = 24 * 60 * 60 * 1000

/** O aviso com o estado que ele lê: medidor, leitura anterior, destinos
 *  elegíveis (a mesma régua do revezamento) e o episódio já dispensado. */
export function AvisoDeCotaPerto({ conv, activeId }: { conv: ConvState; activeId: string }) {
  const byAgent = useUsage((s) => s.byAgent)
  const anterior = useUsage((s) => s.anterior?.[conv.agent])
  const lastSuccessByAgent = useUsage((s) => s.lastSuccessAt)
  const limitedAgents = useApp((s) => s.limitedAgents)
  const detectados = useApp((s) => s.settings.detected)
  const [, reler] = useState(0)
  const now = Date.now()
  const perto = cotaPerto(byAgent[conv.agent], anterior, now)
  const chave = perto ? chaveDoEpisodio(activeId, conv.agent, perto) : null
  const aberto = !!chave && !episodioDispensado(chave)
  const destinos: DestinoComFolga[] = aberto
    ? eligibleHandoffTargets({
        currentAgent: conv.agent,
        detected: detectados ?? {},
        limitedAgents,
        byAgentSnapshots: byAgent,
        lastSuccessByAgent,
        now,
      }).map((a) => ({ id: a.id, label: a.label, folga: folgaDoMotor(a.id, byAgent[a.id], now), gastoHoje: null }))
    : []
  const gasto = useGastoDeHoje(destinos.some((d) => d.folga.tipo === "sem-medidor"))
  if (!perto || !chave || !aberto || !temPlanoComFolga(destinos.map((d) => d.folga))) return null
  return (
    <CotaPertoBanner
      sourceLabel={agentDef(conv.agent)?.label ?? conv.agent}
      perto={perto}
      destinos={destinos.map((d) => ({ ...d, gastoHoje: gasto?.get(d.id) ?? null }))}
      now={now}
      onSelect={(agent) => useChat.getState().stageAgent(activeId, agent)}
      onDismiss={() => {
        dispensarEpisodio(chave)
        reler((n) => n + 1)
      }}
    />
  )
}
