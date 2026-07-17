import { useEffect, useState } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
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
    "Frota",
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
  const [partial, setPartial] = useState("")

  // entrega a transcrição no destino (callback ou draft da conversa)
  function deliver(text: string) {
    if (onText) {
      onText(text)
      return
    }
    const convId = useChat.getState().activeId
    if (!convId) return
    const cur = useChat.getState().drafts[convId] ?? ""
    useChat
      .getState()
      .setDraft(convId, cur ? `${cur.replace(/\s+$/, "")} ${text}` : text)
  }

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

  // Durante a gravação: parcial ao vivo (feedback de que o mic CAPTOU — perda
  // de palavras fica visível na hora) + morte inesperada do sidecar (sem isso
  // a UI ficava em "rec" com o mic morto). No stop normal o estado já é "busy"
  // e estes listeners nem existem.
  useEffect(() => {
    if (state !== "rec") {
      setPartial("")
      return
    }
    let disposed = false
    const uns: UnlistenFn[] = []
    const track = (p: Promise<UnlistenFn>) =>
      void p
        .then((u) => {
          if (disposed) u()
          else uns.push(u)
        })
        .catch(() => {})
    track(listen<string>("stt://partial", (e) => setPartial(e.payload)))
    track(
      listen<{ text?: string; error?: string }>("stt://ended", (e) => {
        void sttCancel() // limpa a sessão do sidecar morto
        const t = e.payload?.text?.trim()
        if (t) deliver(t)
        if (e.payload?.error) toast.error(e.payload.error)
        else toast("O ditado encerrou sozinho — texto aproveitado no rascunho")
        setState("idle")
      }),
    )
    return () => {
      disposed = true
      uns.forEach((u) => u())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (text) deliver(text)
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
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-st-error/50 bg-st-error/10 px-2.5 text-[11.5px] text-st-error transition-colors hover:bg-st-error/20"
      >
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-st-error" />
        <span className="shrink-0 font-mono tabular-nums">
          {fmtDuration(now - since)}
        </span>
        {/* cauda do parcial ao vivo: prova visual de que o mic está captando */}
        {partial && (
          <span className="max-w-[180px] truncate text-[11px] text-foreground/60">
            {partial.length > 42 ? `…${partial.slice(-40)}` : partial}
          </span>
        )}
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
