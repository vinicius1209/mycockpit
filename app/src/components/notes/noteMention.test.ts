import { describe, expect, it } from "vitest"
import {
  blocoDeNotas,
  comporNotasNoPrompt,
  itensDeNota,
  mencaoDaNota,
  notasMencionadas,
  rotuloDaMencao,
  slugDeTitulo,
  slugsDeNotas,
} from "./noteMention"
import type { StickyNote } from "./types"

function nota(id: string, content: string): StickyNote {
  return { id, content, color: "sand", createdAt: 0, updatedAt: 0 }
}

describe("slugDeTitulo", () => {
  it("tira acento, caixa e espaço — o endereço é digitável", () => {
    expect(slugDeTitulo("Runbook da migração")).toBe("runbook-da-migracao")
  })

  it("não deixa hífen sobrando nas pontas", () => {
    expect(slugDeTitulo("  ·· Jana · possível problema ·· ")).toBe(
      "jana-possivel-problema",
    )
  })

  it("título sem nada aproveitável ainda vira endereço", () => {
    // Melhor um endereço genérico (que o sufixo de id desempata) do que uma
    // string vazia virando `@nota/`.
    expect(slugDeTitulo("··· ")).toBe("nota")
    expect(slugDeTitulo("")).toBe("nota")
  })
})

describe("slugsDeNotas", () => {
  it("títulos iguais NÃO viram o mesmo endereço", () => {
    // Endereço ambíguo mandaria a nota errada pro agente sem erro e sem aviso.
    const a = nota("aaaa1111", "Runbook")
    const b = nota("bbbb2222", "Runbook")
    const slugs = slugsDeNotas([a, b])
    expect(slugs.get("aaaa1111")).toBe("runbook")
    expect(slugs.get("bbbb2222")).toBe("runbook-bbbb")
    expect(slugs.get("aaaa1111")).not.toBe(slugs.get("bbbb2222"))
  })

  it("o caso comum fica com o endereço limpo", () => {
    const slugs = slugsDeNotas([nota("x", "Perguntar sobre o cache")])
    expect(slugs.get("x")).toBe("perguntar-sobre-o-cache")
  })
})

describe("notasMencionadas", () => {
  const lista = [
    nota("n1", "Runbook da migração\nDNS, ERP, rollback"),
    nota("n2", "Perguntar sobre o cache"),
  ]

  it("acha a nota endereçada no meio do texto", () => {
    expect(
      notasMencionadas("olha @nota/runbook-da-migracao antes de subir", lista).map(
        (n) => n.id,
      ),
    ).toEqual(["n1"])
  })

  it("mantém a ordem do texto e não repete", () => {
    const texto = "@nota/perguntar-sobre-o-cache e @nota/runbook-da-migracao e @nota/perguntar-sobre-o-cache"
    expect(notasMencionadas(texto, lista).map((n) => n.id)).toEqual(["n2", "n1"])
  })

  it("endereço que não existe não vira nota", () => {
    expect(notasMencionadas("@nota/inventada", lista)).toEqual([])
  })

  it("não confunde menção de ARQUIVO com menção de nota", () => {
    // O composer usa o mesmo "@" pros arquivos do projeto.
    expect(notasMencionadas("@src/lib/notas.ts revisar", lista)).toEqual([])
  })

  it("texto sem menção nenhuma não custa nada", () => {
    expect(notasMencionadas("só um prompt normal", lista)).toEqual([])
  })
})

describe("comporNotasNoPrompt", () => {
  const lista = [nota("n1", "Runbook da migração\nDNS, ERP, rollback")]

  it("sem menção, o prompt sai IDÊNTICO", () => {
    // A garantia mais importante: quem não usa a feature não paga por ela, nem
    // em bytes nem em moldura.
    const texto = "manda ver"
    const r = comporNotasNoPrompt(texto, lista)
    expect(r.prompt).toBe(texto)
    expect(r.ids).toEqual([])
  })

  it("com menção, o conteúdo ATUAL da nota entra emoldurado antes do texto", () => {
    const r = comporNotasNoPrompt("segue @nota/runbook-da-migracao", lista)
    expect(r.prompt).toContain("<notas-do-usuario>")
    expect(r.prompt).toContain("DIREÇÃO dele")
    expect(r.prompt).toContain("DNS, ERP, rollback")
    expect(r.ids).toEqual(["n1"])
    // O texto do humano vem DEPOIS da moldura, separado.
    expect(r.prompt.indexOf("<notas-do-usuario>")).toBeLessThan(
      r.prompt.indexOf("segue @nota/"),
    )
  })

  it("o endereço permanece no texto do humano", () => {
    // Ele é a marca de que a nota veio dali: no fio e no transcript, quem lê
    // depois vê o que foi mencionado.
    const r = comporNotasNoPrompt("segue @nota/runbook-da-migracao", lista)
    expect(r.prompt).toContain("@nota/runbook-da-migracao")
  })

  it("menção que não resolve não some do prompt", () => {
    // Nota apagada ou renomeada: o agente lê um endereço que não achou, que é a
    // verdade, em vez de receber um texto a menos sem ninguém notar.
    const r = comporNotasNoPrompt("veja @nota/apagada-ontem", lista)
    expect(r.prompt).toBe("veja @nota/apagada-ontem")
    expect(r.ids).toEqual([])
  })

  it("nota multilinha entra indentada sob o título, sem quebrar a moldura", () => {
    const bloco = blocoDeNotas(lista)!
    const linhas = bloco.split("\n")
    expect(linhas[0]).toBe("<notas-do-usuario>")
    expect(linhas[linhas.length - 1]).toBe("</notas-do-usuario>")
    expect(bloco).toContain("  DNS, ERP, rollback")
  })

  it("lista vazia não emite moldura vazia", () => {
    expect(blocoDeNotas([])).toBeNull()
  })

  it("nota com anexo devolve os anexos e cita os nomes dentro da moldura", () => {
    const comPrint = {
      ...nota("n2", "Print do limite"),
      attachments: [{ path: "attachments/notes/n2/a.png", name: "limite.png", kind: "image" as const, mime: "image/png", bytes: 1 }],
    }
    const r = comporNotasNoPrompt("olha @nota/print-do-limite", [comPrint])
    expect(r.anexos.map((a) => a.path)).toEqual(["attachments/notes/n2/a.png"])
    expect(r.prompt).toContain("Anexos desta nota (enviados com este turno): limite.png")
    expect(r.prompt.indexOf("limite.png")).toBeLessThan(r.prompt.indexOf("</notas-do-usuario>"))
    // sem menção, nada de anexo
    expect(comporNotasNoPrompt("sem nota", [comPrint]).anexos).toEqual([])
  })
})

describe("o que o menu e o botão inserem", () => {
  const lista = [nota("n1", "Runbook da migração"), nota("n2", "Outra")]

  it("o item do menu carrega o endereço e o título legível", () => {
    expect(itensDeNota(lista)).toEqual([
      { value: "nota/runbook-da-migracao", titulo: "Runbook da migração" },
      { value: "nota/outra", titulo: "Outra" },
    ])
  })

  it("o botão da nota insere o MESMO endereço que o menu", () => {
    // Um mecanismo, duas portas: o que o botão cola tem que ser resolvível pelo
    // mesmo caminho que o "@" do composer.
    const inserido = mencaoDaNota(lista[0], lista)
    expect(inserido).toBe("@nota/runbook-da-migracao")
    expect(notasMencionadas(inserido, lista).map((n) => n.id)).toEqual(["n1"])
  })
})

describe("rotuloDaMencao", () => {
  it("tira o prefixo e devolve algo legível", () => {
    // O `nota/` é endereço: já está dito pelo cabeçalho da seção e pelo ícone.
    // Repetido em cada linha ele empurra o nome pra fora da largura.
    expect(rotuloDaMencao("nota/ver-o-log-do-dia-26")).toBe("ver o log do dia 26")
  })

  it("é derivável só do VALOR — é o que sobrevive ao round-trip do rascunho", () => {
    // O pill é remontado a partir do TEXTO do draft, então rótulo que dependa
    // de dado carregado ao lado apareceria diferente depois de recarregar.
    const lista = [nota("n1", "Runbook da migração")]
    const endereco = mencaoDaNota(lista[0], lista).slice(1)
    expect(rotuloDaMencao(endereco)).toBe("runbook da migracao")
  })

  it("valor que não é nota passa inteiro", () => {
    expect(rotuloDaMencao("src/lib/send.ts")).toBe("src/lib/send.ts")
  })
})
