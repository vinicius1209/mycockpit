// O anexo visível no composer e na fila (ADR-240, mock aprovado em
// docs/mocks/composer-anexos-fila-video.html). Pedido de 23/09/2026: "às vezes
// eu anexo algo, esqueço, e não consigo mais ver o que foi anexado". O chip
// era só o nome.
//
// Miniatura; passar o mouse abre a prévia maior; clicar abre o MESMO
// visualizador em tela cheia do fio, navegando entre as imagens dali.

import { useEffect, useState } from "react"
import { FileText, X } from "lucide-react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { attachmentUrl, type Attachment } from "@/lib/attachments"
import { fmtBytes } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useLightbox, type LightboxImage } from "@/store/lightbox"

/** A galeria do visualizador: só as imagens, na ordem em que estão. Puro. */
export function galeriaDosAnexos(anexos: readonly Attachment[]): LightboxImage[] {
  return anexos
    .filter((a) => a.kind === "image")
    .map((a) => ({ path: a.path, name: a.name, source: "anexo" as const, mime: a.mime }))
}

function useUrlDoAnexo(anexo: Attachment): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (anexo.kind !== "image") return
    let vivo = true
    attachmentUrl(anexo)
      .then((u) => vivo && setUrl(u))
      .catch(() => vivo && setUrl(null))
    return () => {
      vivo = false
    }
  }, [anexo])
  return url
}

export function MiniaturaDeAnexo({
  anexo,
  galeria,
  compacta = false,
  suportado = true,
  motivo,
  onRemover,
}: {
  anexo: Attachment
  /** Todos os anexos do grupo: o visualizador navega entre as imagens. */
  galeria: readonly Attachment[]
  /** Na fila: só a miniatura, sem nome. */
  compacta?: boolean
  suportado?: boolean
  motivo?: string
  onRemover?: () => void
}) {
  const url = useUrlDoAnexo(anexo)
  const [dimensoes, setDimensoes] = useState<string | null>(null)
  const imagem = anexo.kind === "image"
  const abrir = () => {
    const imagens = galeriaDosAnexos(galeria)
    const i = imagens.findIndex((g) => g.path === anexo.path)
    if (i >= 0) useLightbox.getState().open(imagens, i)
  }
  const tamanhoMiniatura = compacta ? "size-8.5" : "size-10"
  const miniatura = (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-md bg-background", tamanhoMiniatura)}>
      {imagem && url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={(e) => setDimensoes(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
          className="size-full object-cover"
        />
      ) : imagem ? (
        <span className="size-full animate-pulse bg-secondary" />
      ) : (
        <FileText className="size-4 text-muted-foreground" />
      )}
    </span>
  )
  const corpo = compacta ? (
    miniatura
  ) : (
    <>
      {miniatura}
      <span className="min-w-0 text-left">
        <span className="block max-w-[140px] truncate text-[12px] text-foreground">{anexo.name}</span>
        <span className="block font-mono text-[11px] text-muted-foreground tabular-nums">{fmtBytes(anexo.bytes)}</span>
      </span>
    </>
  )
  const gatilho = (
    <button
      type="button"
      onClick={imagem ? abrir : undefined}
      aria-label={imagem ? `Ver ${anexo.name}` : anexo.name}
      title={suportado ? undefined : motivo}
      className={cn(
        "flex items-center rounded-lg text-left transition-colors",
        compacta ? "p-0" : "gap-2 py-1 pr-2 pl-1",
        compacta ? "" : suportado ? "bg-secondary/60 hover:bg-secondary" : "bg-st-error/10 text-st-error",
        !imagem && "cursor-default",
      )}
    >
      {corpo}
    </button>
  )
  return (
    <span className="group/anexo relative inline-flex">
      {imagem && url ? (
        <HoverCard>
          <HoverCardTrigger asChild>{gatilho}</HoverCardTrigger>
          <HoverCardContent side="top" className="w-[300px] p-1.5">
            <img src={url} alt={anexo.name} className="max-h-[260px] w-full rounded-md object-contain" />
            <span className="flex justify-between gap-2 px-1 pt-1.5 text-[11px] text-muted-foreground">
              <span className="truncate">{anexo.name}</span>
              <span className="shrink-0 font-mono tabular-nums">
                {[dimensoes, fmtBytes(anexo.bytes)].filter(Boolean).join(" · ")}
              </span>
            </span>
          </HoverCardContent>
        </HoverCard>
      ) : (
        gatilho
      )}
      {onRemover && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemover()
          }}
          aria-label={`Remover ${anexo.name}`}
          title="Remover"
          className="absolute -top-1.5 -right-1.5 grid size-4.5 place-items-center rounded-full border bg-popover text-muted-foreground opacity-0 shadow-[var(--shadow-pop)] transition-opacity group-hover/anexo:opacity-100 hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}
