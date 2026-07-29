// FASE 1 do composer Lexical: a lógica PURA da ponte draft (string) ↔ conteúdo
// do editor. O que importa é o CONTRATO com o handleSend da conversa: o texto
// que sai do editor tem que ser a MESMA string `@nome` que o textarea produzia
// hoje. Aqui provamos isso pelo par planDraft/serializePlan (o mesmo plano que
// $setDraft vira nós e $serializeDraft lê de volta), sem precisar de um editor.

import { describe, expect, it } from "vitest"
import { planDraft, serializePlan } from "./lexicalDraft"

const NOMES = ["Ana", "Ana Paula", "Bruno"]

describe("planDraft — draft (string) → plano de tokens por linha", () => {
  it("texto puro sem menção vira um único token de texto", () => {
    expect(planDraft("olá mundo", NOMES)).toEqual([
      [{ type: "text", text: "olá mundo" }],
    ])
  })

  it("um @nome conhecido vira token de menção só com o nome (sem @)", () => {
    expect(planDraft("oi @Ana tudo bem", NOMES)).toEqual([
      [
        { type: "text", text: "oi " },
        { type: "mention", name: "Ana" },
        { type: "text", text: " tudo bem" },
      ],
    ])
  })

  it("nome mais longo tem prioridade (@Ana Paula, não @Ana)", () => {
    expect(planDraft("chama @Ana Paula aqui", NOMES)).toEqual([
      [
        { type: "text", text: "chama " },
        { type: "mention", name: "Ana Paula" },
        { type: "text", text: " aqui" },
      ],
    ])
  })

  it("@desconhecido NÃO vira menção, fica texto puro", () => {
    expect(planDraft("oi @Carlos", NOMES)).toEqual([
      [{ type: "text", text: "oi @Carlos" }],
    ])
  })

  it("cada \\n vira uma linha do plano (Shift+Enter no editor)", () => {
    expect(planDraft("linha 1\nlinha 2", NOMES)).toEqual([
      [{ type: "text", text: "linha 1" }],
      [{ type: "text", text: "linha 2" }],
    ])
  })

  it("linha vazia entre duas linhas vira uma linha sem tokens", () => {
    expect(planDraft("a\n\nb", NOMES)).toEqual([
      [{ type: "text", text: "a" }],
      [],
      [{ type: "text", text: "b" }],
    ])
  })

  it("draft vazio vira uma linha sem tokens", () => {
    expect(planDraft("", NOMES)).toEqual([[]])
  })

  it("sem nomes conhecidos, nada vira menção", () => {
    expect(planDraft("oi @Ana", [])).toEqual([
      [{ type: "text", text: "oi @Ana" }],
    ])
  })

  // FASE 3: caminho de arquivo também é mencionável (o vocabulário que o
  // composer passa inclui os arquivos do projeto) — o pill serializa pro MESMO
  // `@caminho` que o textarea insere.
  it("@caminho de arquivo conhecido vira menção (pill de arquivo)", () => {
    const vocab = [...NOMES, "src/lib/db.ts"]
    expect(planDraft("revisa @src/lib/db.ts agora", vocab)).toEqual([
      [
        { type: "text", text: "revisa " },
        { type: "mention", name: "src/lib/db.ts" },
        { type: "text", text: " agora" },
      ],
    ])
    expect(
      serializePlan(planDraft("revisa @src/lib/db.ts agora", vocab)),
    ).toBe("revisa @src/lib/db.ts agora")
  })

  it("@caminho parecido mas não listado fica texto puro", () => {
    const vocab = [...NOMES, "src/lib/db.ts"]
    expect(planDraft("olha @src/lib/db.test.ts", vocab)).toEqual([
      [{ type: "text", text: "olha @src/lib/db.test.ts" }],
    ])
  })
})

describe("serializePlan — plano → string do draft (o que vai pro onSend)", () => {
  it("menção volta a ser @nome inline", () => {
    const plan = planDraft("oi @Ana tudo bem", NOMES)
    expect(serializePlan(plan)).toBe("oi @Ana tudo bem")
  })

  it("linhas voltam a ser \\n (nunca \\n\\n)", () => {
    const plan = planDraft("linha 1\nlinha 2", NOMES)
    expect(serializePlan(plan)).toBe("linha 1\nlinha 2")
  })
})

describe("round-trip: serializePlan(planDraft(v)) === v (contrato do handleSend)", () => {
  const casos = [
    "olá mundo",
    "oi @Ana tudo bem",
    "chama @Ana Paula e @Bruno",
    "@Ana no começo",
    "no fim @Bruno",
    "linha 1\nlinha 2\n@Ana na 3",
    "a\n\nb",
    "e-mail joao@x.com não é menção",
    "",
  ]
  for (const v of casos) {
    it(`preserva ${JSON.stringify(v)}`, () => {
      expect(serializePlan(planDraft(v, NOMES))).toBe(v)
    })
  }
})
