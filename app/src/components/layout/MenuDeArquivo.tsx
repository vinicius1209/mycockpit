// O menu de arquivo na tela: as linhas do catálogo (`lib/acoesDeArquivo.ts`)
// com ícone e atalho, para a árvore (menu no ponto do clique) e para a aba
// (menu ancorado nela). A árvore tem UM menu para todas as linhas: nada por
// linha (docs/explorador-de-arquivos-prd.md, 5b).

import { useState, type ComponentType, type ReactNode } from "react"
import {
  AppWindow,
  ChevronsDownUp,
  Columns2,
  Copy,
  ExternalLink,
  FileDiff,
  FileText,
  FolderOpen,
  FolderTree,
  Quote,
  Search,
} from "lucide-react"
import { PointMenu, PointMenuItem, PointMenuSeparator } from "@/components/ui/context-menu"
import { citarNoComposer, executarAcaoDeArquivo, type ContextoDaAcao } from "@/components/common/executarAcaoDeArquivo"
import {
  atalhoDaAcao,
  DIVISOR_DE_ARQUIVO,
  itensDoArquivo,
  rotuloDaAcao,
  type AcaoDeArquivo,
  type AlvoDeArquivo,
  type LinhaDoMenuDeArquivo,
} from "@/lib/acoesDeArquivo"
import { currentPlatform } from "@/lib/commandMenu"
import { isTauri } from "@/lib/db"
import { useAbasDeArquivo } from "@/store/abasDeArquivo"
import { useChat } from "@/store/chat"
import { ehApple } from "./atalhosDasAbas"

const ICONE: Record<AcaoDeArquivo, ComponentType> = {
  abrir: FileText,
  "abrir-ao-lado": Columns2,
  "abrir-no-editor": ExternalLink,
  "abrir-no-app": AppWindow,
  citar: Quote,
  "ver-alteracoes": FileDiff,
  "copiar-nome": Copy,
  "copiar-caminho-relativo": Copy,
  "copiar-caminho-completo": Copy,
  "copiar-caminhos": Copy,
  "buscar-na-pasta": Search,
  "recolher-dentro": ChevronsDownUp,
  "mostrar-na-arvore": FolderTree,
  "mostrar-na-pasta": FolderOpen,
}

const ATALHO = "ml-auto pl-4 font-mono text-[11px] text-muted-foreground/60"

/** As linhas do catálogo, no Item e no Separador da família de menu de quem
 *  monta (o `PointMenu` da árvore, o `ContextMenu` da aba). */
export function LinhasDoMenuDeArquivo({
  linhas,
  alvo,
  aoEscolher,
  Item,
  Separador,
}: {
  linhas: readonly LinhaDoMenuDeArquivo[]
  alvo: AlvoDeArquivo
  aoEscolher: (acao: AcaoDeArquivo) => void
  Item: ComponentType<{ onSelect: () => void; children: ReactNode }>
  Separador: ComponentType
}) {
  const mac = ehApple(currentPlatform())
  return (
    <>
      {linhas.map((linha, i) => {
        if (linha === DIVISOR_DE_ARQUIVO) return <Separador key={`d${i}`} />
        const Icone = ICONE[linha]
        const atalho = atalhoDaAcao(linha, mac)
        return (
          <Item key={linha} onSelect={() => aoEscolher(linha)}>
            <Icone />
            {rotuloDaAcao(linha, alvo)}
            {atalho && <span className={ATALHO}>{atalho}</span>}
          </Item>
        )
      })}
    </>
  )
}

export interface PedidoDoMenu {
  x: number
  y: number
  alvo: AlvoDeArquivo
}

/** O menu da árvore: quem abre, com que recursos, e o JSX dele. */
export function useMenuDaArvore(
  root: string,
  arvore: Omit<ContextoDaAcao, "root"> & {
    expandida: (rel: string) => boolean
    /** Do mesmo `git status` que pinta a letra da linha. */
    alterados: ReadonlyMap<string, unknown>
  },
) {
  const [pedido, setPedido] = useState<PedidoDoMenu | null>(null)
  const alterados = arvore.alterados
  const conversa = useChat((s) => s.activeId !== null)
  const ladoCabe = useAbasDeArquivo((s) => s.ladoCabe)
  const ctx: ContextoDaAcao = { root, aoBuscarNaPasta: arvore.aoBuscarNaPasta, aoRecolher: arvore.aoRecolher }

  const linhasDe = (alvo: AlvoDeArquivo) =>
    itensDoArquivo(alvo, {
      noApp: isTauri(),
      conversa,
      ladoCabe,
      alterado: alvo.tipo === "arquivo" && alterados.has(alvo.rel),
      expandida: alvo.tipo === "pasta" && arvore.expandida(alvo.rel),
    })

  const menu = pedido && (
    <PointMenu
      key={`${pedido.x}:${pedido.y}`}
      x={pedido.x}
      y={pedido.y}
      open
      onOpenChange={(aberto) => {
        if (!aberto) setPedido(null)
      }}
    >
      <LinhasDoMenuDeArquivo
        linhas={linhasDe(pedido.alvo)}
        alvo={pedido.alvo}
        // Depois do fechamento, como o menu do app: o Radix ainda devolve o
        // foco durante o `onSelect`.
        aoEscolher={(acao) => setTimeout(() => void executarAcaoDeArquivo(acao, pedido.alvo, ctx), 0)}
        Item={PointMenuItem}
        Separador={PointMenuSeparator}
      />
    </PointMenu>
  )

  return {
    menu,
    abrir: (x: number, y: number, alvo: AlvoDeArquivo) => setPedido({ x, y, alvo }),
    /** ⌘↵ na linha focada: o foco fica na árvore. Sem conversa, o próprio
     *  citar diz onde abrir uma. */
    citar: (alvo: AlvoDeArquivo) =>
      citarNoComposer(
        root,
        alvo.tipo === "varios" ? alvo.itens : [{ rel: alvo.rel, pasta: alvo.tipo === "pasta" }],
        { focar: false },
      ),
  }
}
