// Miniatura da imagem que o agente citou por link no fio. É a mesma moldura da
// evidência de tool (`EvidenceThumb` em MessageList) e abre no mesmo Lightbox:
// imagem no fio tem um idioma só, venha ela do MCP, do anexo ou de um link.
// Arquivo que não está no disco (ou que o Rust recusa ler) vira chip honesto,
// nunca `<img>` quebrada.

import { useEffect, useState } from "react"
import { imagemCitadaUrl } from "@/lib/imagemCitada"
import { missingLabel, useLightbox } from "@/store/lightbox"

export function ImagemCitadaThumb({ root, path }: { root: string; path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const nome = path.split("/").pop() || path

  useEffect(() => {
    let alive = true
    setUrl(null)
    setFailed(false)
    imagemCitadaUrl(root, path)
      .then((u) => alive && setUrl(u))
      .catch((err: unknown) => {
        console.warn("[fio] não consegui ler a imagem citada", path, err)
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [root, path])

  // `block` dentro de um <span>: a miniatura mora dentro do parágrafo ou do
  // item de lista do link, e <div> ali seria HTML inválido.
  if (failed) {
    return (
      <span className="mt-1.5 block w-fit rounded-md border bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground">
        {missingLabel("arquivo")}
      </span>
    )
  }
  if (!url) {
    return <span className="mt-1.5 block h-20 w-28 animate-pulse rounded-lg border bg-secondary/40" />
  }
  return (
    <span className="mt-1.5 block">
      <button
        type="button"
        onClick={() =>
          useLightbox.getState().open([{ path, name: nome, source: "arquivo", root }], 0)
        }
        title={`${nome} (clique para ampliar)`}
        className="overflow-hidden rounded-lg border transition-colors hover:border-brass/60"
      >
        <img src={url} alt={nome} className="max-h-32 max-w-[220px] object-contain" />
      </button>
    </span>
  )
}
