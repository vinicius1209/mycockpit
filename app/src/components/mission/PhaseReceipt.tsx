// A fase CONCLUÍDA que abre. Colapsada, a linha É a informação (entregável →
// impacto → duração → custo → quem fez). Aberta, mostra o que a fase fez E o
// que ela DECIDIU.
//
// As decisões vinham sendo jogadas fora: `HandoffDoc.decisions[]`
// (choice/rejected/reason) é parseado e injetado no prompt da fase seguinte, e
// o resumo final descartava. Numa fase concluída, "o que ela decidiu e o que
// rejeitou" vale mais que a lista de ferramentas. Zero dado novo: o arquivo
// está no worktree, e este componente o lê ao ABRIR (nada de campo novo no run,
// nada de leitura no caminho quente).

import { useEffect, useState } from "react"
import { buildPhaseFeed } from "@/lib/missionAction"
import { readHandoff, type HandoffDoc } from "@/lib/missionHandoff"
import { handoffFileName } from "@/lib/missionPaths"
import { phaseReceipt, receiptLine } from "@/lib/missionReceipt"
import type { MissionPhaseRun } from "@/lib/missionTypes"
import { cn } from "@/lib/utils"

/** Lê o handoff DESTA fase do worktree, só quando ela está aberta. null =
 *  o agente não deixou documento (ou o disco não respondeu): a UI mostra o que
 *  tem e não inventa o resto. */
function usePhaseHandoff(
  open: boolean,
  cwd: string,
  dir: string,
  index: number,
  persona: MissionPhaseRun["def"]["persona"],
): HandoffDoc | null {
  const [doc, setDoc] = useState<HandoffDoc | null>(null)
  useEffect(() => {
    if (!open || !cwd || !dir) return
    let vivo = true
    void readHandoff(cwd, handoffFileName(dir, index, persona)).then((d) => {
      if (vivo) setDoc(d)
    })
    return () => {
      vivo = false
    }
  }, [open, cwd, dir, index, persona])
  return doc
}

export function PhaseReceiptBlock({
  phase,
  index,
  cwd,
  dir,
  open,
  onToggle,
}: {
  phase: MissionPhaseRun
  index: number
  cwd: string
  dir: string
  open: boolean
  onToggle: () => void
}) {
  const r = phaseReceipt(phase)
  const doc = usePhaseHandoff(open, cwd, dir, index, phase.def.persona)
  const feed = open ? buildPhaseFeed(phase.items) : []
  return (
    <div className="mt-1 ml-[2px]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 text-left"
      >
        {/* a ordem é fixa e o resumo É a informação; o motor fica por último,
            em sussurro (quem varre fases concluídas procura o entregável) */}
        <span
          className={cn(
            "min-w-0 truncate font-mono text-[11px] tabular-nums",
            r.bad ? "text-st-error" : "text-faint",
          )}
        >
          {receiptLine(r)}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-faint underline decoration-border-strong underline-offset-2">
          {open ? "recolher" : "mostrar"}
        </span>
      </button>
      {open && (
        <div className="mt-2 border-l border-border pl-3">
          {feed.length > 0 ? (
            feed.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-2 py-[2px] text-[12px]"
              >
                <span className="w-3 text-center text-[11px] text-muted-foreground">
                  {row.kind === "acao" && row.state === "erro" ? "✗" : "✓"}
                </span>
                <span
                  className={cn(
                    "min-w-0 truncate",
                    row.kind === "acao" && row.state === "erro"
                      ? "text-st-error"
                      : "text-muted-foreground",
                  )}
                >
                  {row.label}
                </span>
              </div>
            ))
          ) : (
            <div className="text-[12px] text-faint">
              nenhuma ação relatada nesta fase
            </div>
          )}
          {/* O PORQUÊ, que já existia no disco e a tela jogava fora. */}
          {doc && doc.decisions.length > 0 && (
            <dl className="mt-2.5 grid grid-cols-[76px_1fr] gap-x-2.5 gap-y-1 text-[12px]">
              {doc.decisions.map((d, i) => (
                <FragmentDecision key={i} choice={d.choice} rejected={d.rejected} reason={d.reason} />
              ))}
            </dl>
          )}
          {doc && doc.open_questions.length > 0 && (
            <div className="mt-2.5 text-[12px] text-muted-foreground">
              <div className="label-mono mb-1">deixou pendente</div>
              {doc.open_questions.map((q, i) => (
                <div key={i} className="leading-snug">
                  {q}
                </div>
              ))}
            </div>
          )}
          {doc && doc.files_touched.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="label-mono">arquivos</span>
              {doc.files_touched.slice(0, 8).map((f) => (
                <code
                  key={f}
                  className="rounded bg-accent px-1.5 py-0.5 font-mono text-[11px]"
                >
                  {f}
                </code>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FragmentDecision({
  choice,
  rejected,
  reason,
}: {
  choice: string
  rejected?: string
  reason?: string
}) {
  return (
    <>
      <dt className="label-mono pt-[3px]">Decidiu</dt>
      <dd className="m-0 leading-snug text-muted-foreground">
        <b className="font-medium text-foreground">{choice}</b>
        {rejected ? `, no lugar de ${rejected}` : ""}
        {reason ? ` (motivo: ${reason})` : ""}
      </dd>
    </>
  )
}
