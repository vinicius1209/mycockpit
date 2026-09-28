import { describe, expect, it } from "vitest"
import { metaDoArquivo, quemAlterou, tipoDoArquivo, type CandidatoDeAlteracao } from "@/lib/detalheDoCaminho"

const NOW = 1_790_600_000_000
const RAIZ = "/Users/viniciusmachado/projetos/pessoais/projeto"
const REL = "backend/src/main/java/com/vini/financemonitor/ingestion/pdf/ParsedRow.java"
const ABS = `${RAIZ}/${REL}`

/** Entradas como o Rust as devolve (sem o conteúdo), das ferramentas reais de
 *  cada motor no banco: `Read`/`Edit` do Claude e do Codex, e a edição do
 *  Antigravity já no vocabulário do contrato. */
function candidato(p: Partial<CandidatoDeAlteracao>): CandidatoDeAlteracao {
  return {
    conversaId: "c1",
    titulo: "finance monitor",
    motor: "claude-code",
    fonte: "custo",
    nome: "Edit",
    entrada: { file_path: ABS, old_string: "}", new_string: "}\n" },
    quando: NOW - 3_600_000,
    terminou: NOW - 3_599_900,
    ...p,
  }
}

describe("quem alterou", () => {
  it("leitura não conta, e a alteração de cada conversa aparece uma vez, a mais recente primeiro", () => {
    const q = quemAlterou(
      [
        candidato({ conversaId: "c2", titulo: "revisão", motor: "codex", quando: NOW - 60_000, terminou: NOW - 59_000 }),
        candidato({ nome: "Read", entrada: { file_path: ABS }, quando: NOW - 30_000 }),
        candidato({}),
        candidato({ quando: NOW - 7_200_000 }),
      ],
      { root: RAIZ, rel: REL, conversaAtiva: "c1", alteradoEm: NOW - 59_000 },
    )
    expect(q.linhas.map((l) => [l.conversaId, l.motor, l.nesta])).toEqual([
      ["c2", "codex", false],
      ["c1", "claude-code", true],
    ])
    expect(q.linhas[1].quando).toBe(NOW - 3_600_000)
    expect(q.fora).toBeNull()
  })

  it("o Antigravity conta pelo mesmo critério, sem nome de motor no código", () => {
    // O adapter traduz `replace_file_content {TargetFile}` para o contrato
    // (`agy_ferramentas.rs`, ADR-253): é assim que a ação dele fica gravada.
    const q = quemAlterou(
      [candidato({ motor: "agy", nome: "Edit", entrada: { file_path: ABS } })],
      { root: RAIZ, rel: REL, conversaAtiva: null, alteradoEm: null },
    )
    expect(q.linhas.map((l) => l.motor)).toEqual(["agy"])
  })

  it("caminho relativo casa com o da árvore, e a cópia de um worktree não é este arquivo", () => {
    const q = quemAlterou(
      [
        candidato({ conversaId: "rel", entrada: { file_path: `./${REL}` } }),
        candidato({ conversaId: "wt", entrada: { file_path: `${RAIZ}/.frota/worktrees/wt/${REL}` } }),
      ],
      { root: `${RAIZ}/`, rel: REL, conversaAtiva: null, alteradoEm: null },
    )
    expect(q.linhas.map((l) => l.conversaId)).toEqual(["rel"])
  })

  it("disco mais novo que a última alteração conhecida vira 'fora de uma conversa'", () => {
    const base = [candidato({})]
    const depois = quemAlterou(base, { root: RAIZ, rel: REL, conversaAtiva: null, alteradoEm: NOW - 120_000 })
    expect(depois.fora).toBe(NOW - 120_000)
    // A escrita da própria ação deixa o mtime logo depois dela: não é "fora".
    const junto = quemAlterou(base, { root: RAIZ, rel: REL, conversaAtiva: null, alteradoEm: NOW - 3_599_000 })
    expect(junto.fora).toBeNull()
  })

  it("mais de três conversas viram 'e mais N'", () => {
    const q = quemAlterou(
      ["a", "b", "c", "d", "e"].map((id, i) => candidato({ conversaId: id, quando: NOW - i * 1000 })),
      { root: RAIZ, rel: REL, conversaAtiva: null, alteradoEm: null },
    )
    expect(q.linhas).toHaveLength(3)
    expect(q.mais).toBe(2)
  })
})

describe("a linha de metadados", () => {
  it("tipo, tamanho, linhas e quando mudou, sem contagem de diff", () => {
    const meta = metaDoArquivo({ tipo: "arquivo", bytes: 4300, alteradoEm: NOW - 120_000, linhas: 112, link: null }, "PLAN.md", NOW)
    expect(meta).toBe("Markdown · 4.2 KB · 112 linhas · alterado há 2 min")
    expect(meta).not.toMatch(/[+−]\d/)
  })

  it("imagem leva as dimensões, e extensão desconhecida vira a própria extensão", () => {
    expect(metaDoArquivo({ tipo: "arquivo", bytes: 612 * 1024, alteradoEm: null, linhas: null, link: null }, "a.png", NOW, "1440 × 900"))
      .toBe("PNG · 1440 × 900 · 612.0 KB")
    expect(tipoDoArquivo("Makefile")).toBe("Arquivo")
    expect(tipoDoArquivo("x.proto")).toBe("PROTO")
  })
})
