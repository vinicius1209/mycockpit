// MH4.3 — o índice `missions` (lib/db) ganha consumidor REAL: histórico leve
// das missões do projeto no painel de contexto. Cada linha: data, tarefa
// truncada, desfecho honesto (done limpo, ressalva do revisor via
// reviewCaveat, falha, interrompida), custo e "Ver arquivos" (reusa o viewer
// MissionFilesDialog: plano/relatórios/handoffs da pasta isolada da missão).
// Best-effort como todo o histórico: listMissions devolve [] em falha e a
// seção degrada, nunca derruba o painel.

import { useEffect, useState } from "react"
import { FolderOpen, Rocket } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtCost } from "@/lib/format"
import { isTauri, listMissions, type MissionIndexRow } from "@/lib/db"
import { MissionFilesDialog } from "@/components/mission/MissionFilesDialog"
import { useChat } from "@/store/chat"

/** Quantas missões a seção mostra (histórico leve, não um explorador). */
const MAX_ROWS = 8

/** Desfecho humano da linha: status do índice + a ressalva do MH1.1. O índice
 *  não distingue teto de falha comum (só o run em memória sabia o motivo);
 *  ambos aparecem como "falha", furo registrado no mission-hardening-plan. */
function outcome(m: MissionIndexRow): { label: string; cls: string } {
  if (m.status === "running") {
    return { label: "em voo", cls: "bg-st-running/15 text-st-running" }
  }
  if (m.status === "done" && m.reviewCaveat) {
    return { label: "ressalva", cls: "bg-st-queued/15 text-st-queued" }
  }
  if (m.status === "done") {
    // Missão concluída é estado ambiente permanente na lateral: cinza
    // (STYLEGUIDE §2). O marco verde já foi dado no fio, na hora.
    return { label: "concluída", cls: "bg-muted text-muted-foreground" }
  }
  if (m.status === "aborted") {
    return { label: "interrompida", cls: "bg-secondary text-muted-foreground/70" }
  }
  return { label: "falha", cls: "bg-st-error/15 text-st-error" }
}

function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  })
}

export function MissionsSection({
  projectId,
  projectPath,
}: {
  projectId: string
  projectPath: string
}) {
  const [missions, setMissions] = useState<MissionIndexRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [viewer, setViewer] = useState<MissionIndexRow | null>(null)
  // worktrees das conversas do projeto (o cwd real dos artefatos de cada
  // missão): a missão rodou no worktree da conversa dela quando havia um,
  // senão na pasta do projeto.
  const convs = useChat((s) => s.conversationsByProject[projectId])

  useEffect(() => {
    let cancelled = false
    if (!isTauri()) {
      setLoaded(true)
      return
    }
    void listMissions(projectId, MAX_ROWS).then((rows) => {
      if (cancelled) return
      setMissions(rows)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (!loaded) return null
  if (missions.length === 0) {
    return (
      <p className="text-[11.5px] leading-snug text-muted-foreground/70">
        Nenhuma missão neste projeto ainda. O histórico de cada pipeline
        (desfecho, custo e artefatos) aparece aqui.
      </p>
    )
  }

  /** cwd dos artefatos da missão: worktree da conversa dela, senão o projeto. */
  const cwdFor = (m: MissionIndexRow): string =>
    convs?.find((c) => c.id === m.convId)?.worktreePath ?? projectPath

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {missions.map((m) => {
          const o = outcome(m)
          return (
            <li
              key={m.id}
              className="group/mission flex items-start gap-1.5 rounded-md bg-secondary/40 px-2 py-1.5"
            >
              <Rocket className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
              <span className="min-w-0 flex-1">
                <span
                  className="line-clamp-1 text-[11.5px] leading-snug text-foreground/90"
                  title={m.task}
                >
                  {m.task}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded px-1 py-px text-[9.5px] font-medium tracking-wide uppercase",
                      o.cls,
                    )}
                  >
                    {o.label}
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground/55">
                    {fmtDay(m.createdAt)}
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground/55">
                    · {fmtCost(m.costTotal)}
                  </span>
                  {m.presetName && (
                    <span className="text-[10px] text-muted-foreground/55">
                      · {m.presetName}
                    </span>
                  )}
                </span>
              </span>
              <button
                onClick={() => setViewer(m)}
                title="Ver arquivos da missão (plano, relatórios, handoffs)"
                aria-label={`Ver arquivos da missão: ${m.task}`}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/mission:opacity-100 hover:text-brass"
              >
                <FolderOpen className="size-3.5" />
              </button>
            </li>
          )
        })}
      </ul>

      {viewer && (
        <MissionFilesDialog
          open
          onOpenChange={(v) => !v && setViewer(null)}
          cwd={cwdFor(viewer)}
          dir={viewer.dir}
          slug={viewer.slug}
        />
      )}
    </div>
  )
}
