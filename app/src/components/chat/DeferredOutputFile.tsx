import { Copy, FolderOpen, PanelRight } from "lucide-react"
import { abrirBastidorDoArquivo } from "@/components/bastidores/abrirBastidores"
import { toast } from "sonner"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { Button } from "@/components/ui/button"
import { copyText } from "@/lib/clipboard"
import { isTauri } from "@/lib/db"
import type { DeferredWorkStatus } from "@/lib/work"

export interface DeferredOutputFileProps {
  outputFile: string
  status?: DeferredWorkStatus
}

export function DeferredOutputFile({
  outputFile,
  status,
}: DeferredOutputFileProps) {
  const tauri = isTauri()

  async function handleCopy() {
    await copyText(outputFile, "Caminho copiado")
  }

  async function handleReveal() {
    try {
      await revealItemInDir(outputFile)
    } catch (err) {
      console.error("[deferred-output] não consegui mostrar na pasta", err)
      toast.error("Não consegui mostrar na pasta (o arquivo ainda existe?)")
    }
  }

  const rotulo =
    status === "running"
      ? "Saída em disco (em gravação)"
      : status === "interrupted"
        ? "Saída em disco (interrompido)"
        : "Resultado em disco"

  return (
    <div className="border-t border-border/40 p-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[11px] tracking-wide text-muted-foreground/70 uppercase">
          {rotulo}
        </p>
        <div className="flex items-center gap-1">
          {tauri && (
            <Button
              type="button"
              variant="ghost"
              size="chip"
              onClick={(e) => {
                e.stopPropagation()
                abrirBastidorDoArquivo(outputFile)
              }}
              title="Acompanhar a saída ao lado da conversa"
              className="text-muted-foreground hover:text-foreground"
            >
              <PanelRight className="size-3" />
              <span>Acompanhar</span>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="chip"
            onClick={(e) => {
              e.stopPropagation()
              void handleCopy()
            }}
            title="Copiar caminho do arquivo"
            className="text-muted-foreground hover:text-foreground"
          >
            <Copy className="size-3" />
            <span>Copiar</span>
          </Button>
          {tauri && (
            <Button
              type="button"
              variant="ghost"
              size="chip"
              onClick={(e) => {
                e.stopPropagation()
                void handleReveal()
              }}
              title="Mostrar na pasta"
              className="text-muted-foreground hover:text-foreground"
            >
              <FolderOpen className="size-3" />
              <span>Mostrar na pasta</span>
            </Button>
          )}
        </div>
      </div>
      <div
        data-selectable
        className="font-mono text-[11px] leading-relaxed break-words [overflow-wrap:anywhere] text-muted-foreground select-text"
      >
        {outputFile}
      </div>
    </div>
  )
}
