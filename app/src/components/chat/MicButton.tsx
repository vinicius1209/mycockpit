import { useEffect, useState } from "react"
import { Loader2, Mic } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { sttStart, sttStop, sttCancel } from "@/lib/stt"
import { useChat } from "@/store/chat"
import { useActiveProject } from "@/store/app"
import { DESTINATIONS } from "@/lib/agents"
import { isTauri } from "@/lib/db"
import { fmtDuration } from "@/lib/format"

/** Termos que ditado genérico erra: os nomes da casa + do projeto vão como
 *  contextualStrings pro reconhecedor (a vantagem sobre o Wispr). */
function buildVocab(projectName?: string): string[] {
  const base = [
    "MyCockpit",
    "Fusion",
    "SDD",
    "PRD",
    "worktree",
    "commit",
    "branch",
    "merge",
    "rebase",
    "deploy",
    "refactor",
    "backend",
    "frontend",
    "endpoint",
    "migration",
    ...DESTINATIONS.filter((d) => d.available).map((d) => d.label),
  ]
  if (projectName) base.push(projectName)
  return base
}

type MicState = "idle" | "starting" | "rec" | "busy"

/** Ditado pt-BR 100% local: clica-fala-clica, o texto cai no rascunho da
 *  conversa pra você revisar antes do Enter. Esc cancela. */
export function MicButton() {
  const project = useActiveProject()
  const [state, setState] = useState<MicState>("idle")
  const [since, setSince] = useState(0)
  const [now, setNow] = useState(0)

  // cronômetro da gravação
  useEffect(() => {
    if (state !== "rec") return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [state])

  // Esc descarta a gravação
  useEffect(() => {
    if (state !== "rec") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void sttCancel()
        setState("idle")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [state])

  async function toggle() {
    if (state === "starting" || state === "busy") return
    if (state === "idle") {
      if (!isTauri()) {
        toast("Ditado disponível no app (tauri dev)")
        return
      }
      setState("starting")
      try {
        await sttStart(buildVocab(project?.name))
        setSince(Date.now())
        setNow(Date.now())
        setState("rec")
      } catch (e) {
        toast.error(typeof e === "string" ? e : "Falha ao iniciar o ditado")
        setState("idle")
      }
      return
    }
    // gravando → para e transcreve
    setState("busy")
    try {
      const text = await sttStop()
      if (text) {
        const convId = useChat.getState().activeId
        if (convId) {
          const cur = useChat.getState().drafts[convId] ?? ""
          useChat
            .getState()
            .setDraft(convId, cur ? `${cur.replace(/\s+$/, "")} ${text}` : text)
        }
      }
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha na transcrição")
    } finally {
      setState("idle")
    }
  }

  if (state === "rec") {
    return (
      <button
        onClick={() => void toggle()}
        title="Parar e transcrever (Esc cancela)"
        className="flex h-7 items-center gap-1.5 rounded-full border border-st-error/50 bg-st-error/10 px-2.5 text-[11.5px] text-st-error transition-colors hover:bg-st-error/20"
      >
        <span className="size-2 animate-pulse rounded-full bg-st-error" />
        <span className="font-mono tabular-nums">{fmtDuration(now - since)}</span>
      </button>
    )
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => void toggle()}
      className="rounded-full text-muted-foreground hover:text-foreground"
      title="Ditar em pt-BR (100% local, on-device)"
      aria-label="Ditar"
    >
      {state === "idle" ? (
        <Mic className="size-4" />
      ) : (
        <Loader2 className="size-4 animate-spin" />
      )}
    </Button>
  )
}
