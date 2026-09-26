// O player da aba do arquivo (ADR-240, mock aprovado em
// docs/mocks/composer-anexos-fila-video.html). O vídeo vem do protocolo
// `frota-arquivo`, que serve em partes: tocar e avançar não carregam o
// arquivo inteiro.
//
// Controles próprios em vez dos nativos, pelo gesto que só a Frota tem:
// "Copiar este quadro" leva o frame para o rascunho da conversa, que é o que
// quem abre um vídeo aqui costuma querer (mostrar ao agente o que viu).

import { useEffect, useRef, useState } from "react"
import { Camera, Maximize2, Pause, Play, Repeat, Volume2, VolumeX } from "lucide-react"
import { avisar, mensagemDe } from "@/lib/avisos"
import { Button } from "@/components/ui/button"
import { anexosComCaptura } from "@/components/browser/capturaDaPagina"
import { MAX_ATTACH_COUNT, saveAttachment } from "@/lib/attachments"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"
import { cn } from "@/lib/utils"

const VELOCIDADES = [0.5, 1, 1.5, 2]
/** Largura máxima do quadro copiado: 3008 px de origem viravam um PNG de
 *  vários MB para o limite de 10 MB por anexo. */
const LARGURA_DO_QUADRO = 1920

/** "0:37", "12:05", "1:02:03". Puro. */
export function fmtTempo(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return "0:00"
  const s = Math.floor(segundos % 60)
  const m = Math.floor(segundos / 60) % 60
  const h = Math.floor(segundos / 3600)
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

export interface InfoDoVideo {
  largura: number
  altura: number
  duracao: number
}

async function copiarQuadro(video: HTMLVideoElement, caminho: string): Promise<void> {
  const convId = useChat.getState().activeId
  if (!convId) {
    avisar.erro("Abra uma conversa para levar o quadro ao rascunho.")
    return
  }
  const escala = Math.min(1, LARGURA_DO_QUADRO / video.videoWidth)
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(video.videoWidth * escala)
  canvas.height = Math.round(video.videoHeight * escala)
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"))
  if (!blob) throw new Error("Não consegui copiar o quadro.")
  const tempo = fmtTempo(video.currentTime)
  const nome = `quadro-${(caminho.split("/").pop() ?? "video").replace(/\.[^.]+$/, "")}-${tempo.replace(/:/g, "m")}s.png`
  const anexo = await saveAttachment(convId, nome, "image/png", new Uint8Array(await blob.arrayBuffer()))
  const drafts = useComposerDrafts.getState()
  const { anexos, coube } = anexosComCaptura(drafts.byConv[convId]?.attachments ?? [], anexo)
  if (!coube) {
    avisar.erro(`O rascunho já tem ${MAX_ATTACH_COUNT} anexos. Remova um para levar o quadro.`)
    return
  }
  drafts.setAttachments(convId, anexos)
  drafts.appendText(convId, `Quadro de ${caminho} em ${tempo}:`)
  avisar.feito("Quadro levado ao rascunho da conversa.")
}

export function PlayerDeVideo({
  url,
  caminho,
  onInfo,
}: {
  url: string
  caminho: string
  onInfo?: (info: InfoDoVideo) => void
}) {
  const video = useRef<HTMLVideoElement | null>(null)
  const palco = useRef<HTMLDivElement | null>(null)
  const [tocando, setTocando] = useState(false)
  const [tempo, setTempo] = useState(0)
  const [duracao, setDuracao] = useState(0)
  const [velocidade, setVelocidade] = useState(1)
  const [repetir, setRepetir] = useState(false)
  const [mudo, setMudo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const alternar = () => {
    const v = video.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }
  const pular = (s: number) => {
    const v = video.current
    if (v) v.currentTime = Math.min(Math.max(0, v.currentTime + s), v.duration || 0)
  }

  useEffect(() => {
    if (video.current) video.current.playbackRate = velocidade
  }, [velocidade])

  function teclas(e: React.KeyboardEvent) {
    const acoes: Record<string, () => void> = {
      " ": alternar,
      ArrowLeft: () => pular(-5),
      ArrowRight: () => pular(5),
      ",": () => { video.current?.pause(); pular(-1 / 30) },
      ".": () => { video.current?.pause(); pular(1 / 30) },
      f: () => void palco.current?.requestFullscreen?.(),
      m: () => setMudo((m) => !m),
    }
    const acao = acoes[e.key]
    if (!acao) return
    e.preventDefault()
    acao()
  }

  if (erro) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
        <div className="max-w-md">
          <p className="text-[13px] text-foreground">Não consegui tocar este vídeo</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{erro}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={palco}
      tabIndex={0}
      onKeyDown={teclas}
      aria-label="Player de vídeo"
      className="flex min-h-0 flex-1 flex-col bg-background outline-none"
    >
      <div className="grid min-h-0 flex-1 place-items-center bg-black/60 p-4">
        <video
          ref={video}
          src={url}
          crossOrigin="anonymous"
          preload="metadata"
          playsInline
          muted={mudo}
          loop={repetir}
          onClick={alternar}
          onPlay={() => setTocando(true)}
          onPause={() => setTocando(false)}
          onTimeUpdate={(e) => setTempo(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            setDuracao(v.duration)
            onInfo?.({ largura: v.videoWidth, altura: v.videoHeight, duracao: v.duration })
            // Com `preload="metadata"` o WebKit sabe o tamanho mas não pinta
            // quadro nenhum: o vídeo ficava preto até o play (24/09/2026). Um
            // passo mínimo obriga a decodificar o primeiro quadro.
            if (v.currentTime === 0) v.currentTime = 0.001
          }}
          onError={() => setErro("O formato ou o codec não é compatível com o player do sistema.")}
          className="max-h-full max-w-full rounded-sm"
        />
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border/40 px-3 py-2">
        <Button size="icone-compacto" variant="ghost" onClick={alternar} aria-label={tocando ? "Pausar" : "Tocar"} title={tocando ? "Pausar (espaço)" : "Tocar (espaço)"}>
          {tocando ? <Pause /> : <Play />}
        </Button>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{fmtTempo(tempo)}</span>
        <input
          type="range"
          min={0}
          max={duracao || 0}
          step={0.01}
          value={tempo}
          onChange={(e) => {
            if (video.current) video.current.currentTime = Number(e.target.value)
          }}
          aria-label="Posição do vídeo"
          className="h-1 min-w-0 flex-1 cursor-pointer accent-foreground"
        />
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{fmtTempo(duracao)}</span>
        <Button
          size="chip"
          variant="ghost"
          onClick={() => setVelocidade((v) => VELOCIDADES[(VELOCIDADES.indexOf(v) + 1) % VELOCIDADES.length])}
          title="Velocidade"
          className="font-mono tabular-nums"
        >
          {velocidade}×
        </Button>
        <Button size="icone-compacto" variant="ghost" onClick={() => setRepetir((r) => !r)} aria-pressed={repetir} title="Repetir" className={cn(repetir && "text-foreground")}>
          <Repeat />
        </Button>
        <Button size="icone-compacto" variant="ghost" onClick={() => setMudo((m) => !m)} title={mudo ? "Ligar o som (M)" : "Sem som (M)"}>
          {mudo ? <VolumeX /> : <Volume2 />}
        </Button>
        <Button
          size="icone-compacto"
          variant="ghost"
          title="Copiar este quadro para o rascunho"
          aria-label="Copiar este quadro para o rascunho"
          onClick={() => {
            const v = video.current
            if (v) void copiarQuadro(v, caminho).catch((err) => avisar.erro("Não consegui copiar o quadro.", { detalhe: mensagemDe(err) }))
          }}
        >
          <Camera />
        </Button>
        <Button size="icone-compacto" variant="ghost" title="Tela cheia (F)" aria-label="Tela cheia" onClick={() => void palco.current?.requestFullscreen?.()}>
          <Maximize2 />
        </Button>
      </div>
      <p className="shrink-0 px-3 pb-2 text-[11px] text-muted-foreground/60">
        espaço tocar e pausar · ← → 5 s · , . quadro a quadro · F tela cheia · M som
      </p>
    </div>
  )
}
