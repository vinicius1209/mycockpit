// As linhas da busca agrupada que não são arquivo (ADR-254): o cabeçalho do
// grupo (a pasta de primeiro nível e quantos achados), o "mais N" e a linha dos
// gerados parecidos. Todas são o mesmo `Button` compacto da árvore: mesma
// altura, mesmo recuo, mesmo hover. O arquivo continua sendo a linha da árvore.

import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FileIcon } from "@/components/ui/file-icon"
import type { EntradaDaBusca, LinhaDaBusca } from "@/lib/buscaAgrupada"

type LinhaSemArquivo<E extends EntradaDaBusca> = Exclude<LinhaDaBusca<E>, { tipo: "arquivo" }>

/** Nome da raiz do projeto, para rotular o que mora nela. Puro. */
export function nomeDoCaminhoRaiz(root: string): string {
  return root.replace(/\/+$/, "").split("/").pop() || root
}

/** Chave estável da linha para o React. Puro. */
export function chaveDaLinha<E extends EntradaDaBusca>(linha: LinhaSemArquivo<E>): string {
  if (linha.tipo === "grupo") return `grupo:${linha.chave}`
  if (linha.tipo === "mais") return `mais:${linha.grupo}`
  return `parecidos:${linha.chave}`
}

export function LinhaDeGrupoDaBusca<E extends EntradaDaBusca>({
  linha,
  onAlternar,
}: {
  linha: LinhaSemArquivo<E>
  onAlternar: (linha: LinhaSemArquivo<E>) => void
}) {
  if (linha.tipo === "grupo") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="compacto"
        aria-expanded={linha.aberto}
        onClick={() => onAlternar(linha)}
        className="mt-1 flex w-full justify-start gap-1 rounded-md pr-2 pl-2 text-left font-medium text-foreground"
      >
        <span className="grid size-3.5 shrink-0 place-items-center text-muted-foreground/55">
          {linha.aberto ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
        <FileIcon path={linha.nome} folder />
        <span className="min-w-0 flex-1 truncate text-[12px]">{linha.nome}</span>
        <span className="shrink-0 text-[11px] font-normal text-muted-foreground tabular-nums">{linha.total}</span>
      </Button>
    )
  }
  if (linha.tipo === "mais") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="compacto"
        onClick={() => onAlternar(linha)}
        // Recuo da linha de arquivo do grupo (8 + 1×12 + a coluna do chevron).
        style={{ paddingLeft: 38 }}
        className="flex w-full justify-start text-[12px] font-normal text-muted-foreground"
      >
        mais {linha.quantos}
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="compacto"
      onClick={() => onAlternar(linha)}
      title={`${linha.quantos} arquivos com o mesmo começo; clique para ver todos`}
      style={{ paddingLeft: 20 + 14 + 4 }}
      className="flex w-full justify-start gap-1 rounded-md pr-2 text-left font-normal text-muted-foreground"
    >
      <FileIcon path={linha.entrada.name} />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{linha.modelo}</span>
      <span className="shrink-0 rounded-full border px-1.5 text-[11px] tabular-nums">{linha.quantos} parecidos</span>
    </Button>
  )
}
