import { describe, expect, it } from "vitest"
import { COPY_DE_VAZIO, LIMITE_PREVIEW, LIMITE_TITULO, TITULO_VAZIO, filtrarPorBusca, folhaDaNota, motivoDeVazio, normalizarBusca, tituloEPreview } from "./noteText"
import type { StickyNote } from "./types"

function nota(over: Partial<StickyNote>): StickyNote {
  return {
    id: over.id ?? "n",
    content: over.content ?? "",
    color: "sand",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe("tituloEPreview", () => {
  it("nota vazia não inventa título: diz que está sem texto", () => {
    const { titulo, preview, vazia } = tituloEPreview("")
    expect(titulo).toBe(TITULO_VAZIO)
    expect(preview).toBe("")
    expect(vazia).toBe(true)
  })

  it("nota só com espaço e quebra de linha também conta como vazia", () => {
    expect(tituloEPreview("   \n\n \t ").vazia).toBe(true)
  })

  it("nota de uma linha vira título sem preview", () => {
    const { titulo, preview, vazia } = tituloEPreview("Runbook da migração")
    expect(titulo).toBe("Runbook da migração")
    expect(preview).toBe("")
    expect(vazia).toBe(false)
  })

  it("nota de várias linhas: a primeira é título, o resto vira uma linha só", () => {
    const { titulo, preview } = tituloEPreview(
      "Jana · possível problema\n\nver mensagens da Jana sobre o fechamento\nde caixa da loja 3",
    )
    expect(titulo).toBe("Jana · possível problema")
    expect(preview).toBe("ver mensagens da Jana sobre o fechamento de caixa da loja 3")
  })

  it("descasca markdown do título e do preview (cabeçalho, lista, ênfase)", () => {
    const { titulo, preview } = tituloEPreview(
      "# Runbook da **migração**\n- DNS\n- chave do `ERP`\n",
    )
    expect(titulo).toBe("Runbook da migração")
    expect(preview).toBe("DNS chave do ERP")
  })

  it("descasca decoração empilhada (citação + checkbox)", () => {
    const { titulo } = tituloEPreview("> - [ ] conferir o log do dia 26")
    expect(titulo).toBe("conferir o log do dia 26")
  })

  it("não come a ênfase de uma linha que começa com asterisco colado", () => {
    expect(tituloEPreview("*urgente* rever o cache").titulo).toBe(
      "urgente rever o cache",
    )
  })

  it("linha só de decoração não vira título vazio: cai pra próxima linha", () => {
    const { titulo, preview } = tituloEPreview("#\n\nO título de verdade\nresto")
    expect(titulo).toBe("O título de verdade")
    expect(preview).toBe("resto")
  })

  it("corta título e preview enormes com reticências", () => {
    const gigante = `${"a".repeat(400)}\n${"b".repeat(400)}`
    const { titulo, preview } = tituloEPreview(gigante)
    expect(titulo).toHaveLength(LIMITE_TITULO + 1)
    expect(titulo.endsWith("…")).toBe(true)
    expect(preview).toHaveLength(LIMITE_PREVIEW + 1)
    expect(preview.endsWith("…")).toBe(true)
  })
})

describe("normalizarBusca", () => {
  it("tira acento e caixa", () => {
    expect(normalizarBusca("  MIGRAÇÃO ")).toBe("migracao")
  })
})

describe("filtrarPorBusca", () => {
  const lista = [
    nota({ id: "1", content: "Runbook da migração\nDNS e chave do ERP" }),
    nota({ id: "2", content: "Perguntar sobre o cache" }),
    nota({ id: "3", content: "sem título", title: "Limites do plano" }),
  ]

  it("termo vazio devolve a lista inteira", () => {
    expect(filtrarPorBusca(lista, "   ").map((n) => n.id)).toEqual(["1", "2", "3"])
  })

  it("acha sem acento e sem caixa", () => {
    expect(filtrarPorBusca(lista, "MIGRACAO").map((n) => n.id)).toEqual(["1"])
  })

  it("busca também no corpo, não só na primeira linha", () => {
    expect(filtrarPorBusca(lista, "erp").map((n) => n.id)).toEqual(["1"])
  })

  it("busca no campo title quando ele existe", () => {
    expect(filtrarPorBusca(lista, "limites").map((n) => n.id)).toEqual(["3"])
  })

  it("termo que não casa devolve lista vazia, não a lista inteira", () => {
    expect(filtrarPorBusca(lista, "kubernetes")).toEqual([])
  })

  it("não muta a lista de entrada", () => {
    const entrada = [...lista]
    filtrarPorBusca(entrada, "cache")
    expect(entrada.map((n) => n.id)).toEqual(["1", "2", "3"])
  })
})

describe("motivoDeVazio", () => {
  it("universo vazio é 'sem-notas', mesmo com busca digitada", () => {
    // Sem nota nenhuma, "a busca não achou" seria uma pista falsa: não há o que
    // achar. O gesto certo continua sendo criar.
    expect(motivoDeVazio({ total: 0, busca: "zzz", filtroAtivo: true })).toBe("sem-notas")
  })

  it("com notas no universo e busca digitada, o vazio é DA BUSCA", () => {
    // O caso do defeito: 20 notas na gaveta e a folha dizendo "Nenhuma nota
    // ainda" ao lado da coluna dizendo "Nenhuma nota com esse texto".
    expect(motivoDeVazio({ total: 20, busca: "zzz", filtroAtivo: false })).toBe("busca")
  })

  it("busca vence filtro quando os dois estão ligados", () => {
    expect(motivoDeVazio({ total: 20, busca: "zzz", filtroAtivo: true })).toBe("busca")
  })

  it("sem termo, quem esvaziou foi o filtro", () => {
    expect(motivoDeVazio({ total: 20, busca: "   ", filtroAtivo: true })).toBe("filtro")
  })

  it("os três motivos têm copy própria, e nenhuma se repete", () => {
    const titulos = Object.values(COPY_DE_VAZIO).map((c) => c.titulo)
    expect(new Set(titulos).size).toBe(titulos.length)
  })

  it("só o vazio de 'sem-notas' convida a criar; os outros convidam a desfazer", () => {
    // Oferecer "criar primeira nota" a quem tem 20 notas e digitou um termo é
    // oferecer o gesto que NÃO resolve o que está na tela.
    expect(COPY_DE_VAZIO["sem-notas"].titulo).toContain("ainda")
    expect(COPY_DE_VAZIO.busca.titulo).not.toContain("ainda")
    expect(COPY_DE_VAZIO.filtro.titulo).not.toContain("ainda")
  })
})

describe("folhaDaNota", () => {
  it("primeira linha vira título e o resto fica CRU", () => {
    const { titulo, corpo } = folhaDaNota(
      "# Jana · possível problema\n\n- conferir o log do dia 26\n- é o bug de julho",
    )
    expect(titulo).toBe("Jana · possível problema")
    // O corpo preserva markdown e quebras: a folha renderiza de verdade, ao
    // contrário do preview da lista, que colapsa tudo numa linha.
    expect(corpo).toBe("- conferir o log do dia 26\n- é o bug de julho")
  })

  it("nota de uma linha só não tem corpo", () => {
    const { titulo, corpo, vazia } = folhaDaNota("ver mensagens da Jana")
    expect(titulo).toBe("ver mensagens da Jana")
    expect(corpo).toBe("")
    expect(vazia).toBe(false)
  })

  it("nota vazia ou só de decoração não inventa título", () => {
    // Diferente da LISTA, que precisa de um rótulo pra linha existir: aqui o
    // cartão já tem o convite "clique para editar", e um título fantasma
    // seria a folha afirmando um conteúdo que não existe.
    expect(folhaDaNota("").vazia).toBe(true)
    expect(folhaDaNota("   \n\n  ").vazia).toBe(true)
    expect(folhaDaNota("---").vazia).toBe(true)
    expect(folhaDaNota("").titulo).toBe("")
  })

  it("pula linhas em branco antes do título e não as devolve no corpo", () => {
    const { titulo, corpo } = folhaDaNota("\n\n  Runbook\n\ndetalhes aqui")
    expect(titulo).toBe("Runbook")
    expect(corpo).toBe("detalhes aqui")
  })
})
