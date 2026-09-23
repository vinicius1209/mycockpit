// A classificação de cada ação do fio é feita UMA vez por item (medido em
// 23/09/2026: reclassificar a cada token custava ~8 ms na maior conversa real).
import { describe, expect, it } from "vitest"
import fixture from "@/lib/__fixtures__/historico-de-pedidos-1200a161.json"
import type { ChatItem } from "@/store/chat"
import { classificarAcao } from "./acaoDoFio"

type Acao = Extract<ChatItem, { kind: "tool" }>
const ACOES = (fixture as unknown as ChatItem[]).filter((i): i is Acao => i.kind === "tool")

describe("classificação da ação do fio", () => {
  it("a mesma ação devolve o mesmo resultado, sem reclassificar", () => {
    const commit = ACOES.find((a) => JSON.stringify(a.input).includes("git commit"))!
    const primeira = classificarAcao(commit)
    expect(classificarAcao(commit)).toBe(primeira)
    expect(primeira).toMatchObject({ muda: true })
    expect(primeira.commitsNoComando).toBeGreaterThan(0)
  })

  it("escrita de arquivo traz o caminho; leitura não muda nada", () => {
    const escrita = ACOES.find((a) => a.name === "Write")!
    expect(classificarAcao(escrita).caminho).toMatch(/historico\.ts$/)
    const leitura = { kind: "tool", id: "r", name: "Read", input: { file_path: "a.ts" } } as Acao
    expect(classificarAcao(leitura)).toMatchObject({ muda: false, caminho: null, commitsNoComando: 0 })
  })
})
