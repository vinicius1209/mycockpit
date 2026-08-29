import { useEffect, useRef, useState } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { Loader2, Mic, Square } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DictationOverlay,
  dictationPillView,
  type DictationPhase,
} from "@/components/chat/DictationOverlay"
import { formatHotkey, registerDictationTarget } from "@/lib/dictationHotkey"
import { sttStart, sttStop, sttCancel } from "@/lib/stt"
import { useChat } from "@/store/chat"
import { useApp, useActiveProject } from "@/store/app"
import { DESTINATIONS } from "@/lib/agents"
import { isTauri } from "@/lib/db"
import { useComposerDrafts } from "@/store/composerDrafts"

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

/** As fases do botão SÃO as fases que o pill entende (DictationPhase): um tipo
 *  só, pra estado e aparência nunca saírem de sincronia. */
type MicState = DictationPhase

/** Ditado pt-BR 100% local: clica-fala-clica (ou o atalho de ditado), o texto cai no
 *  rascunho da conversa pra você revisar antes do Enter. Esc cancela.
 *  Durante a gravação a fileira de controles fica IDÊNTICA — só este botão
 *  muda pro estado "parar" (mesmo tamanho); o feedback (timer + parcial ao
 *  vivo) vive no DictationOverlay, um pill que PAIRA sobre a UI sem reflow.
 *  `onText` (opcional) redireciona a transcrição p/ outro destino — ex.: o
 *  textarea da tarefa no MissionLauncher — em vez do draft da conversa.
 *  `overlay` ancora o pill: "composer" = acima do console (o ancestral
 *  posicionado é a raiz do CommandConsole); "self" = acima do próprio botão
 *  (gates/launchers, via wrapper relative local). */
export function MicButton({
  onText,
  overlay = "self",
}: {
  onText?: (text: string) => void
  overlay?: "composer" | "self"
} = {}) {
  const project = useActiveProject()
  const enabled = useApp((s) => s.settings.dictationEnabled)
  const hotkey = useApp((s) => s.settings.dictationHotkey)
  const vocab = useApp((s) => s.settings.dictationVocab)
  const device = useApp((s) => s.settings.dictationDevice)
  const [state, setState] = useState<MicState>("idle")
  const [since, setSince] = useState(0)
  const [partial, setPartial] = useState("")
  // Espelho SÍNCRONO do estado: o atalho de ditado decide (isRecording) e age
  // (start→stop encadeado no hold) em microtasks, antes do re-render — closures
  // presas no state do último render errariam a decisão.
  const stateRef = useRef<MicState>("idle")
  function go(next: MicState) {
    stateRef.current = next
    setState(next)
  }

  // entrega a transcrição no destino (callback ou draft da conversa)
  function deliver(text: string) {
    if (onText) {
      onText(text)
      return
    }
    const convId = useChat.getState().activeId
    if (!convId) return
    const cur = useComposerDrafts.getState().byConv[convId]?.text ?? ""
    useComposerDrafts
      .getState()
      .setText(convId, cur ? `${cur.replace(/\s+$/, "")} ${text}` : text)
  }

  async function start() {
    if (stateRef.current !== "idle") return
    if (!isTauri()) {
      toast("Ditado disponível no app (tauri dev)")
      return
    }
    go("starting")
    try {
      await sttStart(buildVocab(project?.name, vocab), device)
      setSince(Date.now())
      go("rec")
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao iniciar o ditado")
      go("idle")
    }
  }

  // gravando → para e transcreve. "busy" NÃO é cosmético: o sidecar ainda drena
  // o mic e relê o áudio da sessão (D1/D2), então a UI fica em "finalizando" até
  // o texto chegar. `warn` avisa quando o texto veio degradado (streaming em vez
  // da releitura do arquivo) — o texto vem do mesmo jeito, nunca se perde fala.
  async function stop() {
    if (stateRef.current !== "rec") return
    go("busy")
    try {
      const { text, warn } = await sttStop()
      if (text) deliver(text)
      if (warn) toast.warning(warn)
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha na transcrição")
    } finally {
      go("idle")
    }
  }

  function cancel() {
    if (stateRef.current !== "rec") return
    void sttCancel()
    go("idle")
  }

  // Esc descarta a gravação
  useEffect(() => {
    if (state !== "rec") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // Alvo do atalho de ditado (lib/dictationHotkey): registra ao montar; o último
  // registrado E VISÍVEL vence — o ChatPanel fica montado `hidden` fora do
  // modo linear, então a disponibilidade é o offsetParent do próprio botão.
  const apiRef = useRef({ start, stop, cancel })
  apiRef.current = { start, stop, cancel }
  const btnRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!enabled) return
    return registerDictationTarget({
      start: () => apiRef.current.start(),
      stop: () => apiRef.current.stop(),
      cancel: () => apiRef.current.cancel(),
      isRecording: () => stateRef.current === "rec",
      isAvailable: () => btnRef.current?.offsetParent != null,
    })
  }, [enabled])

  // Durante a gravação: parcial ao vivo (feedback de que o mic CAPTOU — perda
  // de palavras fica visível na hora) + morte inesperada do sidecar (sem isso
  // a UI ficava em "rec" com o mic morto). No stop normal o estado já é "busy"
  // e estes listeners nem existem.
  useEffect(() => {
    if (state !== "rec") {
      // o parcial SOBREVIVE ao "busy": é o que o pill de "finalizando" mostra
      // enquanto o texto não chega. Só some quando a gravação sai de cena.
      if (state !== "busy") setPartial("")
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
        else toast("O ditado encerrou sozinho, texto aproveitado no rascunho")
        go("idle")
      }),
    )
    return () => {
      disposed = true
      uns.forEach((u) => u())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // ditado desligado nas configurações → sem botão de mic.
  if (!enabled) return null

  // Pill flutuante (timer + parcial): overlay absoluto, fora do fluxo — a
  // fileira de controles não mexe um pixel. Fica de pé de "rec" até o texto
  // chegar ("busy" ⇒ finalizando), pela regra pura dictationPillView.
  const view = dictationPillView(state)
  const pill = (
    <DictationOverlay
      active={view.visible}
      finalizing={view.finalizing}
      placeholder={view.placeholder}
      hint={view.hint}
      partial={partial}
      since={since}
      className={
        overlay === "composer"
          ? "absolute inset-x-0 bottom-full mb-2"
          : "absolute right-0 bottom-full mb-2 w-[300px] max-w-[75vw] justify-end"
      }
    />
  )

  const button =
    state === "rec" ? (
      // estado "parar": MESMO tamanho do botão idle (icon-sm = size-8) —
      // vermelho pulsando no lugar, zero deslocamento dos vizinhos.
      <button
        ref={btnRef}
        onClick={() => void stop()}
        title="Parar e transcrever (Esc cancela)"
        aria-label="Parar e transcrever"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-st-error/15 text-st-error transition-colors hover:bg-st-error/25 motion-safe:animate-pulse"
      >
        <Square className="size-3 fill-current" />
      </button>
    ) : (
      <Button
        ref={btnRef}
        variant="ghost"
        size="icone-padrao"
        onClick={() => void (state === "idle" ? start() : null)}
        className="rounded-full text-muted-foreground hover:text-foreground"
        title={
          hotkey
            ? `Ditar (${formatHotkey(hotkey)} · pt-BR, 100% local)`
            : "Ditar (pt-BR, 100% local)"
        }
        aria-label="Ditar"
      >
        {state === "idle" ? (
          <Mic className="size-4" />
        ) : (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        )}
      </Button>
    )

  if (overlay === "composer") {
    // sem wrapper posicionado: o pill ancora no ancestral relative mais
    // próximo — a raiz do CommandConsole — e paira ACIMA do composer inteiro.
    return (
      <>
        {pill}
        {button}
      </>
    )
  }
  return (
    <span className="relative inline-flex shrink-0">
      {pill}
      {button}
    </span>
  )
}
