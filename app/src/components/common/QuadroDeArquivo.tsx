// A cara de um arquivo em cartão: quadro de 40px com o ícone do tipo, nome em
// 12 e meta em 11. Uma peça só para o arquivo solto no composer (ADR-252) e o
// arquivo entregue no fio (G1): duas superfícies, o mesmo gesto.

import type { ReactNode } from "react"
import { FileIcon } from "@/components/ui/file-icon"
import { nomeDoCaminho } from "@/lib/arquivoCitado"
import { nomeCortadoNoMeio } from "@/lib/nomeNoMeio"

/** A casca clicável dos dois cartões: mesma largura, mesmo fundo, mesmo hover. */
export const CASCA_DO_CARTAO_DE_ARQUIVO =
  "flex max-w-[260px] items-center gap-2 rounded-lg bg-secondary/60 py-1 pr-2 pl-1 text-left transition-colors hover:bg-secondary"

export function QuadroDeArquivo({
  caminho,
  pasta = false,
  meta,
}: {
  caminho: string
  pasta?: boolean
  meta: ReactNode
}) {
  const nome = nomeDoCaminho(caminho)
  return (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-background">
        <FileIcon path={caminho} folder={pasta} size={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] whitespace-nowrap text-foreground" title={nome}>
          {nomeCortadoNoMeio(nome, 30)}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{meta}</span>
      </span>
    </>
  )
}
