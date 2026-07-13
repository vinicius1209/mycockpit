// UI de AUDITORIA do auto-aprendizado (docs/autonomy.md, princípio nº3: "nunca
// promover memória sem revisão — aprendizado que você não audita degrada em
// silêncio"). Mostra, por projeto: nº de entregas no recall (M1) e a lista de
// lições destiladas (M2), cada uma removível. Mínimo viável = listar + podar.
import { useEffect, useState } from "react"
import { GraduationCap, Trash2 } from "lucide-react"
import {
  deleteLesson,
  isTauri,
  listDeliveries,
  listLessons,
  type LessonRecord,
} from "@/lib/db"

export function LearningSection({ projectId }: { projectId: string }) {
  const [lessons, setLessons] = useState<LessonRecord[]>([])
  const [deliveries, setDeliveries] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!isTauri()) {
      setLoaded(true)
      return
    }
    void Promise.all([listLessons(projectId), listDeliveries(projectId)]).then(
      ([ls, ds]) => {
        if (cancelled) return
        setLessons(ls)
        setDeliveries(ds.length)
        setLoaded(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [projectId])

  async function remove(id: string) {
    // otimista: some da UI já; se o delete falhar, o próximo load reexibe.
    setLessons((cur) => cur.filter((l) => l.id !== id))
    await deleteLesson(id)
  }

  if (!loaded) return null
  if (deliveries === 0 && lessons.length === 0) {
    return (
      <p className="text-[11.5px] leading-snug text-muted-foreground/70">
        Nada aprendido ainda. Quando uma missão termina com sucesso, a entrega
        entra no recall; correções do reviewer viram lições reusáveis.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-muted-foreground">Entregas no recall</span>
        <span className="font-mono tabular-nums text-foreground/80">
          {deliveries}
        </span>
      </div>

      {lessons.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10.5px] text-muted-foreground/55">
            Lições ({lessons.length})
          </div>
          <ul className="flex flex-col gap-1">
            {lessons.map((l) => (
              <li
                key={l.id}
                className="group/lesson flex items-start gap-1.5 rounded-md bg-secondary/40 px-2 py-1.5"
              >
                <GraduationCap className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
                <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-foreground/90">
                  {l.rule}
                  {l.uses > 0 && (
                    <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground/55">
                      · usada {l.uses}×
                    </span>
                  )}
                </span>
                <button
                  onClick={() => void remove(l.id)}
                  title="Remover lição"
                  aria-label={`Remover lição: ${l.rule}`}
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/lesson:opacity-100 hover:text-st-error"
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
