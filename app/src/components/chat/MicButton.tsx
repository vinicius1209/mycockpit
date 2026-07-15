import { useEffect, useState } from "react"
import { Loader2, Mic } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { sttStart, sttStop, sttCancel } from "@/lib/stt"
import { useChat } from "@/store/chat"
import { useApp, useActiveProject } from "@/store/app"
import { DESTINATIONS } from "@/lib/agents"
import { isTauri } from "@/lib/db"
import { fmtDuration } from "@/lib/format"

/** Termos que ditado genérico erra: os nomes da casa + do projeto vão como
 *  contextualStrings pro reconhecedor (a vantagem sobre o Wispr). */
function buildVocab(projectName?: string, extra: string[] = []): string[] {
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
  return [...base, ...extra]
}

type MicState = "idle" | "starting" | "rec" | "busy"

/** Ditado pt-BR 100% local: clica-fala-clica, o texto cai no rascunho da
 *  conversa pra você revisar antes do Enter. Esc cancela.
 *  `onText` (opcional) redireciona a transcrição p/ outro destino — ex.: o
 *  textarea da tarefa no MissionLauncher — em vez do draft da conversa. */
export function MicButton({
  onText,
}: {
  onText?: (text: string) => void
} = {}) {
  const project = useActiveProject()
  const enabled = useApp((s) => s.settings.dictationEnabled)
  const vocab = useApp((s) => s.settings.dictationVocab)
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
        await sttStart(buildVocab(project?.name, vocab))
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
        if (onText) {
          onText(text)
        } else {
          const convId = useChat.getState().activeId
          if (convId) {
            const cur = useChat.getState().drafts[convId] ?? ""
            useChat
              .getState()
              .setDraft(convId, cur ? `${cur.replace(/\s+$/, "")} ${text}` : text)
          }
        }
      }
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha na transcrição")
    } finally {
      setState("idle")
    }
  }

  // ditado desligado nas configurações → sem botão de mic.
  if (!enabled) return null

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
