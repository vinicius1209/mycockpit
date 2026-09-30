import { describe, expect, it } from "vitest"
import { desvioAcimaDaCauda } from "@/components/chat/medidaDoFio"

const source = Object.values(
  import.meta.glob("./useChatScroll.ts", { query: "?raw", import: "default", eager: true }),
)[0] as string

describe("âncora da cauda", () => {
  // O vídeo de 30/09/2026 (quadros 8 → 9, 76,17s): no fim do turno a janela
  // de 150 nós deslizou, uma resposta antiga entrou pelo topo, e a tela
  // mostrou de repente o que estava duas respostas acima; a mola levou ~1s
  // para voltar. O topo do último grupo andou sem a cauda ter crescido.
  it("nó que entra acima da cauda vira desvio a compensar", () => {
    expect(desvioAcimaDaCauda({ chave: "you#a", topo: 48_200 }, { chave: "you#a", topo: 49_680 })).toBe(1480)
  })

  it("nó que sai pelo topo também: a tela não salta para a frente", () => {
    expect(desvioAcimaDaCauda({ chave: "you#a", topo: 48_200 }, { chave: "you#a", topo: 47_400 })).toBe(-800)
  })

  it("grupo novo na cauda não é desvio: é conteúdo nascendo embaixo", () => {
    expect(desvioAcimaDaCauda({ chave: "you#a", topo: 48_200 }, { chave: "executor#b", topo: 48_900 })).toBe(0)
  })

  it("meio pixel de arredondamento não mexe na tela", () => {
    expect(desvioAcimaDaCauda({ chave: "you#a", topo: 48_200 }, { chave: "you#a", topo: 48_200.6 })).toBe(0)
  })

  it("sem medida anterior (conversa recém-aberta) não há o que compensar", () => {
    expect(desvioAcimaDaCauda(null, { chave: "you#a", topo: 48_200 })).toBe(0)
    expect(desvioAcimaDaCauda({ chave: "you#a", topo: 48_200 }, null)).toBe(0)
  })

  it("o hook ancora ANTES de ajustar a pista e antes de a mola andar, nos dois caminhos", () => {
    const ordem = /ancorarCauda\(\)\s+ajustarPista\(\)\s+if \(seguindoRef\.current\)/g
    expect(source.match(ordem)?.length).toBe(2)
  })
})
