// UI de AUDITORIA do auto-aprendizado (docs/autonomy.md, princípio nº3: "nunca
// promover memória sem revisão — aprendizado que você não audita degrada em
// silêncio"). Mostra, por projeto, as lições destiladas (M2), cada uma com
// status (estágio 1) + ações. O CURADOR (estágio 3) roda no botão "Revisar
// memória": deduplica e rebaixa ruído.
//
// Na aba "O que o agente vê" (ADR-237) a contagem de entregas no recall (M1)
// saiu: numa conversa ela não entra no prompt, só no plano de uma missão
// parecida. As aprovadas entram em todo turno; as candidatas só depois de
// aprovadas, e a tela diz isso.
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  ArrowDown,
  ArrowUp,
  GraduationCap,
  Globe2,
  Sparkles,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  isTauri,
  listLessons,
  setLessonStatus,
  type LessonRecord,
  type LessonStatus,
} from "@/lib/db"
import { runCurator } from "@/lib/learning"

/** Rótulo humano da origem da lição (o campo `source`). */
const SOURCE_LABEL: Record<string, string> = {
  reviewer: "reviewer",
  gate: "gate",
  linear: "chat",
}

/** Rótulo do status (estágio 1). `active` injeta; os demais, não. */
const STATUS_LABEL: Record<LessonStatus, string> = {
  active: "ativa",
  candidate: "candidata",
  archived: "arquivada",
}

export function LearningSection({ projectId }: { projectId: string }) {
  const [lessons, setLessons] = useState<LessonRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [curating, setCurating] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!isTauri()) {
      setLoaded(true)
      return
    }
    void listLessons(projectId).then((ls) => {
      if (cancelled) return
      setLessons(ls)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  async function remove(id: string) {
    const priorIndex = lessons.findIndex((lesson) => lesson.id === id)
    const prior = lessons[priorIndex]
    // “Descartar” grava um tombstone reversível. Apagar a linha tornava a mesma
    // regra inédita de novo e permitia que a destilação a ressuscitasse.
    setLessons((cur) => cur.filter((l) => l.id !== id))
    try {
      await setLessonStatus(id, "archived")
    } catch {
      setLessons((cur) => {
        if (!prior || cur.some((lesson) => lesson.id === id)) return cur
        const next = [...cur]
        next.splice(Math.min(priorIndex, next.length), 0, prior)
        return next
      })
      toast.error("Não foi possível descartar a memória.")
    }
  }

  async function changeStatus(id: string, status: LessonStatus) {
    // otimista: promover/rebaixar é reversível (só muda o status, não exclui).
    const priorStatus = lessons.find((lesson) => lesson.id === id)?.status
    setLessons((cur) => cur.map((l) => (l.id === id ? { ...l, status } : l)))
    try {
      await setLessonStatus(id, status)
    } catch {
      if (priorStatus) {
        setLessons((cur) =>
          cur.map((lesson) =>
            lesson.id === id ? { ...lesson, status: priorStatus } : lesson,
          ),
        )
      }
      toast.error("Não foi possível alterar a memória.")
    }
  }

  async function review() {
    if (curating) return
    setCurating(true)
    try {
      const { deduped, demoted } = await runCurator(projectId)
      const fresh = await listLessons(projectId)
      setLessons(fresh)
      if (deduped === 0 && demoted === 0) {
        toast("Memória revisada, nada a mudar.")
      } else {
        toast(`${deduped} deduplicada(s), ${demoted} rebaixada(s).`)
      }
    } finally {
      setCurating(false)
    }
  }

  if (!loaded) return null
  const visibleLessons = lessons.filter((lesson) => lesson.status !== "archived")
  if (visibleLessons.length === 0) {
    return (
      <p className="text-[12px] leading-snug text-muted-foreground/70">
        Nenhuma lição ainda. Quando o revisor de uma missão corrige algo, vira
        uma lição para você aprovar; aprovada, ela entra em todo turno.
      </p>
    )
  }

  const active = visibleLessons.filter((lesson) => lesson.status === "active")
  const dormant = visibleLessons.filter((lesson) => lesson.status === "candidate")

  return (
    <div className="flex flex-col gap-2.5">
      {active.length === 0 && (
        <p className="text-[12px] leading-snug text-muted-foreground/70">
          Nenhuma lição aprovada: nada daqui entra no turno por enquanto.
        </p>
      )}
      {active.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] text-muted-foreground/55">
            Aprovadas · entram todo turno ({active.length})
          </div>
          <ul className="flex flex-col gap-1">
            {active.map((l) => (
              <LessonRow
                key={l.id}
                lesson={l}
                onRemove={() => void remove(l.id)}
                onChangeStatus={(s) => void changeStatus(l.id, s)}
              />
            ))}
          </ul>
        </div>
      )}

      {dormant.length > 0 && (
        <div className="flex flex-col gap-1 opacity-70">
          <div className="text-[11px] text-muted-foreground/45">
            Esperando você · só entram depois de aprovadas ({dormant.length})
          </div>
          <ul className="flex flex-col gap-1">
            {dormant.map((l) => (
              <LessonRow
                key={l.id}
                lesson={l}
                onRemove={() => void remove(l.id)}
                onChangeStatus={(s) => void changeStatus(l.id, s)}
              />
            ))}
          </ul>
        </div>
      )}

      {visibleLessons.length > 0 && (
        <button
          onClick={() => void review()}
          disabled={curating}
          className="flex items-center justify-center gap-1.5 rounded-md border border-border/60 bg-secondary/40 px-2 py-1.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-secondary/70 disabled:opacity-50"
        >
          <Sparkles className="size-3" />
          {curating ? "Revisando…" : "Revisar memória"}
        </button>
      )}
    </div>
  )
}

function LessonRow({
  lesson: l,
  onRemove,
  onChangeStatus,
}: {
  lesson: LessonRecord
  onRemove: () => void
  onChangeStatus: (status: LessonStatus) => void
}) {
  return (
    <li className="group/lesson flex items-start gap-1.5 rounded-md bg-secondary/40 px-2 py-1.5">
      {l.scope === "global" ? (
        <Globe2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
      ) : (
        <GraduationCap className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
      )}
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground/90">
        {l.rule}
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "rounded px-1 py-px text-[11px] font-medium uppercase tracking-wide",
              l.status === "active"
                ? "bg-st-success/15 text-st-success"
                : l.status === "candidate"
                  ? // Candidata = regra proposta esperando você promover ou
                    // descartar. Isso é decisão pendente, e decisão pendente é
                    // âmbar (§2) — não brass, que é gesto.
                    "bg-st-warning/15 text-st-warning"
                  : "bg-secondary text-muted-foreground/60",
            )}
          >
            {STATUS_LABEL[l.status]}
          </span>
          <span
            className={cn(
              "rounded px-1 py-px text-[11px] font-medium uppercase tracking-wide",
              // Escopo é METADADO puro: a palavra ("global" × "projeto") e a
              // silhueta do ícone já distinguem. Tinta ali era importância
              // genérica, que o §2 proíbe.
              "bg-secondary text-muted-foreground/70",
            )}
          >
            {l.scope === "global" ? "global" : "projeto"}
          </span>
          {l.source && (
            <span className="text-[11px] text-muted-foreground/55">
              {SOURCE_LABEL[l.source] ?? l.source}
            </span>
          )}
          {l.uses > 0 && (
            <span className="text-[11px] tabular-nums text-muted-foreground/55">
              · usada {l.uses}×
            </span>
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/lesson:opacity-100">
        {l.status === "active" ? (
          <button
            onClick={onChangeStatus.bind(null, "candidate")}
            title="Rebaixar (deixa de injetar)"
            aria-label={`Rebaixar lição: ${l.rule}`}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowDown className="size-3" />
          </button>
        ) : (
          <button
            onClick={onChangeStatus.bind(null, "active")}
            title="Promover (volta a injetar)"
            aria-label={`Promover lição: ${l.rule}`}
            className="rounded p-0.5 text-muted-foreground hover:text-st-success"
          >
            <ArrowUp className="size-3" />
          </button>
        )}
        <button
          onClick={onRemove}
          title="Descartar memória"
          aria-label={`Descartar memória: ${l.rule}`}
          className="rounded p-0.5 text-muted-foreground hover:text-st-error"
        >
          <Trash2 className="size-3" />
        </button>
      </span>
    </li>
  )
}
