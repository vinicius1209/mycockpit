import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { QueuedChips, fraseDaFila, indiceDeSoltura } from "./FilaDoComposer"
import { galeriaDosAnexos } from "./MiniaturaDeAnexo"
import { fmtTempo } from "@/components/layout/PlayerDeVideo"
import type { Attachment } from "@/lib/attachments"

// Anexo com a forma real do `save_attachment` (lib/attachments.ts).
const print: Attachment = {
  path: "attachments/1200a161/0558cda84683e59a.png",
  name: "image.png",
  mime: "image/png",
  kind: "image",
  bytes: 597_300,
}
const pdf: Attachment = { path: "attachments/1200a161/contrato.pdf", name: "contrato.pdf", mime: "application/pdf", kind: "pdf", bytes: 88_000 }

describe("fila do composer (ADR-240)", () => {
  it("a frase diz que elas vão juntas, num envio só", () => {
    expect(fraseDaFila("running")).toBe("vão juntas, num envio só, quando este turno terminar")
    expect(fraseDaFila("idle")).toBe("prontas para enviar")
  })

  it("com UMA mensagem, a alça some sem sair do grid (o texto não cai na coluna de 16px)", () => {
    const html = renderToStaticMarkup(
      <QueuedChips
        queued={[{ text: "ficou essa mensagem de “rovogar” e nao saiu, iso é normal?", attachments: [print] }]}
        onRemove={() => {}}
        onMover={() => {}}
        turnState="running"
      />,
    )
    const alca = html.match(/<button[^>]*aria-label="Arrastar para reordenar"[^>]*>/)?.[0] ?? ""
    expect(alca).toContain("disabled")
    expect(alca).toContain("disabled:invisible")
    expect(alca).not.toContain("disabled:hidden")
  })

  it("arrastar solta no item cujo meio o ponteiro passou", () => {
    const meios = [100, 140, 180]
    expect(indiceDeSoltura(90, meios)).toBe(0)
    expect(indiceDeSoltura(150, meios)).toBe(2)
    expect(indiceDeSoltura(500, meios)).toBe(3)
  })

  it("mensagem longa inteira no DOM (o corte é visual) e anexos como miniaturas", () => {
    const longa = "eu queria poder ter a capacidade de reproduzir o mp4. Não queria limitações assim para ver arquivos. Isso é possível? E aqui no composer, conforme a segunda imagem"
    const html = renderToStaticMarkup(
      <QueuedChips
        queued={[{ text: longa, attachments: [print, pdf] }]}
        onRemove={() => {}}
        onEdit={() => {}}
        onForceSend={() => {}}
        onMover={() => {}}
        turnState="running"
      />,
    )
    expect(html).toContain(longa)
    expect(html).toContain("line-clamp-2")
    expect(html).toContain("Ver image.png")
    expect(html).toContain("Interromper e enviar a fila")
    // um item só: nada a reordenar
    expect(html).toContain("disabled")
    // "Enviar agora" aparece UMA vez, no cabeçalho
    expect(html.match(/Enviar agora/g)).toHaveLength(1)
  })

  it("o visualizador navega só entre as imagens do grupo", () => {
    expect(galeriaDosAnexos([print, pdf]).map((g) => g.name)).toEqual(["image.png"])
  })
})

describe("tempo do player", () => {
  it("formata como o player do sistema", () => {
    expect(fmtTempo(37.567)).toBe("0:37")
    expect(fmtTempo(725)).toBe("12:05")
    expect(fmtTempo(3723)).toBe("1:02:03")
    expect(fmtTempo(Number.NaN)).toBe("0:00")
  })
})
