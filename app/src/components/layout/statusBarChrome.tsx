// O PAINEL DA FAIXA — a régua única de "o item da faixa foi clicado".
//
// A faixa inferior constata ("3 sessões paradas", "2 worktrees soltos", "70%
// da janela"); quando você clica, ela detalha. Até aqui essa segunda metade
// tinha DOIS idiomas: o medidor de uso subia um painel ancorado no item, e os
// worktrees abriam um dialog centrado que escurecia o app inteiro. Mesmo
// gesto, mesma barra, duas gramáticas — e a diferença não era decisão, era
// quem copiou qual vizinho.
//
// O idioma que fica é o do painel ancorado, por três razões:
//
//  1. **Isto é ambiente, não interrupção.** Dialog é modal: ele para o app pra
//     obter uma decisão. Ver o que está solto na máquina não para nada.
//  2. **O painel sai DE ONDE você clicou.** A relação entre o número e o
//     detalhe fica desenhada; o dialog centrado nasce órfão no meio da tela.
//  3. **Ele não tira você da conversa.** O fio continua atrás, legível.
//
// O que NÃO muda de idioma: pergunta destrutiva continua em confirm modal. Ela
// interrompe de propósito — e quem abre o confirm fecha o painel antes, porque
// dois surfaces disputando foco é briga que ninguém ganha.
//
// 29/08/2026: a primitiva passou a ser `ui/popover` (§12). Antes isto era um
// `DropdownMenu`, que traz semântica de lista de COMANDOS (roving tabindex,
// typeahead) para um painel de dados que não quer nenhuma das duas.
//
// Junto saiu o `onCloseAutoFocus` prevenido, e vale dizer por quê: ele estava
// ali para apagar o anel âmbar que acendia no item da faixa ao fechar, mas esse
// problema já é resolvido no app inteiro por `lib/modalidade.ts` (§2.1: o anel
// só acende quando o foco chegou por tecla, INCLUSIVE no gatilho que recebe o
// foco de volta). Era remédio local para doença já curada, e cobrava caro:
// devolver o foco ao gatilho é o comportamento certo pra quem navega por
// teclado, e nós o desligávamos.

import type { ReactNode } from "react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface PainelDaFaixaProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** O item da faixa que abre o painel (vai como `asChild` do trigger). */
  children: ReactNode
  /** Título em etiqueta de instrumento (§3: `.label-mono`, caixa-alta). */
  titulo: string
  /** Ícone do título, em brass — a única cor do cabeçalho. */
  icone: ReactNode
  /** Ação opcional à direita do título (ex.: "Atualizar"). */
  acao?: ReactNode
  /** Rodapé de 11px: o que a lista NÃO diz sozinha. */
  nota?: ReactNode
  /** Largura: o conteúdo manda, e o padrão serve pra lista curta. */
  largura?: string
  /** O lado de onde o painel sai. O padrão é `top`, porque a faixa mora no
   *  rodapé; a pill de uso também aparece fora dela e precisa apontar pra
   *  baixo. Existe pra que essa diferença seja um PARÂMETRO, e não o motivo
   *  de alguém recriar o painel inteiro por fora. */
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  conteudo: ReactNode
}

export function PainelDaFaixa({
  open,
  onOpenChange,
  children,
  titulo,
  icone,
  acao,
  nota,
  largura = "w-[420px]",
  side = "top",
  align = "end",
  conteudo,
}: PainelDaFaixaProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        // `top`/`end` por padrão: a faixa mora embaixo, à direita, e o painel
        // sobe dela.
        side={side}
        align={align}
        className={cn("z-[120] space-y-2.5 p-3", largura)}
      >
        <div className="flex items-center justify-between border-b border-border/40 px-1 pb-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            <span className="text-brass">{icone}</span>
            {titulo}
          </span>
          {acao}
        </div>

        {conteudo}

        {nota && <div className="px-1 text-[11px] text-muted-foreground">{nota}</div>}
      </PopoverContent>
    </Popover>
  )
}

/**
 * A LINHA de um painel da faixa: cartão de baixa elevação, conteúdo à
 * esquerda, medida à direita, ação no fim.
 *
 * Existe pra que as três listas (uso, processos, worktrees) tenham o mesmo
 * peso visual. Sem ela, cada painel inventava seu próprio padding e sua
 * própria borda — que foi exatamente como os dois idiomas nasceram.
 */
export function LinhaDoPainel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-secondary/25 px-2.5 py-2 transition-colors hover:bg-secondary/35",
        className,
      )}
    >
      {children}
    </div>
  )
}
