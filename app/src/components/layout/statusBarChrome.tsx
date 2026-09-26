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

import { useState, type ComponentProps, type ReactNode } from "react"
import { controle } from "@/components/ui/controle"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
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
  /** Título em etiqueta de instrumento (§3: `.etiqueta`, caixa-alta). */
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
  /** O resumo ao passar o mouse, sem clicar (ADR-262). Some quando o painel
   *  abre: as duas superfícies nunca aparecem juntas. */
  dica?: ReactNode
  /** O pé da dica: o dado de apoio à esquerda e o que o clique abre. */
  peDaDica?: ReactNode
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
  dica,
  peDaDica,
}: PainelDaFaixaProps) {
  const gatilho = <PopoverTrigger asChild>{children}</PopoverTrigger>
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {dica ? (
        <DicaDaFaixa conteudo={dica} pe={peDaDica} side={side} align={align} calada={open}>
          {gatilho}
        </DicaDaFaixa>
      ) : (
        gatilho
      )}
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

/**
 * O GATILHO de um item da faixa (ADR-262): a zona que se clica. Até aqui cada
 * item era texto solto que só clareava no hover, e a faixa lia como uma frase
 * corrida ("nada parece clicável", 26/09/2026). Agora cada zona tem o degrau
 * `chip` (24px, a altura da faixa) e o fundo de seleção no hover e com o
 * painel aberto. A área cresce PARA FORA (`-mx-2` devolve o padding): o texto
 * fica exatamente onde estava (§14).
 *
 * Repassa `ref` e o resto das props: ele é filho `asChild` do popover e do
 * cartão de dica (regra 2 do CLAUDE.md).
 */
export function GatilhoDaFaixa({ className, ...resto }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...resto}
      className={cn(
        controle("chip"),
        "-mx-2 font-mono whitespace-nowrap text-muted-foreground outline-none transition-colors hover:bg-sel hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 data-[state=open]:bg-sel",
        className,
      )}
    />
  )
}

/** O DIVISOR da faixa: só onde muda o assunto (planos | gasto, máquina |
 *  build). É o filete de divisor interno (§4), na altura do texto. Cada zona
 *  some sozinha sem dado, então o divisor se esconde quando sobra na ponta do
 *  grupo: divisor órfão é placeholder, e a faixa não desenha placeholder. */
export function DivisorDaFaixa() {
  return <span aria-hidden className="h-3.5 shrink-0 border-l border-border/40 first:hidden last:hidden" />
}

/**
 * A DICA de uma zona da faixa (ADR-262, ADR-264): o cartão que aparece ao
 * passar o mouse. Sem título: a dica sai da zona que você está apontando, e
 * repetir "Gasto" ou "Máquina" no alto só empurrava o número para baixo
 * (26/09/2026). O corpo começa na resposta; o pé leva o dado de apoio e diz o
 * que o clique faz. Largura fixa, para nada quebrar no meio.
 */
export function DicaDaFaixa({
  children,
  conteudo,
  pe,
  side = "top",
  align = "start",
  calada = false,
}: {
  children: ReactNode
  conteudo: ReactNode
  pe?: ReactNode
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  /** Com o painel aberto, a dica não aparece. */
  calada?: boolean
}) {
  const [aberta, setAberta] = useState(false)
  return (
    <HoverCard open={aberta && !calada} onOpenChange={setAberta} openDelay={350}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} align={align} className="w-80 overflow-hidden p-0 text-[12px]">
        <div className="flex flex-col gap-2 px-3 pt-3 pb-2.5">{conteudo}</div>
        {pe && (
          <div className="flex items-center gap-2 border-t border-border/40 bg-secondary/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            {pe}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

/** O que o clique faz, no fim do pé da dica. */
export function AcaoDoClique({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap">
      {children}
      <span className="rounded border bg-card px-1 font-mono text-[11px] text-muted-foreground">clique</span>
    </span>
  )
}
