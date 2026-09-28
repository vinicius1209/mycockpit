// O aviso ANTES de a cota acabar (ADR-276). Não bloqueia nada, o motor ainda
// responde: é informação, e mora na tira presa ao composer (ADR-247, ADR-281),
// não em cartão. A gaveta traz as mesmas opções de motor e o mesmo gesto de
// preparar o próximo envio; cada destino diz a folga que foi LIDA.

import { useEffect, useState, type ReactNode } from "react"
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
import { deriveComposerContinuity } from "@/lib/composerContinuity"
import { checkAgentQuota, eligibleHandoffTargets } from "@/lib/quotaExhausted"
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

/** O que a tira do composer diz do aviso, numa linha: "Claude Code 98%". Puro. */
export function resumoDaCota(sourceLabel: string, p: Perto): string {
  return `${sourceLabel} ${Math.round(p.janela.usedPercent)}%`
}

/** O aviso aberto na gaveta da tira: o motivo, os destinos com a folga lida e
 *  as duas saídas. Recolher é clicar no segmento de novo; "Dispensar" encerra
 *  o episódio (até a janela virar). */
export function DetalheDaCota({
  sourceLabel,
  perto,
  destinos,
  now,
  onSelect,
  onDispensar,
}: {
  sourceLabel: string
  perto: Perto
  destinos: DestinoComFolga[]
  now: number
  onSelect: (agent: string) => void
  onDispensar: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = destinos.find((d) => d.id === selectedId) ?? null
  const { titulo, detalhe } = textoDoAviso(sourceLabel, perto, now)
  return (
    <section data-continuity-state="perto" aria-label={titulo}>
      <div className="px-3 pt-2 pb-2.5">
        <p className="text-[12px] font-medium text-foreground">{titulo}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {detalhe} <span className="tabular-nums">Leitura {fmtAgo(now - perto.leituraEm)}.</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">Próximo envio com:</span>
          <div
            role="group"
            aria-label="Escolher o plano do próximo envio"
            // Cabe na largura: com a conversa estreita, os destinos descem de linha.
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
      <div className="flex flex-wrap items-center justify-end gap-1 border-t border-border/40 px-2 py-1.5">
        <Button
          type="button"
          size="compacto"
          variant="ghost"
          className="text-muted-foreground"
          title={`Não avisa de novo nesta conversa até a janela de ${perto.janela.label} virar`}
          onClick={onDispensar}
        >
          Dispensar
        </Button>
        {selected && (
          <Button type="button" size="compacto" onClick={() => onSelect(selected.id)}>
            Usar {selected.label} no próximo envio
          </Button>
        )}
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

export interface CotaNaTira {
  /** O episódio: a gaveta nasce aberta na primeira vez que ele aparece. */
  chave: string
  resumo: string
  titulo: string
  motivo: Perto["motivo"]
  detalhe: ReactNode
}

/** O aviso com o estado que ele lê: medidor, leitura anterior, destinos
 *  elegíveis (a mesma régua do revezamento) e o episódio já dispensado. Some
 *  quando outra porta de continuidade está aberta (motor já escolhido, cota
 *  esgotada, turno interrompido), para nunca haver duas ofertas de troca. */
export function useCotaNaTira(
  conv: Pick<ConvState, "agent" | "items" | "running" | "finalizing" | "stagedAgent">,
  activeId: string | null,
): CotaNaTira | null {
  const byAgent = useUsage((s) => s.byAgent)
  const anterior = useUsage((s) => s.anterior?.[conv.agent])
  const lastSuccessByAgent = useUsage((s) => s.lastSuccessAt)
  const limitedAgents = useApp((s) => s.limitedAgents)
  const detectados = useApp((s) => s.settings.detected)
  const [, reler] = useState(0)
  const now = Date.now()
  const perto = activeId ? cotaPerto(byAgent[conv.agent], anterior, now) : null
  const chave = perto && activeId ? chaveDoEpisodio(activeId, conv.agent, perto) : null
  const quota = checkAgentQuota(conv.agent, limitedAgents, byAgent[conv.agent], undefined, lastSuccessByAgent[conv.agent])
  const outraPorta =
    !!conv.stagedAgent || !!deriveComposerContinuity(conv.items, conv.running || conv.finalizing, quota.exhausted)
  const aberto = !!chave && !episodioDispensado(chave) && !outraPorta
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
  if (!perto || !chave || !activeId || !aberto || !temPlanoComFolga(destinos.map((d) => d.folga))) return null
  const sourceLabel = agentDef(conv.agent)?.label ?? conv.agent
  return {
    chave,
    resumo: resumoDaCota(sourceLabel, perto),
    titulo: textoDoAviso(sourceLabel, perto, now).titulo,
    motivo: perto.motivo,
    detalhe: (
      <DetalheDaCota
        sourceLabel={sourceLabel}
        perto={perto}
        destinos={destinos.map((d) => ({ ...d, gastoHoje: gasto?.get(d.id) ?? null }))}
        now={now}
        onSelect={(agent) => useChat.getState().stageAgent(activeId, agent)}
        onDispensar={() => {
          dispensarEpisodio(chave)
          reler((n) => n + 1)
        }}
      />
    ),
  }
}
