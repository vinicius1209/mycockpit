// Testes do resumo de pedidos de permissão (lib/approvalSummary): a linha única
// que substitui o input cru no card, e o corte que impede um heredoc de 40
// linhas de esticar o card pela janela inteira.

import { describe, expect, it } from "vitest"
import type { ApprovalData } from "@/lib/interaction"
import { PREVIEW_LINES, summarizeApproval } from "./approvalSummary"

function bash(command: string): ApprovalData {
  return { tool_name: "Bash", command, input: { command } }
}

describe("summarizeApproval — comandos de shell", () => {
  it("binário + subcomando viram a ação; o path vira o alvo", () => {
    const s = summarizeApproval(
      bash("deno run --allow-env supabase/functions/_shared/__tests__/v2-compat.smoke.ts"),
    )
    expect(s.action).toBe("deno run")
    expect(s.target).toBe("v2-compat.smoke.ts")
    expect(s.headline).toBe("deno run · v2-compat.smoke.ts")
  })

  it("sem subcomando conhecido a ação é só o binário", () => {
    expect(summarizeApproval(bash("ls -la")).action).toBe("ls")
    expect(summarizeApproval(bash("rm -rf build/")).action).toBe("rm")
  })

  it("ignora atribuições de env no início (elas não são a ação)", () => {
    const s = summarizeApproval(bash("NODE_ENV=test CI=1 bun test src/foo.test.ts"))
    expect(s.action).toBe("bun test")
    expect(s.target).toBe("foo.test.ts")
  })

  it("usa o basename do path, não o caminho inteiro", () => {
    expect(summarizeApproval(bash("cat a/b/c/muito/fundo/arquivo.json")).target).toBe(
      "arquivo.json",
    )
  })

  it("flag não vira alvo", () => {
    expect(summarizeApproval(bash("git push --force-with-lease")).target).toBeNull()
    expect(summarizeApproval(bash("git push --force-with-lease")).action).toBe(
      "git push",
    )
  })

  it("para no pipe: o que vem depois é OUTRO programa, não o alvo", () => {
    // regressão do caso real (screenshot): o `,$p'` do sed virava o "arquivo".
    const s = summarizeApproval(
      bash(
        "deno run --allow-env supabase/functions/_shared/__tests__/v2-compat.smoke.ts 2>&1 | sed -n '/^11\\./,$p'",
      ),
    )
    expect(s.action).toBe("deno run")
    expect(s.target).toBe("v2-compat.smoke.ts")
  })

  it("para em && / ; / redirect (mesma regra do pipe)", () => {
    expect(summarizeApproval(bash("bun test a/x.test.ts && rm -rf b/y.json")).target).toBe(
      "x.test.ts",
    )
    expect(summarizeApproval(bash("cat src/a.ts > /tmp/saida.log")).target).toBe("a.ts")
  })

  it("pega o PRIMEIRO path (o assunto), não o último", () => {
    expect(summarizeApproval(bash("cp src/origem.ts dist/destino.ts")).target).toBe(
      "origem.ts",
    )
  })

  it("heredoc sem path: diz que há script embutido em vez de calar", () => {
    const s = summarizeApproval(bash("python3 - <<'PY'\nprint(1)\nPY"))
    expect(s.target).toBe("script inline")
  })

  it("a ação sai da PRIMEIRA linha — o corpo do heredoc não polui", () => {
    const s = summarizeApproval(
      bash("deno run supabase/x.ts <<'PY'\nrm -rf /\nPY"),
    )
    expect(s.action).toBe("deno run")
    expect(s.target).toBe("x.ts")
  })

  it("comando vazio não quebra o card", () => {
    const s = summarizeApproval({ tool_name: "Bash", command: "   ", input: {} })
    expect(s.headline).toBeTruthy()
  })
})

describe("summarizeApproval — tools de arquivo", () => {
  it("Edit/Write ganham verbo próprio e o arquivo como alvo", () => {
    const s = summarizeApproval({
      tool_name: "Edit",
      command: "",
      input: { file_path: "/Users/x/projetos/app/src/store/chat.ts" },
    })
    expect(s.action).toBe("Editar arquivo")
    expect(s.target).toBe("chat.ts")
  })

  it("tool desconhecida cai num rótulo honesto", () => {
    const s = summarizeApproval({ tool_name: "MinhaTool", command: "", input: {} })
    expect(s.action).toBe("Usar MinhaTool")
  })

  it("sem comando, o detalhe é o input serializado", () => {
    const s = summarizeApproval({
      tool_name: "Write",
      command: "",
      input: { file_path: "a.ts", content: "x" },
    })
    expect(s.detail).toContain("file_path")
  })

  it("input cíclico não lança (o card precisa renderizar mesmo assim)", () => {
    const ciclico: Record<string, unknown> = {}
    ciclico.self = ciclico
    expect(() =>
      summarizeApproval({ tool_name: "T", command: "", input: ciclico }),
    ).not.toThrow()
  })
})

describe("summarizeApproval — corte do preview", () => {
  it("conteúdo curto não é truncado e o preview é o detalhe", () => {
    const s = summarizeApproval(bash("ls"))
    expect(s.truncated).toBe(false)
    expect(s.preview).toBe(s.detail)
    expect(s.lines).toBe(1)
  })

  it("acima de PREVIEW_LINES corta o preview mas preserva o detalhe inteiro", () => {
    const corpo = Array.from({ length: 40 }, (_, i) => `linha ${i}`).join("\n")
    const s = summarizeApproval(bash(`python3 - <<'PY'\n${corpo}\nPY`))
    expect(s.truncated).toBe(true)
    expect(s.lines).toBe(42)
    expect(s.preview.split("\n")).toHaveLength(PREVIEW_LINES)
    // o "ver tudo" precisa ter o que mostrar: nada se perde no corte.
    expect(s.detail.split("\n")).toHaveLength(42)
    expect(s.detail).toContain("linha 39")
  })

  it("exatamente PREVIEW_LINES não trunca (limite fechado em cima)", () => {
    const corpo = Array.from({ length: PREVIEW_LINES }, (_, i) => `l${i}`).join("\n")
    const s = summarizeApproval({ tool_name: "Bash", command: corpo, input: {} })
    expect(s.truncated).toBe(false)
  })
})
