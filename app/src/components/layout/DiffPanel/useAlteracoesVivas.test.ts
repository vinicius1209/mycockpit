// A aba Alterações relê quando a pasta pode ter mudado, e só então (pedido de
// 23/09/2026: "parece congelada"). Itens REAIS da conversa 1200a161: comandos
// com `git commit`, a escrita do `historico.ts` e leituras.
import { describe, expect, it } from "vitest"
import fixture from "@/lib/__fixtures__/historico-de-pedidos-1200a161.json"
import type { ChatItem } from "@/store/chat"
import { assinaturaDasMudancas } from "./useAlteracoesVivas"

const ITENS = fixture as unknown as ChatItem[]
const PASTA = "/Users/viniciusmachado/projetos/frota"
const pastaDoProjeto = (id: string) => (id === "p1" ? PASTA : "/outro/projeto")

function conversa(items: readonly ChatItem[], running = false) {
  return { projectId: "p1", worktreePath: null, running, finalizing: false, items }
}

describe("quando a aba Alterações relê", () => {
  it("ação que muda arquivo terminando muda a assinatura; texto e leitura não", () => {
    const base = assinaturaDasMudancas({ c: conversa(ITENS) }, PASTA, pastaDoProjeto)
    const comTexto = assinaturaDasMudancas(
      { c: conversa([...ITENS, { kind: "text", id: "x", text: "streaming…" }]) },
      PASTA,
      pastaDoProjeto,
    )
    const comLeitura = assinaturaDasMudancas(
      { c: conversa([...ITENS, { kind: "tool", id: "r", name: "Read", input: { file_path: "a.ts" }, result: { ok: true, text: "", lines: 1 } }]) },
      PASTA,
      pastaDoProjeto,
    )
    expect(comTexto).toBe(base)
    expect(comLeitura).toBe(base)
    const commit = ITENS.find((i) => i.kind === "tool" && JSON.stringify(i.input).includes("git commit"))!
    const outroCommit = { ...commit, id: "novo-commit" } as ChatItem
    const comCommit = assinaturaDasMudancas({ c: conversa([...ITENS, outroCommit]) }, PASTA, pastaDoProjeto)
    expect(comCommit).not.toBe(base)
  })

  it("ação que ainda não terminou não conta: relê quando o resultado chega", () => {
    const escrita = { kind: "tool", id: "w", name: "Write", input: { file_path: "b.ts" } } as ChatItem
    const antes = assinaturaDasMudancas({ c: conversa([...ITENS, escrita]) }, PASTA, pastaDoProjeto)
    expect(antes).toBe(assinaturaDasMudancas({ c: conversa(ITENS) }, PASTA, pastaDoProjeto))
    const pronta = { ...escrita, result: { ok: true, text: "", lines: 1 } } as ChatItem
    expect(assinaturaDasMudancas({ c: conversa([...ITENS, pronta]) }, PASTA, pastaDoProjeto)).not.toBe(antes)
  })

  it("fim de turno de conversa desta pasta muda; de outra pasta, não", () => {
    const rodando = assinaturaDasMudancas({ c: conversa(ITENS, true) }, PASTA, pastaDoProjeto)
    const terminou = assinaturaDasMudancas({ c: conversa(ITENS, false) }, PASTA, pastaDoProjeto)
    expect(rodando).not.toBe(terminou)
    const outra = { projectId: "p2", worktreePath: null, running: true, finalizing: false, items: ITENS }
    expect(assinaturaDasMudancas({ c: conversa(ITENS), o: outra }, PASTA, pastaDoProjeto)).toBe(terminou)
  })

  it("conversa numa worktree conta para a worktree, não para o projeto", () => {
    const naWorktree = { ...conversa(ITENS, true), worktreePath: "/wt/feature" }
    expect(assinaturaDasMudancas({ c: naWorktree }, PASTA, pastaDoProjeto)).toBe("")
    expect(assinaturaDasMudancas({ c: naWorktree }, "/wt/feature", pastaDoProjeto)).not.toBe("")
  })
})
