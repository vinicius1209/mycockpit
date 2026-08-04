// Comandos BUILTIN do app (source "app"): primeira classe, definidos em
// código, visíveis no popover de TODA conversa (chip "app") e interceptados
// no send ANTES da expansão de .md — são AÇÃO, nunca texto pro modelo (em
// motor com nativeCompact o que viaja é o literal "/compact", lib/compact).

import { describe, expect, it } from "vitest"
import {
  APP_SLASH_COMMANDS,
  commandBadges,
  findAppCommand,
  splitQueueForAppCommand,
  withAppCommands,
} from "./slashCommands"
import type { SlashCommand } from "@/lib/sources"

function diskCmd(over: Partial<SlashCommand> = {}): SlashCommand {
  return {
    name: "deploy",
    description: null,
    kind: "command",
    origin: "project",
    source: "mycockpit",
    body: "Faça o deploy.",
    ...over,
  }
}

describe("findAppCommand — invocação de builtin", () => {
  it("reconhece /compactar sozinho e com args (args são ignorados pela ação)", () => {
    expect(findAppCommand("/compactar")?.name).toBe("compactar")
    expect(findAppCommand("  /compactar  ")?.name).toBe("compactar")
    expect(findAppCommand("/compactar agora")?.name).toBe("compactar")
  })

  it("não reconhece o /compact do CLI nem texto comum (só builtins registrados)", () => {
    // "/compact" é o comando NATIVO do claude — vira builtin só quando o app
    // decide mandar (planCompact), nunca por digitação direta.
    expect(findAppCommand("/compact")).toBeNull()
    expect(findAppCommand("compactar")).toBeNull()
    expect(findAppCommand("rode /compactar depois")).toBeNull()
  })

  it("o registro do /compactar tem a descrição do popover", () => {
    const cmd = APP_SLASH_COMMANDS.find((c) => c.name === "compactar")
    expect(cmd?.description).toBe(
      "Compacta o contexto da conversa; libera janela",
    )
  })
})

describe("withAppCommands — inventário do popover", () => {
  it("builtins entram na FRENTE, com source 'app' (o chip do popover)", () => {
    const out = withAppCommands([diskCmd()])
    expect(out[0]).toMatchObject({ name: "compactar", source: "app" })
    expect(commandBadges(out[0])).toEqual(["app"])
    expect(out.map((c) => c.name)).toEqual(["compactar", "deploy"])
  })

  it("um .md de mesmo nome fica SOMBREADO (a interceptação vence a expansão; listar os dois seria mentira)", () => {
    const out = withAppCommands([
      diskCmd({ name: "compactar", body: "corpo que nunca executa" }),
      diskCmd(),
    ])
    expect(out.filter((c) => c.name === "compactar")).toHaveLength(1)
    expect(out.find((c) => c.name === "compactar")?.source).toBe("app")
  })

  it("sem comandos de disco, os builtins seguem presentes (não dependem do disco)", () => {
    const out = withAppCommands([])
    expect(out.map((c) => c.name)).toEqual(["compactar"])
  })

  it("body null de propósito: se algum caminho expandir, o fail-open devolve o texto", () => {
    expect(withAppCommands([])[0].body).toBeNull()
  })
})

describe("splitQueueForAppCommand — fila com builtin no meio", () => {
  const msg = (text: string) => ({ text, attachments: [] })

  it("fila com /compactar no MEIO: o lote vai até o builtin e o resto volta pra fila (ordem preservada)", () => {
    const { batch, rest } = splitQueueForAppCommand([
      msg("arruma o lint"),
      msg("roda os testes"),
      msg("/compactar"),
      msg("segue a story"),
    ])
    expect(batch.map((m) => m.text)).toEqual([
      "arruma o lint",
      "roda os testes",
    ])
    expect(rest.map((m) => m.text)).toEqual(["/compactar", "segue a story"])
  })

  it("builtin na FRENTE sai sozinho no lote (a interceptação o pega no despacho)", () => {
    const { batch, rest } = splitQueueForAppCommand([
      msg("/compactar"),
      msg("continua"),
    ])
    expect(batch.map((m) => m.text)).toEqual(["/compactar"])
    expect(rest.map((m) => m.text)).toEqual(["continua"])
  })

  it("sem builtin, tudo é um lote só (comportamento de sempre)", () => {
    const fila = [msg("a"), msg("b")]
    expect(splitQueueForAppCommand(fila)).toEqual({ batch: fila, rest: [] })
  })

  it("fila de 0..1 item devolve intacta (o caminho normal de envio cuida)", () => {
    expect(splitQueueForAppCommand([])).toEqual({ batch: [], rest: [] })
    const um = [msg("/compactar")]
    expect(splitQueueForAppCommand(um)).toEqual({ batch: um, rest: [] })
  })
})
