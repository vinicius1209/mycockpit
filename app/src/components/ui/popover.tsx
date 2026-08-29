// O PAINEL ANCORADO — a primitiva única de "abriu preso a um elemento, e não
// interrompe o app".
//
// Ela existe porque o app já tinha DUAS implementações do mesmo gesto e nenhuma
// porta oficial:
//
//   - a gaveta de notas importava `Popover` direto do `radix-ui`, furando esta
//     camada (não havia o que importar aqui);
//   - o painel da faixa vestia `DropdownMenu` de painel, e por isso precisava
//     desarmar na mão o foco que menu traz de fábrica.
//
// A segunda é a mais cara: `DropdownMenu` é uma lista de COMANDOS. Ele instala
// roving tabindex e typeahead, e devolve o foco ao gatilho ao fechar. Um painel
// de dados com linhas e botões não quer nada disso, então cada consumidor ia
// desligando um pedaço do comportamento até sobrar posicionamento. Isto aqui é
// o posicionamento sem o resto.
//
// QUANDO NÃO USAR (a régua completa está no §12 do docs/STYLEGUIDE.md):
//   - precisa PARAR o app pra obter uma decisão → `ui/app-dialog`
//   - é "tem certeza?" → `common/confirm`
//   - é uma lista de comandos → `ui/dropdown-menu`
//   - é escolha entre valores de um campo → `ui/select` · `ui/RichSelect`
//   - é só um nome pro que o ícone já diz → `ui/tooltip`

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * A superfície E2 do painel (§4), escrita UMA vez.
 *
 * Quem usa `asChild` porque o próprio conteúdo é a superfície (a gaveta de
 * notas é uma `<aside>` com landmark) herda isto e sobrescreve só o que diverge:
 * o `cn` do Slot deixa a classe do filho vencer.
 */
export const SUPERFICIE_DO_PAINEL =
  "z-50 rounded-xl border border-border/80 bg-popover text-popover-foreground shadow-[var(--shadow-pop)] outline-none"

/** A animação de entrada/saída, igual à das outras superfícies E2 do app. */
const MOVIMENTO_DO_PAINEL =
  "origin-(--radix-popover-content-transform-origin) data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

/** Âncora separada do gatilho: pro caso em que o painel sai de um lugar
 *  diferente do botão que o abriu. */
function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverContent({
  className,
  sideOffset = 8,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        // 8 e não o 4 do Radix: a distância que a faixa de status e o chip de
        // notas já usavam na mão. Padrão nasce do que o app faz, não do vendor.
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(SUPERFICIE_DO_PAINEL, MOVIMENTO_DO_PAINEL, className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
