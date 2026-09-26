// Overlay ÚNICO de imagem do fio (evidência de tool B1, anexo do usuário e
// imagem citada por link):
// thumbnail clicado → imagem em tamanho real. Fecha por Esc/clique fora,
// navega por ←/→ quando a galeria tem várias, e "Abrir no app padrão" delega
// pro SO (comando Rust com contenção de path). Monta UMA vez no App; fechado
// renderiza null. Arquivo sumido do disco → placeholder honesto, nunca <img>
// quebrada.

import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react"
import { avisar } from "@/lib/avisos"
import { cn } from "@/lib/utils"
import { ALTURA_DA_FAIXA, RECUO_DOS_BOTOES } from "@/components/layout/faixaDaJanela"
import { attachmentUrl, type Attachment } from "@/lib/attachments"
import { evidenceUrl, openConvImage } from "@/lib/evidence"
import { imagemCitadaUrl } from "@/lib/imagemCitada"
import { missingLabel, useLightbox, type LightboxImage } from "@/store/lightbox"

/** Bytes → object URL pela origem (os DOIS caches por path já existem). */
async function imageUrl(img: LightboxImage): Promise<string> {
  if (img.source === "evidencia") return evidenceUrl(img.path)
  if (img.source === "arquivo") return imagemCitadaUrl(img.root ?? "", img.path)
  return attachmentUrl({
    path: img.path,
    name: img.name,
    kind: "image",
    mime: img.mime ?? "image/png",
    bytes: 0,
  } satisfies Attachment)
}

export function LightboxOverlay() {
  const current = useLightbox((s) => s.current)
  const step = useLightbox((s) => s.step)
  const close = useLightbox((s) => s.close)
  const img = current ? current.images[current.index] : null
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!img) return
    let alive = true
    setUrl(null)
    setMissing(false)
    imageUrl(img)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setMissing(true))
    return () => {
      alive = false
    }
  }, [img])

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        close()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        step(-1)
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        step(1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [current, close, step])

  if (!current || !img) return null
  const many = current.images.length > 1
  // "Abrir no app padrão" e "Mostrar na pasta" resolvem path RELATIVO ao
  // app_data_dir. O arquivo citado mora fora dele: sem o gesto, em vez de um
  // botão que falha (a pasta segue no clique direito do próprio link).
  const doFio = img.source !== "arquivo"

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={img.name}
      // Camada modal imersiva: precisa ficar acima de painéis ancorados
      // (z-120) e dos menus que vivem dentro deles (z-130). O z-50 anterior
      // fazia a imagem abrir literalmente atrás da gaveta de Notas.
      className="fixed inset-0 z-[140] flex flex-col bg-black/85 backdrop-blur-sm"
      onClick={close}
    >
      {/* barra superior: nome + contador + ações (clique aqui não fecha).
          Ocupa a faixa da janela, com o mesmo recuo da barra do app: a camada
          cobre a tela inteira, e sem o recuo o nome ficava embaixo dos botões
          de fechar/minimizar/expandir. Arrastável, como a barra do app. */}
      <div
        data-tauri-drag-region
        className={cn("flex shrink-0 items-center gap-2 pr-4", ALTURA_DA_FAIXA, RECUO_DOS_BOTOES)}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate font-mono text-[12px] text-white/75">
          {img.name}
        </span>
        {many && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-white/50">
            {current.index + 1} / {current.images.length}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {!missing && doFio && (
            <button
              type="button"
              onClick={() => {
                openConvImage(img.path).catch(() =>
                  avisar.erro(
                    "Não consegui abrir no app padrão (o arquivo ainda existe?)",
                  ),
                )
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-1.5 text-[12px] text-white/85 transition-colors hover:bg-white/10"
            >
              <ExternalLink className="size-3.5" />
              Abrir no app padrão
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Fechar"
            className="rounded-md border border-white/20 p-1.5 text-white/85 transition-colors hover:bg-white/10"
          >
            <X className="size-4" />
          </button>
        </span>
      </div>
      {/* palco: clique no fundo fecha; na imagem/setas, não */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-6">
        {many && (
          <button
            type="button"
            aria-label="Imagem anterior"
            disabled={current.index === 0}
            onClick={(e) => {
              e.stopPropagation()
              step(-1)
            }}
            className={cn(
              "absolute left-3 rounded-full border border-white/20 p-2 text-white/85 transition-colors hover:bg-white/10",
              current.index === 0 && "opacity-30 hover:bg-transparent",
            )}
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
        {missing ? (
          <span
            onClick={(e) => e.stopPropagation()}
            className="rounded-md border border-white/20 px-4 py-3 text-[13px] text-white/70"
          >
            {missingLabel(img.source)}
          </span>
        ) : url ? (
          <img
            src={url}
            alt={img.name}
            // Path RELATIVO contido (o mesmo que o Rust resolve): é ele que
            // habilita "Abrir no app padrão" e "Mostrar na pasta" no menu de
            // contexto (ADR-042). Sem o marcador, o menu só copia os pixels.
            data-ctx-imagem={doFio ? img.path : ""}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-md object-contain shadow-[var(--shadow-pop)]"
          />
        ) : (
          <span className="size-40 animate-pulse rounded-lg bg-white/10" />
        )}
        {many && (
          <button
            type="button"
            aria-label="Próxima imagem"
            disabled={current.index === current.images.length - 1}
            onClick={(e) => {
              e.stopPropagation()
              step(1)
            }}
            className={cn(
              "absolute right-3 rounded-full border border-white/20 p-2 text-white/85 transition-colors hover:bg-white/10",
              current.index === current.images.length - 1 &&
                "opacity-30 hover:bg-transparent",
            )}
          >
            <ChevronRight className="size-5" />
          </button>
        )}
      </div>
    </div>
  )
}
