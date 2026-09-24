import { describe, expect, it } from "vitest"
import {
  MEMORIA_DE_FECHADAS,
  SEM_ABAS,
  chaveDoDiff,
  lerChave,
  semNada,
  aDireitaDe,
  abaVizinha,
  abrirAba,
  fecharAbas,
  lembrarFechadas,
  moverAba,
  outrasAlemDe,
  rotulosDasAbas,
  vizinhaAoFechar,
} from "./abasDeArquivo"

// Caminhos reais do repositório, os mesmos do mock aprovado.
const VIDEO = "docs/visual-reference/winglee-agent-ui/video.mp4"
const ARQ = "docs/architecture.md"
const FRAME = "docs/visual-reference/winglee-agent-ui/frame_020.png"
const RUNNER = "docs/agent-runner.md"

describe("abas de arquivo (modelo puro)", () => {
  it("abrir o mesmo arquivo de novo não duplica a aba", () => {
    const a = abrirAba(abrirAba(SEM_ABAS, ARQ), VIDEO)
    expect(abrirAba(a, ARQ)).toBe(a)
    expect(a.abertas).toEqual([ARQ, VIDEO])
  })

  it("fechar a aba à vista mostra a da direita, senão a da esquerda, senão a Conversa", () => {
    const abertas = [VIDEO, ARQ, FRAME]
    expect(vizinhaAoFechar(abertas, ARQ)).toBe(FRAME)
    expect(vizinhaAoFechar(abertas, FRAME)).toBe(ARQ)
    expect(vizinhaAoFechar([ARQ], ARQ)).toBeNull()
  })

  it("fechar leva junto a vista guardada e o lado, se forem o fechado", () => {
    const a = { abertas: [VIDEO, ARQ, FRAME], vista: ARQ, aoLado: FRAME, navegador: "aberto" as const }
    expect(fecharAbas(a, [ARQ, FRAME])).toEqual({ abertas: [VIDEO], vista: null, aoLado: null, navegador: "aberto" })
    expect(fecharAbas(a, [VIDEO])).toEqual({ abertas: [ARQ, FRAME], vista: ARQ, aoLado: FRAME, navegador: "aberto" })
  })

  it("'as outras' e 'as da direita' escolhem pela posição na tira", () => {
    const abertas = [VIDEO, ARQ, FRAME, RUNNER]
    expect(outrasAlemDe(abertas, ARQ)).toEqual([VIDEO, FRAME, RUNNER])
    expect(aDireitaDe(abertas, ARQ)).toEqual([FRAME, RUNNER])
    expect(aDireitaDe(abertas, RUNNER)).toEqual([])
  })

  it("arrastar reordena, e índice fora da tira não mexe em nada", () => {
    const a = { ...SEM_ABAS, abertas: [VIDEO, ARQ, FRAME] }
    expect(moverAba(a, 0, 2).abertas).toEqual([ARQ, FRAME, VIDEO])
    expect(moverAba(a, 2, 0).abertas).toEqual([FRAME, VIDEO, ARQ])
    expect(moverAba(a, 0, 9)).toBe(a)
  })

  it("a pilha do ⌘⇧T não repete e tem teto", () => {
    expect(lembrarFechadas([ARQ, VIDEO], [ARQ])).toEqual([VIDEO, ARQ])
    const muitas = Array.from({ length: MEMORIA_DE_FECHADAS + 5 }, (_, i) => `f${i}.md`)
    const pilha = lembrarFechadas([], muitas)
    expect(pilha).toHaveLength(MEMORIA_DE_FECHADAS)
    expect(pilha.at(-1)).toBe(muitas.at(-1))
  })

  it("nome repetido ganha a pasta de cima, e sobe até diferenciar", () => {
    const r = rotulosDasAbas([
      "app/src/components/chat/AGENTS.md",
      "app/src-tauri/src/AGENTS.md",
      ARQ,
    ])
    expect(r.get("app/src/components/chat/AGENTS.md")).toEqual({ nome: "AGENTS.md", pasta: "chat" })
    expect(r.get("app/src-tauri/src/AGENTS.md")).toEqual({ nome: "AGENTS.md", pasta: "src" })
    expect(r.get(ARQ)).toEqual({ nome: "architecture.md", pasta: null })

    const fundo = rotulosDasAbas(["a/x/README.md", "b/x/README.md", "README.md"])
    expect(fundo.get("a/x/README.md")?.pasta).toBe("a/x")
    expect(fundo.get("b/x/README.md")?.pasta).toBe("b/x")
    expect(fundo.get("README.md")?.pasta).toBe("raiz")
  })

  it("⌃Tab anda na ordem da tira e dá a volta pela Conversa", () => {
    const abertas = [VIDEO, ARQ]
    expect(abaVizinha(abertas, null, 1)).toBe(VIDEO)
    expect(abaVizinha(abertas, ARQ, 1)).toBeNull()
    expect(abaVizinha(abertas, null, -1)).toBe(ARQ)
    expect(abaVizinha([], null, 1)).toBeNull()
  })
})

describe("conversa sem nada além dela", () => {
  it("não precisa ser guardada; qualquer aba, lado ou Navegador precisa", () => {
    expect(semNada(SEM_ABAS)).toBe(true)
    expect(semNada({ ...SEM_ABAS, navegador: "aberto" })).toBe(false)
    expect(semNada({ ...SEM_ABAS, abertas: [ARQ] })).toBe(false)
  })
})

describe("as alterações de um arquivo são outra aba (ADR-248)", () => {
  it("a chave do diff volta ao caminho, e o caminho comum é arquivo", () => {
    expect(lerChave(chaveDoDiff(ARQ))).toEqual({ tipo: "diff", caminho: ARQ })
    expect(lerChave(ARQ)).toEqual({ tipo: "arquivo", caminho: ARQ })
    expect(chaveDoDiff(ARQ)).not.toBe(ARQ)
  })

  it("o mesmo arquivo aberto para ler e nas alterações não é nome repetido", () => {
    const r = rotulosDasAbas([ARQ, chaveDoDiff(ARQ)])
    expect(r.get(ARQ)).toEqual({ nome: "architecture.md", pasta: null })
    expect(r.get(chaveDoDiff(ARQ))).toEqual({ nome: "architecture.md", pasta: null })
  })
})
