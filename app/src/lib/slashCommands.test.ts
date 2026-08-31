// Expansão honesta dos comandos "/" por fonte×motor: claude+claude passa cru
// (o CLI interpreta), todo o resto expande app-side — em conversa codex o
// /nome literal era texto que o motor ignorava (o popover mentia).

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  commandBadges,
  expandPendingForTarget,
  expandQueuedForJoin,
  expandSlashCommand,
  expandSlashCommandWithSources,
  parseSlashInvocation,
  reexpandIfEmbedded,
  slashEmptyHint,
  stripFrontmatter,
} from "./slashCommands"
import type { SlashCommand } from "@/lib/sources"
import { readProjectCommands } from "@/lib/sources"

vi.mock("@/lib/sources", () => ({
  readProjectCommands: vi.fn(async () => []),
}))

function cmd(over: Partial<SlashCommand> = {}): SlashCommand {
  return {
    name: "deploy",
    description: null,
    kind: "command",
    origin: "project",
    source: "mycockpit",
    body: "---\ndescription: deploy\n---\n\nFaça o deploy de $ARGUMENTS com cuidado.",
    ...over,
  }
}

describe("parseSlashInvocation", () => {
  it("reconhece /nome sozinho e /nome com args (inclusive multilinha)", () => {
    expect(parseSlashInvocation("/deploy")).toEqual({ name: "deploy", args: "" })
    expect(parseSlashInvocation("/deploy prod agora")).toEqual({
      name: "deploy",
      args: "prod agora",
    })
    expect(parseSlashInvocation("/deploy prod\ncom rollback")).toEqual({
      name: "deploy",
      args: "prod\ncom rollback",
    })
    expect(parseSlashInvocation("/acme.quality:review diff")).toEqual({
      name: "acme.quality:review",
      args: "diff",
    })
  })

  it("não reconhece texto comum nem barra no meio", () => {
    expect(parseSlashInvocation("deploy /prod")).toBeNull()
    expect(parseSlashInvocation("rode a/b")).toBeNull()
    expect(parseSlashInvocation("")).toBeNull()
  })
})

describe("stripFrontmatter", () => {
  it("remove o bloco YAML inicial e preserva o corpo", () => {
    expect(stripFrontmatter("---\ndescription: x\n---\n\ncorpo")).toBe("corpo")
  })

  it("sem frontmatter, devolve o texto intacto", () => {
    expect(stripFrontmatter("corpo direto")).toBe("corpo direto")
  })
})

describe("expandSlashCommand — fonte×motor", () => {
  it("conversa claude + comando de fonte claude passa CRU (o CLI interpreta)", () => {
    const commands = [cmd({ source: "claude", body: "revise o diff" })]
    expect(expandSlashCommand("/deploy prod", commands, "claude-code")).toBe(
      "/deploy prod",
    )
  })

  it("conversa codex expande o comando (corpo no lugar do /nome)", () => {
    const commands = [cmd({ source: "mycockpit" })]
    expect(expandSlashCommand("/deploy prod", commands, "codex")).toBe(
      "Faça o deploy de prod com cuidado.",
    )
  })

  it("comando da CASA expande até em conversa claude (a casa é do app, não do CLI)", () => {
    const commands = [cmd({ source: "mycockpit" })]
    expect(expandSlashCommand("/deploy prod", commands, "claude-code")).toBe(
      "Faça o deploy de prod com cuidado.",
    )
  })

  it("substitui TODAS as ocorrências de $ARGUMENTS", () => {
    const commands = [cmd({ body: "eco $ARGUMENTS e de novo $ARGUMENTS" })]
    expect(expandSlashCommand("/deploy x", commands, "codex")).toBe(
      "eco x e de novo x",
    )
  })

  it("sem $ARGUMENTS no corpo, os args vão anexados ao fim (convenção do Claude)", () => {
    const commands = [cmd({ body: "corpo fixo" })]
    expect(expandSlashCommand("/deploy prod agora", commands, "codex")).toBe(
      "corpo fixo\n\nprod agora",
    )
    expect(expandSlashCommand("/deploy", commands, "codex")).toBe("corpo fixo")
  })

  it("remove o frontmatter YAML do corpo expandido", () => {
    const commands = [cmd()]
    const out = expandSlashCommand("/deploy prod", commands, "agy")
    expect(out).not.toContain("---")
    expect(out).not.toContain("description:")
  })

  it("sem match, o texto segue intacto (fail-open)", () => {
    expect(expandSlashCommand("/inexistente args", [cmd()], "codex")).toBe(
      "/inexistente args",
    )
    expect(expandSlashCommand("texto normal", [cmd()], "codex")).toBe(
      "texto normal",
    )
  })

  it("corpo ilegível (body null) segue como texto, não expande pra vazio", () => {
    const commands = [cmd({ body: null })]
    expect(expandSlashCommand("/deploy prod", commands, "codex")).toBe(
      "/deploy prod",
    )
  })

  it("skill de plugin expande em qualquer motor e carrega claim do fingerprint", () => {
    const command = cmd({
      name: "acme.quality:review",
      source: "plugin",
      kind: "skill",
      origin: "global",
      body: "Revise $ARGUMENTS",
      pluginKey: "acme.quality",
      pluginName: "Quality",
      pluginFingerprint: "hash-atual",
      contributionId: "review",
    })
    expect(
      expandSlashCommandWithSources(
        "/acme.quality:review src",
        [command],
        "claude-code",
      ),
    ).toEqual({
      text: "Revise src",
      instructionSources: [
        {
          kind: "plugin-skill",
          pluginKey: "acme.quality",
          fingerprint: "hash-atual",
          contributionId: "review",
          invocation: "acme.quality:review",
        },
      ],
    })
  })
})

describe("expandSlashCommand — embedded (G2.2/G2.3): texto embutido nunca viaja cru", () => {
  it("até o comando NATIVO expande quando o texto vai embutido num prompt maior", () => {
    const commands = [cmd({ source: "claude", body: "revise o diff de $ARGUMENTS" })]
    expect(
      expandSlashCommand("/deploy prod", commands, "claude-code", {
        embedded: true,
      }),
    ).toBe("revise o diff de prod")
  })

  it("sem match, embedded segue fail-open (texto intacto)", () => {
    expect(
      expandSlashCommand("/nada aqui", [cmd()], "claude-code", { embedded: true }),
    ).toBe("/nada aqui")
  })
})

describe("expandQueuedForJoin — fila coalescida (G2.2)", () => {
  const commands = [cmd({ source: "mycockpit" })]

  it("expande o /comando no MEIO da fila antes do join (era barra morta)", () => {
    const out = expandQueuedForJoin(
      ["arruma o lint", "/deploy prod", "e roda os testes"],
      commands,
      "codex",
    )
    expect(out).toEqual([
      "arruma o lint",
      "Faça o deploy de prod com cuidado.",
      "e roda os testes",
    ])
    expect(out.join("\n\n")).not.toContain("/deploy")
  })

  it("na fila com 2+ itens, até comando nativo em conversa claude expande (vai embutido no join)", () => {
    const nativos = [cmd({ source: "claude", body: "revise $ARGUMENTS" })]
    const out = expandQueuedForJoin(
      ["/deploy prod", "depois me avisa"],
      nativos,
      "claude-code",
    )
    expect(out[0]).toBe("revise prod")
  })

  it("com UM item só, devolve intacto (o caminho normal de envio expande)", () => {
    expect(expandQueuedForJoin(["/deploy prod"], commands, "codex")).toEqual([
      "/deploy prod",
    ])
    expect(expandQueuedForJoin([], commands, "codex")).toEqual([])
  })

  it("item sem match segue como texto (fail-open por item)", () => {
    const out = expandQueuedForJoin(
      ["/fantasma x", "/deploy prod"],
      commands,
      "codex",
    )
    expect(out).toEqual(["/fantasma x", "Faça o deploy de prod com cuidado."])
  })
})

describe("reexpandIfEmbedded — comando nativo × blocos prependidos (review gate G2)", () => {
  beforeEach(() => {
    vi.mocked(readProjectCommands).mockReset()
  })

  it("cenário do furo (ChatPanel/mesa): bloco vai prepender e o /comando nativo sobreviveu CRU → re-expande com o corpo", async () => {
    vi.mocked(readProjectCommands).mockResolvedValue([
      cmd({ name: "review", source: "claude", body: "Revise o diff." }),
    ])
    const out = await reexpandIfEmbedded(
      "/review", // a expansão normal devolveu cru (nativo)
      "/review",
      "/repo",
      "claude-code",
      true, // doutrina/lições/persona vão prepender
    )
    expect(out).toBe("Revise o diff.")
  })

  it("sem bloco a prepender, o cru nativo segue (o prompt inteiro é a invocação)", async () => {
    const out = await reexpandIfEmbedded(
      "/review",
      "/review",
      "/repo",
      "claude-code",
      false,
    )
    expect(out).toBe("/review")
    expect(vi.mocked(readProjectCommands)).not.toHaveBeenCalled()
  })

  it("pedido já expandido não relê o disco (re-expansão é no-op)", async () => {
    const out = await reexpandIfEmbedded(
      "corpo já expandido",
      "/review",
      "/repo",
      "codex",
      true,
    )
    expect(out).toBe("corpo já expandido")
    expect(vi.mocked(readProjectCommands)).not.toHaveBeenCalled()
  })

  it("sem match no inventário segue fail-open (texto intacto)", async () => {
    vi.mocked(readProjectCommands).mockResolvedValue([])
    const out = await reexpandIfEmbedded(
      "/fantasma",
      "/fantasma",
      "/repo",
      "claude-code",
      true,
    )
    expect(out).toBe("/fantasma")
  })
})

describe("expandPendingForTarget — pendente do revezamento (G2.3)", () => {
  beforeEach(() => {
    vi.mocked(readProjectCommands).mockReset()
  })

  it("expande pro inventário do motor de DESTINO (sempre app-side: vai no preâmbulo)", async () => {
    vi.mocked(readProjectCommands).mockResolvedValue([
      cmd({ source: "claude", body: "revise o diff de $ARGUMENTS" }),
    ])
    const out = await expandPendingForTarget("/deploy prod", "/repo", "claude-code")
    // mesmo com native_slash no destino, embutido no handoff = corpo expandido.
    expect(out.text).toBe("revise o diff de prod")
    expect(out.note).toBeNull()
    expect(vi.mocked(readProjectCommands)).toHaveBeenCalledWith(
      "/repo",
      "claude-code",
    )
  })

  it("comando fora do inventário do destino → texto + nota honesta", async () => {
    vi.mocked(readProjectCommands).mockResolvedValue([])
    const out = await expandPendingForTarget("/deploy prod", "/repo", "codex")
    expect(out.text).toBe("/deploy prod")
    expect(out.note).toContain('"/deploy" não existe no inventário do Codex')
  })

  it("corpo ilegível → texto + nota honesta (nunca expande pra vazio)", async () => {
    vi.mocked(readProjectCommands).mockResolvedValue([cmd({ body: null })])
    const out = await expandPendingForTarget("/deploy prod", "/repo", "codex")
    expect(out.text).toBe("/deploy prod")
    expect(out.note).toContain("ilegível")
  })

  it("texto que não é invocação passa direto, sem tocar no disco", async () => {
    const out = await expandPendingForTarget("conserta o build", "/repo", "codex")
    expect(out).toEqual({
      text: "conserta o build",
      note: null,
      instructionSources: [],
    })
    expect(vi.mocked(readProjectCommands)).not.toHaveBeenCalled()
  })

  it("inventário indisponível → texto SEM nota (não afirma ausência sem evidência)", async () => {
    vi.mocked(readProjectCommands).mockRejectedValue(new Error("sem disco"))
    const out = await expandPendingForTarget("/deploy prod", "/repo", "codex")
    expect(out).toEqual({
      text: "/deploy prod",
      note: null,
      instructionSources: [],
    })
  })
})

describe("slashEmptyHint — empty-state por agent da conversa", () => {
  it("sempre menciona a casa (.mycockpit/commands)", () => {
    for (const agent of ["claude-code", "codex", "agy", "opencode"]) {
      expect(slashEmptyHint(agent)).toContain(".mycockpit/commands")
    }
  })

  it("claude-code soma a convenção nativa (.claude/commands e skills)", () => {
    const hint = slashEmptyHint("claude-code")
    expect(hint).toContain(".claude/commands")
    expect(hint).toContain(".claude/skills")
  })

  it("codex soma ~/.codex/prompts e NÃO menciona .claude", () => {
    const hint = slashEmptyHint("codex")
    expect(hint).toContain("~/.codex/prompts")
    expect(hint).not.toContain(".claude")
  })

  it("agy só menciona a casa (o motor não tem convenção nativa)", () => {
    const hint = slashEmptyHint("agy")
    expect(hint).not.toContain(".claude")
    expect(hint).not.toContain(".codex")
  })
})

describe("commandBadges — chips de origem no popover", () => {
  it("fonte sempre; global e skill só quando valem", () => {
    expect(commandBadges(cmd())).toEqual(["mycockpit"])
    expect(commandBadges(cmd({ origin: "global" }))).toEqual([
      "mycockpit",
      "global",
    ])
    expect(
      commandBadges(cmd({ source: "claude", kind: "skill", origin: "global" })),
    ).toEqual(["claude", "global", "skill"])
    expect(commandBadges(cmd({ source: "codex", origin: "global" }))).toEqual([
      "codex",
      "global",
    ])
  })
})
