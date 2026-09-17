// Imagem expandida na aba Alterações: no lugar de "Arquivo binário, sem diff de
// texto", a miniatura da versão do disco. Clique abre no Lightbox único, com a
// galeria de todas as imagens do diff; "Abrir na aba" leva ao visualizador de
// arquivo. Quem decide se a leitura pode acontecer é o
// `read_project_file_bytes`, igual à imagem citada no fio (ADR-195).

import { useEffect, useState } from "react"
import { PanelTop } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DiffFile } from "@/lib/git"
import { imagemCitadaUrl } from "@/lib/imagemCitada"
import { useApp } from "@/store/app"
import { useLightbox, type LightboxImage } from "@/store/lightbox"

export function DiffImagem({
  cwd,
  file,
  galeria,
  versao,
}: {
  cwd: string
  file: DiffFile
  /** Todas as imagens visíveis do diff, para ←/→ no Lightbox. */
  galeria: LightboxImage[]
  /** Muda a cada recarga do diff: força ler o disco de novo. */
  versao: number
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const nome = file.path.split("/").pop() || file.path

  useEffect(() => {
    let alive = true
    setUrl(null)
    setErro(null)
    imagemCitadaUrl(cwd, file.path)
      .then((u) => alive && setUrl(u))
      .catch((err: unknown) => {
        console.warn("[diff] não consegui ler a imagem", file.path, err)
        if (alive) setErro(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [cwd, file.path, versao])

  const indice = Math.max(
    galeria.findIndex((g) => g.path === file.path),
    0,
  )

  return (
    <div className="flex flex-col gap-2 border-t border-border/40 bg-background/40 px-4 py-3">
      {erro ? (
        <p className="text-[12px] text-muted-foreground">
          Não foi possível mostrar a imagem: {erro}
        </p>
      ) : url ? (
        <button
          type="button"
          onClick={() => useLightbox.getState().open(galeria, indice)}
          title={`${nome} (clique para ampliar)`}
          className="w-fit overflow-hidden rounded-lg border transition-colors hover:border-brass/60"
        >
          <img
            src={url}
            alt={nome}
            draggable={false}
            className="max-h-60 max-w-[min(100%,480px)] object-contain"
          />
        </button>
      ) : (
        <span className="block h-40 w-56 animate-pulse rounded-lg border bg-secondary/40" />
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="compacto"
          onClick={() => useApp.getState().openFileTab(file.path)}
        >
          <PanelTop className="size-3.5" />
          Abrir na aba
        </Button>
        {file.status === "modified" && (
          <span className="text-[11px] text-muted-foreground/60">
            Versão atual. A anterior ainda não aparece aqui.
          </span>
        )}
      </div>
    </div>
  )
}
