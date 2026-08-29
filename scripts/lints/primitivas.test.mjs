import { describe, it, expect } from "vitest"

import { acharPrimitivasErradas, comoConsertar } from "./primitivas.mjs"

// As duas primeiras fixtures são o CÓDIGO REAL que o app tinha até 29/08/2026,
// colhido de `git show fd192a2:…`. Guarda testada só com exemplo inventado
// prova que ela pega o exemplo inventado (ADR-016).

/** `StickyNotesTrigger.tsx:13` — o vendor entrando direto no consumidor. */
const GAVETA_COM_VENDOR = `
import { useLayoutEffect, useMemo, useState } from "react"
import { Popover as PopoverPrimitive } from "radix-ui"
import { StickyNotesDock } from "@/components/notes/StickyNotesDock"
`

/** `statusBarChrome.tsx:23,60` — o painel vestido de menu. Repare que não há
 *  um `DropdownMenuItem` sequer: o conteúdo é cabeçalho, lista e rodapé. */
const PAINEL_VESTIDO_DE_MENU = `
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function PainelDaFaixa({ open, onOpenChange, children, conteudo }) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={8}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {conteudo}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
`

/** Um menu de verdade: tem itens, e por isso é `DropdownMenu` com razão. */
const MENU_DE_VERDADE = `
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function MenuDeCriar({ onCreate }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button>Nova</button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onCreate("conversa")}>Da conversa</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCreate("projeto")}>Do projeto</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
`

describe("guarda de primitivas (§12)", () => {
  it("acusa o vendor Radix importado fora de components/ui", () => {
    const achados = acharPrimitivasErradas([
      { relPath: "components/notes/StickyNotesTrigger.tsx", source: GAVETA_COM_VENDOR },
    ])
    expect(achados).toHaveLength(1)
    expect(achados[0].regra).toBe("vendor")
    expect(achados[0].linha).toBe(3)
  })

  it("acusa a forma antiga do import, com escopo por pacote", () => {
    const achados = acharPrimitivasErradas([
      {
        relPath: "components/chat/Algo.tsx",
        source: `import * as Tabs from "@radix-ui/react-tabs"\n`,
      },
    ])
    expect(achados).toHaveLength(1)
    expect(achados[0].regra).toBe("vendor")
  })

  it("deixa components/ui importar o vendor, que é a razão de ela existir", () => {
    const achados = acharPrimitivasErradas([
      { relPath: "components/ui/popover.tsx", source: GAVETA_COM_VENDOR },
    ])
    expect(achados).toEqual([])
  })

  it("acusa DropdownMenu sem nenhum item: painel vestido de menu", () => {
    const achados = acharPrimitivasErradas([
      { relPath: "components/layout/statusBarChrome.tsx", source: PAINEL_VESTIDO_DE_MENU },
    ])
    expect(achados).toHaveLength(1)
    expect(achados[0].regra).toBe("menu-sem-item")
  })

  it("não acusa menu que tem item, que é menu de verdade", () => {
    const achados = acharPrimitivasErradas([
      { relPath: "components/notes/StickyNotesDock.tsx", source: MENU_DE_VERDADE },
    ])
    expect(achados).toEqual([])
  })

  it("ignora teste, que cita a violação pra provar que ela é pega", () => {
    const achados = acharPrimitivasErradas([
      { relPath: "components/notes/StickyNotesTrigger.test.tsx", source: GAVETA_COM_VENDOR },
    ])
    expect(achados).toEqual([])
  })

  it("a mensagem de conserto aponta a porta, não só o erro", () => {
    expect(comoConsertar("vendor")).toContain("components/ui/")
    expect(comoConsertar("menu-sem-item")).toContain("popover")
  })
})
