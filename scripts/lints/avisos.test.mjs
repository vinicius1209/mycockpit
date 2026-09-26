import { describe, expect, it } from "vitest"

import { acharAvisosCrus } from "./avisos.mjs"

// Fontes REAIS de antes da ADR-261 (`git show b982da6:app/src/...`).
const ANTES_EVENTOS = `import { toast } from "sonner"
import { recusarPedidoDeNavegador, startProjectBrowser } from "@/lib/browser"
`
const ANTES_CHATPANEL = `                  const ok = window.confirm(
                    \`Repetir “\${label}” como um novo processo gerenciado?\`,
                  )`

describe("guarda de avisos", () => {
  it("pega o toast cru e a caixa nativa que existiam", () => {
    expect(acharAvisosCrus("lib/eventosDeTrabalho.ts", ANTES_EVENTOS)).toHaveLength(1)
    expect(acharAvisosCrus("components/chat/ChatPanel.tsx", ANTES_CHATPANEL)).toHaveLength(1)
  })

  it("a porta e o wrapper podem importar o sonner", () => {
    expect(acharAvisosCrus("lib/avisos.ts", ANTES_EVENTOS)).toEqual([])
    expect(acharAvisosCrus("components/ui/sonner.tsx", 'import { Toaster } from "sonner"')).toEqual([])
  })

  it("teste pode mockar, e comentário que cita não conta", () => {
    expect(acharAvisosCrus("lib/x.test.ts", ANTES_EVENTOS)).toEqual([])
    expect(acharAvisosCrus("lib/y.ts", "// trocou o `window.confirm(` nativo\n")).toEqual([])
  })
})
