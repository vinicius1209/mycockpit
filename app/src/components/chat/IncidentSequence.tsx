import { memo } from "react"
import { ChevronRight } from "lucide-react"
import { TurnActions, type FeedbackApi } from "@/components/chat/TurnActions"
import { TurnTelemetry } from "@/components/chat/TurnTelemetry"
import {
  incidentPresentation,
  type IncidentStage,
} from "@/components/chat/incidentPresentation"
import type { IncidentNode } from "@/components/chat/messageNodes"
import { controle } from "@/components/ui/controle"
import { cn } from "@/lib/utils"

function markerClass(
  stage: IncidentStage,
  severity: IncidentNode["severity"],
): string {
  if (stage.tone === "incident") {
    return severity === "limit" ? "bg-st-warning" : "bg-st-error"
  }
  if (stage.tone === "settled") return "bg-muted-foreground/55"
  return "border bg-background"
}

export const IncidentSequence = memo(function IncidentSequence({
  incident,
  feedback,
  feedbackText,
}: {
  incident: IncidentNode
  feedback?: FeedbackApi | null
  feedbackText?: string
}) {
  const presentation = incidentPresentation(incident)
  const hasTechnicalDetails = Boolean(
    incident.result || incident.details.length > 0,
  )

  return (
    <section
      aria-label={presentation.title}
      data-incident-severity={presentation.severity}
      className="@container py-2"
    >
      <h3 className="text-[14px] font-semibold text-foreground">
        {presentation.title}
      </h3>

      <ol className="mt-5 grid grid-cols-1 gap-5 @min-[560px]:grid-cols-3 @min-[560px]:gap-4">
        {presentation.stages.map((stage, index) => (
          <li
            key={stage.id}
            data-stage-tone={stage.tone}
            className="relative min-w-0 pl-6 @min-[560px]:pt-5 @min-[560px]:pl-0"
          >
            {index < presentation.stages.length - 1 && (
              <span
                aria-hidden
                className="absolute top-3 bottom-[-20px] left-[5px] border-l border-border/40 @min-[560px]:top-[5px] @min-[560px]:right-[-16px] @min-[560px]:bottom-auto @min-[560px]:left-[10px] @min-[560px]:border-t @min-[560px]:border-l-0"
              />
            )}
            <span
              aria-hidden
              className={cn(
                "absolute top-1 left-0 z-10 size-2 rounded-full @min-[560px]:top-px",
                markerClass(stage, presentation.severity),
              )}
            />
            {stage.meta && (
              <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
                {stage.meta}
              </span>
            )}
            <strong
              className={cn(
                "block text-[13px] font-medium text-foreground",
                stage.meta && "mt-1",
              )}
            >
              {stage.title}
            </strong>
            <p className="mt-1 max-w-52 text-[12px] leading-relaxed text-muted-foreground">
              {stage.description}
            </p>
          </li>
        ))}
      </ol>

      {hasTechnicalDetails && (
        <div className="mt-5 flex flex-wrap items-start justify-between gap-2 border-t border-border/40 pt-2">
          <details className="group/details min-w-0 flex-1">
            <summary
              className={cn(
                controle("compacto"),
                "w-max cursor-pointer list-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&::-webkit-details-marker]:hidden",
              )}
            >
              <ChevronRight className="size-3.5 transition-transform group-open/details:rotate-90" />
              Detalhes técnicos
            </summary>
            <div className="mt-2 rounded-md bg-secondary/60 px-3 py-2.5">
              {incident.result && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <TurnTelemetry
                    it={incident.result}
                    incidentTone={
                      presentation.severity === "limit" ? "limit" : undefined
                    }
                  />
                  {feedback && (
                    <TurnActions
                      it={incident.result}
                      feedbackText={feedbackText}
                      api={feedback}
                    />
                  )}
                </div>
              )}
              {incident.details.length > 0 && (
                <div
                  data-selectable
                  className={cn(
                    "max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground",
                    incident.result && "mt-2 border-t border-border/40 pt-2",
                  )}
                >
                  {incident.details.join("\n")}
                </div>
              )}
            </div>
          </details>
        </div>
      )}
    </section>
  )
})
