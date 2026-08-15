// O TRILHO DE ETAPAS do modo SDD, com o popover de resumo por etapa.
//
// Saiu do `SddView.tsx` em 15/08/2026, pela catraca do §10: o arquivo estava
// colado no teto congelado (1646) e a passada que despintou o ponto de etapa
// concluída não cabia. A regra é dividir, nunca subir o teto, e este é o
// recorte natural, porque é a peça que a passada mexeu: `Pipeline` só é usada
// num lugar (`PlanDetail`) e `evidenceSignals`/`stageSummary`/`StagePopover`
// só existem para ela.
import { Fragment } from "react"
import {
  effectiveStage,
  stagesForTrack,
  stageLabel,
  stageIndex,
  gateCounts,
  type SddPlan,
  type PrInfo,
} from "@/lib/sdd"
import { fmtDateTime, gateSummary, prLabel } from "@/components/sdd/sddFormat"
import { cn } from "@/lib/utils"

function evidenceSignals(plan: SddPlan, pr: PrInfo | null): string {
  const sig: string[] = []
  if (plan.evidence?.prdFile) sig.push("PRD.md no disco")
  if (plan.evidence?.specFile) sig.push("SPEC.md no disco")
  if (plan.evidence?.branchCommits) sig.push("branch com commits")
  if (pr) sig.push(pr.state === "MERGED" ? "PR mergeada" : "PR existente")
  return sig.length
    ? `Sinais (fs + git + gh): ${sig.join(" · ")}. O manifest declara "${stageLabel(plan.stage)}".`
    : `Detectado além do declarado ("${stageLabel(plan.stage)}").`
}

export function Pipeline({
  plan,
  pr,
  onMarkStage,
}: {
  plan: SddPlan
  pr: PrInfo | null
  /** Escape manual: clicar numa etapa FUTURA a marca como atual (com confirm). */
  onMarkStage?: (stage: string) => void
}) {
  // trilha do plano (quick pula PRD/SPEC) + stage EFETIVO por evidência: o trilho
  // mostra a realidade, não o cache declarado do manifest.
  const stages = stagesForTrack(plan.track)
  const effective = effectiveStage(plan, pr)
  const drift = stageIndex(effective) > stageIndex(plan.stage)
  const cur = stageIndex(effective)
  const completed = new Set(plan.stagesCompleted)
  const allDone = effective === "done"
  return (
    <div className="rounded-xl border bg-card px-5 py-4">
      {drift && (
        <div className="mb-3 flex justify-end">
          <span
            title={evidenceSignals(plan, pr)}
            className="cursor-help rounded-full border border-brass/30 bg-brass/5 px-2 py-0.5 text-[11px] text-brass/80"
          >
            {stageLabel(effective)} · detectado pela evidência
          </span>
        </div>
      )}
      {/* trilho: pontos espalhados pela largura (conectores flex), sem scroll */}
      <div className="flex items-start">
        {stages.map((s, i) => {
          const isCurrent = s === effective
          const isDone =
            allDone ||
            completed.has(s) ||
            (cur >= 0 && stageIndex(s) < cur && s !== "done")
          return (
            <Fragment key={s}>
              {i > 0 && (
                <div
                  className={cn(
                    "mt-[5px] h-px flex-1",
                    isDone || isCurrent ? "bg-foreground/30" : "bg-border",
                  )}
                />
              )}
              <div className="group relative flex shrink-0 flex-col items-center gap-2">
                {/* etapa FUTURA + handler → clicável (escape manual p/ quando a
                    evidência não alcança: trabalho em branch diferente etc.) */}
                {!isCurrent && !isDone && onMarkStage ? (
                  <button
                    onClick={() => onMarkStage(s)}
                    title={`Marcar "${stageLabel(s)}" como etapa atual`}
                    aria-label={`Marcar ${stageLabel(s)} como etapa atual`}
                    className="size-2.5 cursor-pointer rounded-full bg-muted-foreground/25 transition-all hover:scale-125 hover:bg-foreground/60 hover:ring-[3px] hover:ring-sel"
                  />
                ) : (
                  <span
                    className={cn(
                      "size-2.5 rounded-full transition-colors",
                      isCurrent
                        ? "bg-foreground ring-[3px] ring-sel"
                        : isDone
                          ? // Verde era estado AMBIENTE permanente numa lista,
                            // o padrão que o §9 item 4 matou no resto do app.
                            // A distinção já está no texto e no peso (rótulo
                            // `text-foreground/65` × `muted-foreground/45`, e o
                            // conector `bg-foreground/30` × `bg-border`), que é
                            // a régua que ficou daquele item: dot ambiente é
                            // cinza; quem distingue dois estados saudáveis é o
                            // texto, não a tinta.
                            "bg-foreground/40"
                          : "bg-muted-foreground/25",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "text-[11px] whitespace-nowrap",
                    isCurrent
                      ? "font-medium text-foreground"
                      : isDone
                        ? "text-foreground/65"
                        : "text-muted-foreground/45",
                  )}
                >
                  {stageLabel(s)}
                </span>
                <StagePopover stage={s} plan={plan} />
              </div>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

/** Resumo de um estágio (hover na pipeline), só dado do manifest, sem dirigir. */
function stageSummary(stage: string, plan: SddPlan): string[] {
  const a = plan.artifacts
  switch (stage) {
    case "discovery":
      return ["Refinamento do escopo"]
    case "prd":
      return a.prd
        ? [`${a.prd.path} · ${a.prd.approved ? "aprovado" : "não aprovado"}`]
        : ["sem PRD"]
    case "spec":
      return [
        a.spec?.path ?? "SPEC.md",
        `${plan.scenarioMatrix.length} cenários · ${plan.navSurfaces.length} superfícies`,
      ]
    case "implementation":
      return [`${a.sourceFiles.length} arquivos · ${a.migrations.length} migrações`]
    case "test":
      return [`${a.tests.length} testes`]
    case "review": {
      const c = gateCounts(plan.verification)
      return [gateSummary(c) || "sem gates registrados"]
    }
    case "pr":
      return [
        plan.links.pr_url ? prLabel(plan.links.pr_url) : "sem PR",
        plan.mergedAt ? `mergeado ${fmtDateTime(plan.mergedAt)}` : "",
      ].filter(Boolean)
    case "done":
      return [plan.mergedAt ? `concluído ${fmtDateTime(plan.mergedAt)}` : "concluído"]
    default:
      return []
  }
}

function StagePopover({ stage, plan }: { stage: string; plan: SddPlan }) {
  const lines = stageSummary(stage, plan)
  if (lines.length === 0) return null
  return (
    <div className="pointer-events-none invisible absolute top-full left-1/2 z-20 mt-2 w-max max-w-[220px] -translate-x-1/2 rounded-lg border bg-popover p-2.5 text-left opacity-0 shadow-[var(--shadow-pop)] transition-opacity group-hover:visible group-hover:opacity-100">
      <p className="mb-0.5 text-[11px] font-medium text-foreground">
        {stageLabel(stage)}
      </p>
      {lines.map((l, i) => (
        <p key={i} className="text-[12px] leading-relaxed text-muted-foreground">
          {l}
        </p>
      ))}
    </div>
  )
}
