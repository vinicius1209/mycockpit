// A faixa entre o cabeçalho e o texto quando o disco discorda de você (spec
// §7.11). Não é toast: é estado do arquivo, e fica até a decisão.

import { FileQuestion, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AvisoDoArquivo } from "@/store/edicao"

export function FaixaDoArquivo({
  aviso,
  aoUsarODisco,
  aoManter,
  aoCopiar,
  aoFechar,
}: {
  aviso: AvisoDoArquivo
  aoUsarODisco: () => void
  aoManter: () => void
  aoCopiar: () => void
  aoFechar?: () => void
}) {
  const conflito = aviso === "conflito"
  const Icone = conflito ? TriangleAlert : FileQuestion
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2.5 border-b border-border/40 bg-sel-hover py-1.5 pr-3 pl-4 text-[12px] text-foreground/90"
    >
      {/* Âmbar só no conflito: ele pede decisão sua (§2). Sumiço é fato, cinza. */}
      <Icone className={conflito ? "size-3.5 shrink-0 text-st-warning" : "size-3.5 shrink-0 text-muted-foreground"} />
      <span className="min-w-0 flex-1">
        {conflito
          ? "Este arquivo mudou no disco depois que você começou a editar."
          : "Este arquivo não está mais no disco. O que você escreveu ainda está aqui."}
      </span>
      {conflito ? (
        <>
          <Button size="compacto" variant="ghost" onClick={aoUsarODisco}>
            Usar a do disco
          </Button>
          <Button size="compacto" variant="secondary" onClick={aoManter}>
            Manter a minha
          </Button>
        </>
      ) : (
        <>
          {aoFechar && (
            <Button size="compacto" variant="ghost" onClick={aoFechar}>
              Fechar sem salvar
            </Button>
          )}
          <Button size="compacto" variant="secondary" onClick={aoCopiar}>
            Copiar o texto
          </Button>
        </>
      )}
    </div>
  )
}
