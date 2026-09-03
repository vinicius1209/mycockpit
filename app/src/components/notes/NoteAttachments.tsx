/**
 * A tira de anexos da nota.
 *
 * Três regras de CUSTO, e as três decidem o desenho:
 *
 *  · **A lista de notas nunca chega aqui.** Ela mostra "1 imagem" em texto; só
 *    a nota ABERTA resolve URL. Resolver na lista significaria segurar um blob
 *    por linha visível.
 *  · **Object URL é revogado ao sair.** Cada `attachmentUrl` prende o blob na
 *    memória até alguém soltar; sem o cleanup, toda imagem vista fica pendurada
 *    até fechar o app.
 *  · **A miniatura é a imagem, em caixa pequena.** Redimensionar no front
 *    custaria decodificar em tamanho cheio pra depois encolher — a caixa de
 *    64px com `object-cover` já resolve a apresentação; thumb de verdade, se
 *    virar necessidade, sai do Rust como a evidência já faz.
 */

import { useEffect, useMemo, useState } from "react"
import { FileText, X } from "lucide-react"
import { attachmentUrl, revokeAttachmentUrl, type Attachment } from "@/lib/attachments"
import { useLightbox, type LightboxImage } from "@/store/lightbox"

function Miniatura({ att }: { att: Attachment }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void attachmentUrl(att).then((u) => {
      if (vivo) setUrl(u)
      else revokeAttachmentUrl(att.path)
    })
    return () => {
      vivo = false
      revokeAttachmentUrl(att.path)
    }
  }, [att])

  if (att.kind !== "image") {
    return <FileText className="size-5 text-muted-foreground/70" />
  }
  return url ? (
    <img src={url} alt={att.name} className="size-full object-cover" />
  ) : (
    // Sem "carregando": o buraco de 64px por milissegundos é ruído. Fundo
    // neutro e a imagem entra quando entra.
    <span className="size-full bg-secondary" />
  )
}

export function NoteAttachments({
  attachments,
  onRemove,
}: {
  attachments: readonly Attachment[]
  onRemove?: (path: string) => void
}) {
  const gallery = useMemo<LightboxImage[]>(() => {
    return attachments
      .filter((a) => a.kind === "image")
      .map((a) => ({
        path: a.path,
        name: a.name,
        source: "anexo" as const,
        mime: a.mime,
      }))
  }, [attachments])

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((att) => {
        const isImage = att.kind === "image"
        const imageIndex = isImage
          ? gallery.findIndex((g) => g.path === att.path)
          : -1

        return (
          <div
            key={att.path}
            className="group/att relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-background/60"
          >
            {isImage ? (
              <button
                type="button"
                onClick={() => {
                  if (imageIndex >= 0) {
                    useLightbox.getState().open(gallery, imageIndex)
                  }
                }}
                title={`${att.name} (clique para ampliar)`}
                aria-label={`Ampliar imagem ${att.name}`}
                className="size-full cursor-zoom-in transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Miniatura att={att} />
              </button>
            ) : (
              <div title={att.name} className="grid size-full place-items-center">
                <Miniatura att={att} />
              </div>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(att.path)
                }}
                aria-label={`Remover ${att.name}`}
                className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded bg-background/85 text-muted-foreground opacity-0 transition-opacity group-hover/att:opacity-100 hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
