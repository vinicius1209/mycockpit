// RESUMO da missão terminada. Extraído da MissionTimeline sem mudança de
// comportamento.

import { useMemo } from "react"
import { AlertTriangle, Check, X } from "lucide-react"
import { Markdown } from "@/components/common/Markdown"
import { fmtCost } from "@/lib/format"
import { planCounts, type MissionPhaseRun, type MissionRun } from "@/lib/missionTypes"
import { cn } from "@/lib/utils"

/** Último texto significativo de uma fase (o resumo/veredito do agent). */
function lastText(phase: MissionPhaseRun | undefined): string | null {
  const items = phase?.items ?? []
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if ((it.kind === "text" || it.kind === "result") && it.text?.trim()) {
      return it.text
    }
  }
  return null
}

/** Resumo da conclusão: veredito (texto final da última fase) + ações genéricas.
 *  O entregável NÃO é sempre um app — a ação primária é "ver as mudanças", não
 *  "abrir a entrega" (obs. do Vinícius). Resumo estruturado (open questions,
 *  como testar) vem na onda 2, lendo os handoffs. */
export function DoneSummary({ mission }: { mission: MissionRun }) {
  const verdict = useMemo(() => {
    for (let i = mission.phases.length - 1; i >= 0; i--) {
      const t = lastText(mission.phases[i])
      if (t) return t
    }
    return null
  }, [mission.phases])
  const ok = mission.status === "done"
  // MH1.1 — done com ressalva: o revisor não aprovou; dizer "concluída" seco
  // aqui seria a mentira que o plano fecha.
  const caveat = ok ? (mission.reviewCaveat ?? null) : null
  // "6 fases" no fim de uma missão que decolou com 4 esconde metade da
  // história: o resumo declara com quantas ela lançou.
  const counts = planCounts(mission.phases.map((p) => p.def))
  return (
    <div className="mt-4 overflow-hidden rounded-xl border bg-card">
      <div
        className={cn(
          "flex items-center gap-2.5 border-b px-4 py-3",
          caveat
            ? "bg-st-warning/[0.06]"
            : ok
              ? "bg-st-success/[0.05]"
              : "bg-st-error/[0.05]",
        )}
      >
        {caveat ? (
          <AlertTriangle className="size-4 shrink-0 text-st-warning" />
        ) : ok ? (
          <Check className="size-4 shrink-0 text-st-success" />
        ) : (
          <X className="size-4 shrink-0 text-st-error" />
        )}
        <span
          className={cn(
            "text-[13px] font-semibold",
            caveat ? "text-st-warning" : ok ? "text-st-success" : "text-st-error",
          )}
        >
          {caveat
            ? "Missão concluída com ressalva"
            : ok
              ? "Missão concluída"
              : "Missão interrompida"}
        </span>
        <span className="ml-auto font-mono text-[12px] tabular-nums text-muted-foreground">
          {counts.appended > 0
            ? `${counts.total} fases (${counts.launched} no lançamento, ${counts.appended} no voo)`
            : `${counts.total} fases`}{" "}
          · {fmtCost(mission.costTotal)}
        </span>
      </div>
      {caveat && (
        <p className="border-b px-4 py-2.5 text-[12px] leading-snug text-st-warning">
          O revisor não aprovou a entrega
          {caveat.rounds > 0
            ? ` após ${caveat.rounds} ${caveat.rounds === 1 ? "rodada" : "rodadas"} de correção`
            : ""}
          . Revise o parecer abaixo antes de confiar no resultado.
        </p>
      )}
      {verdict ? (
        <div className="px-4 py-3">
          <div className="label-mono mb-1.5">Resumo do revisor</div>
          <div className="max-h-72 overflow-y-auto text-[13px] leading-relaxed">
            <Markdown text={verdict} />
          </div>
        </div>
      ) : mission.doneSummary?.intent ? (
        <div className="px-4 py-3">
          <div className="label-mono mb-1.5">O que foi feito</div>
          <p className="text-[13px] leading-relaxed">
            {mission.doneSummary.intent}
          </p>
        </div>
      ) : (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">
          As mudanças estão no projeto. Continue a conversa abaixo pra pedir o
          resumo, testar ou seguir de onde parou.
        </p>
      )}
      {mission.doneSummary?.filesTouched &&
        mission.doneSummary.filesTouched.length > 0 && (
          <div className="border-t px-4 py-3">
            <div className="label-mono mb-1.5">Arquivos</div>
            <div className="flex flex-wrap gap-1.5">
              {mission.doneSummary.filesTouched.slice(0, 8).map((f) => (
                <code
                  key={f}
                  className="rounded bg-accent px-1.5 py-0.5 font-mono text-[11px]"
                >
                  {f}
                </code>
              ))}
              {mission.doneSummary.filesTouched.length > 8 && (
                <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  +{mission.doneSummary.filesTouched.length - 8}
                </code>
              )}
            </div>
          </div>
        )}
      {mission.doneSummary?.openQuestions &&
        mission.doneSummary.openQuestions.length > 0 && (
          <div className="border-t px-4 py-3">
            <div className="label-mono mb-1.5">
              Pendências pra próxima etapa
            </div>
            {mission.doneSummary.openQuestions.slice(0, 5).map((q, i) => (
              <div key={i} className="flex items-start gap-2 py-1 text-[13px]">
                <span className="shrink-0 font-mono text-[11px] font-semibold text-brass">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{q}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}
