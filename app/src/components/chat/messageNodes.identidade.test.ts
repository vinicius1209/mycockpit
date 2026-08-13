// Identidade dos nós de render entre dois frames do streaming.
//
// O que isto protege: `MessageItem` e `ToolLine` são `memo`, e `memo` compara
// props por REFERÊNCIA. `buildNodes` é puro e reconstrói tudo, então um único
// `text_delta` (que muda UMA bolha) devolvia 394 nós inéditos e a árvore inteira
// re-renderizava a cada token — os dois `memo` estavam escritos e inertes.
// `reuseNodes` devolve o objeto do frame anterior quando o nó diz a mesma coisa.
//
// Estes casos são o contrato do memo escrito como teste: se um deles cair, os
// `memo` voltaram a ser decoração e ninguém percebe olhando a tela.
import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import { buildNodes, reuseNodes } from "./messageNodes"

function fio(textoFinal: string): ChatItem[] {
  return [
    { kind: "user", id: "u1", text: "faça" } as ChatItem,
    { kind: "text", id: "t1", text: "Vou começar pelo " } as ChatItem,
    { kind: "tool", id: "i1", name: "Read", input: { file_path: "/a" }, toolId: "c1" } as ChatItem,
    { kind: "tool", id: "i2", name: "Bash", input: { command: "ls" }, toolId: "c2" } as ChatItem,
    { kind: "user", id: "u2", text: "continue" } as ChatItem,
    { kind: "text", id: "t2", text: textoFinal } as ChatItem,
  ]
}

/** O reducer de text_delta: array novo, item alvo novo, o resto por referência. */
function delta(items: ChatItem[], id: string, texto: string): ChatItem[] {
  return items.map((it) =>
    it.id === id && it.kind === "text" ? { ...it, text: it.text + texto } : it,
  )
}

describe("reuseNodes — a identidade só muda quando o conteúdo muda", () => {
  it("um token na bolha viva não renova NENHUM nó assentado", () => {
    const base = fio("resp")
    const antes = buildNodes(base)
    const depois = reuseNodes(antes, buildNodes(delta(base, "t2", "o")))
    const vivo = depois.at(-1)!
    const assentados = depois.slice(0, -1)
    expect(assentados.length).toBeGreaterThan(0)
    assentados.forEach((no, i) => expect(no).toBe(antes[i]))
    expect(vivo).not.toBe(antes.at(-1))
  })

  it("o nó que MUDA de fato ganha identidade nova (não congela a tela)", () => {
    const base = fio("resp")
    const antes = buildNodes(base)
    const depois = reuseNodes(antes, buildNodes(delta(base, "t2", " o")))
    const vivo = depois.at(-1)!
    expect(vivo).not.toBe(antes.at(-1))
    expect(vivo.type === "prose" && vivo.text).toBe("resp o")
  })

  it("a bolha viva que cresceu reaproveita o ARRAY de tools do turno", () => {
    // é este array que alimenta o useMemo(buildToolForest) do ToolGroup: se ele
    // renasce por token, todo o galho de ferramentas re-renderiza junto.
    const base = fio("resp")
    const antes = buildNodes(base)
    const prosaAntes = antes.find((n) => n.type === "prose" && n.tools.length > 0)!
    const depois = reuseNodes(antes, buildNodes(delta(base, "t1", "X")))
    const prosaDepois = depois.find((n) => n.key === prosaAntes.key)!
    expect(prosaDepois).not.toBe(prosaAntes) // o texto mudou
    expect(prosaDepois.type).toBe("prose")
    if (prosaDepois.type === "prose" && prosaAntes.type === "prose")
      expect(prosaDepois.tools).toBe(prosaAntes.tools)
  })

  it("tool que ganhou resultado renova o nó dela (a evidência não pode ficar velha)", () => {
    const base = fio("resp")
    const antes = buildNodes(base)
    const comResultado = base.map((it) =>
      it.id === "i2" ? ({ ...it, result: { ok: true } } as ChatItem) : it,
    )
    const depois = reuseNodes(antes, buildNodes(comResultado))
    const tocado = depois.find(
      (n) => (n.type === "prose" || n.type === "tools") && n.tools.some((t) => t.id === "i2"),
    )!
    const original = antes.find((n) => n.key === tocado.key)!
    expect(tocado).not.toBe(original)
  })

  it("item do usuário intocado mantém a MESMA referência de nó", () => {
    const base = fio("resp")
    const antes = buildNodes(base)
    const depois = reuseNodes(antes, buildNodes(delta(base, "t2", "!")))
    const u1Antes = antes.find((n) => n.key === "u1")!
    const u1Depois = depois.find((n) => n.key === "u1")!
    expect(u1Depois).toBe(u1Antes)
  })

  it("sem frame anterior devolve a lista nova inteira (primeiro render)", () => {
    const novos = buildNodes(fio("resp"))
    expect(reuseNodes([], novos)).toBe(novos)
  })
})
