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
import {
  sttStart,
  sttStop,
  sttCancel,
  sttEventBelongsTo,
  type SttCaptureLostEvent,
  type SttEndedEvent,
  type SttLevelEvent,
  type SttPartialEvent,
} from "@/lib/stt"
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
  const [level, setLevel] = useState(0)
  const [activeDeviceName, setActiveDeviceName] = useState<string | null>(null)
  const startAttemptRef = useRef(0)
  const activeAttemptIdRef = useRef<string | null>(null)
  const targetConvIdRef = useRef<string | null>(null)
  const captureLostRef = useRef<string | null>(null)
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
    const convId = targetConvIdRef.current
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
    const attempt = ++startAttemptRef.current
    const attemptId = crypto.randomUUID()
    const wasCancelled = () =>
      stateRef.current !== "starting" || attempt !== startAttemptRef.current
    activeAttemptIdRef.current = attemptId
    targetConvIdRef.current = onText ? null : useChat.getState().activeId
    captureLostRef.current = null
    setLevel(0)
    setActiveDeviceName(null)
    go("starting")
    try {
      const opened = await sttStart(
        buildVocab(project?.name, vocab),
        device,
        attemptId,
      )
      // O usuário pode cancelar enquanto o comando ainda espera permissão ou o
      // primeiro buffer. Uma resposta atrasada não ressuscita a gravação.
      if (wasCancelled()) {
        await sttCancel().catch(() => {})
        return
      }
      if (opened.attemptId !== attemptId) {
        await sttCancel().catch(() => {})
        throw new Error("o microfone respondeu para outra tentativa")
      }
      setActiveDeviceName(opened.deviceName)
      if (opened.warn) toast.warning(opened.warn)
      setSince(Date.now())
      go("rec")
    } catch (e) {
      if (wasCancelled()) {
        return
      }
      toast.error(typeof e === "string" ? e : "Falha ao iniciar o ditado")
      activeAttemptIdRef.current = null
      targetConvIdRef.current = null
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
      activeAttemptIdRef.current = null
      targetConvIdRef.current = null
      setLevel(0)
      setActiveDeviceName(null)
      captureLostRef.current = null
      go("idle")
    }
  }

  function cancel() {
    if (stateRef.current !== "starting" && stateRef.current !== "rec") return
    startAttemptRef.current += 1
    activeAttemptIdRef.current = null
    targetConvIdRef.current = null
    go("idle")
    setLevel(0)
    setActiveDeviceName(null)
    captureLostRef.current = null
    void sttCancel().catch((e) => {
      toast.error(typeof e === "string" ? e : "Falha ao cancelar o ditado")
    })
  }

  // Esc descarta tanto a gravação quanto a abertura ainda em andamento.
  useEffect(() => {
    if (state !== "starting" && state !== "rec") return
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

  // Durante abertura/gravação: nível e parcial vêm do áudio REAL. Desconexão
  // fecha pelo sidecar e preserva o texto capturado; a UI não fica num falso
  // "ouvindo". No stop normal o estado já é "busy" e os listeners saem.
  useEffect(() => {
    if (state !== "starting" && state !== "rec") {
      // o parcial SOBREVIVE ao "busy": é o que o pill de "finalizando" mostra
      // enquanto o texto não chega. Só some quando a gravação sai de cena.
      if (state !== "busy") setPartial("")
      return
    }
    let disposed = false
    let listenerFailureShown = false
    const uns: UnlistenFn[] = []
    const track = (p: Promise<UnlistenFn>) =>
      void p
        .then((u) => {
          if (disposed) u()
          else uns.push(u)
        })
        .catch(() => {
          if (disposed || listenerFailureShown) return
          listenerFailureShown = true
          toast.error("Não consegui acompanhar o microfone. O ditado foi cancelado.")
          cancel()
        })
    track(
      listen<SttPartialEvent>("stt://partial", (e) => {
        if (sttEventBelongsTo(activeAttemptIdRef.current, e.payload)) {
          setPartial(e.payload.text)
        }
      }),
    )
    track(
      listen<SttLevelEvent>("stt://level", (e) => {
        if (sttEventBelongsTo(activeAttemptIdRef.current, e.payload)) {
          setLevel(e.payload.level)
        }
      }),
    )
    track(
      listen<SttCaptureLostEvent>("stt://capture-lost", (e) => {
        if (!sttEventBelongsTo(activeAttemptIdRef.current, e.payload)) return
        captureLostRef.current = e.payload.message
        toast.warning(e.payload.message)
      }),
    )
    track(
      listen<SttEndedEvent>("stt://ended", (e) => {
        if (!sttEventBelongsTo(activeAttemptIdRef.current, e.payload)) return
        // O stop normal entrega o mesmo texto pelo retorno do comando. O
        // evento é apenas a linha de vida para encerramento inesperado.
        if (stateRef.current === "busy") return
        void sttCancel().catch(() => {}) // limpa a sessão do sidecar morto
        const captureLost = captureLostRef.current
        const warning = e.payload?.warn
        const t = e.payload?.text?.trim()
        if (t) deliver(t)
        if (warning && warning !== captureLost) toast.warning(warning)
        if (e.payload?.error) toast.error(e.payload.error)
        else if (!captureLost)
          toast("O ditado encerrou sozinho, texto aproveitado no rascunho")
        setLevel(0)
        setActiveDeviceName(null)
        captureLostRef.current = null
        activeAttemptIdRef.current = null
        targetConvIdRef.current = null
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
      deviceName={activeDeviceName}
      level={level}
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
        onClick={() =>
          void (state === "idle"
            ? start()
            : state === "starting"
              ? cancel()
              : null)
        }
        className="rounded-full text-muted-foreground hover:text-foreground"
        title={
          state === "starting"
            ? "Cancelar abertura do microfone"
            : state === "busy"
              ? "Finalizando o ditado"
              : hotkey
                ? `Ditar (${formatHotkey(hotkey)} · pt-BR, 100% local)`
                : "Ditar (pt-BR, 100% local)"
        }
        aria-label={
          state === "starting" ? "Cancelar abertura do microfone" : "Ditar"
        }
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
