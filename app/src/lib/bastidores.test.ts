// Bastidores (ADR-200): a lista vem dos itens do fio e diz de onde sai a saída.
// Valores dos itens tirados das capturas reais de 16/09/2026
// (testdata/claude-2.1.270/background-*.jsonl, codex-0.154.0/background-terminal-appserver.jsonl).

import { describe, expect, it } from "vitest"
import {
  LINHAS_MAX,
  SAIDA_VAZIA,
  TERMINADOS_NO_INDICE,
  bastidoresDaConversa,
  limparLinha,
  passosDoSubagente,
  somarLinhas,
  somarTexto,
} from "./bastidores"
import type { ChatItem } from "@/store/chat"

const T0 = 1_789_578_857_000
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

function diferido(deferred: Record<string, unknown>): ChatItem {
  return {
    kind: "tool",
    id: `deferred-${deferred.id}`,
    name: "DeferredWork",
    input: {},
    toolId: `deferred:${deferred.id}`,
    ts: T0,
    deferred: {
      toolUseId: null,
      kind: null,
      name: null,
      status: "running",
      summary: null,
      outputFile: null,
      tokens: null,
      startedAt: T0,
      updatedAt: T0,
      ...deferred,
    },
  } as ChatItem
}

const SHELL_CAMPOS = {
  id: "btirvhvcs",
  toolUseId: "toolu_01RFbjqTZ3qCvvjFW6bCiqZs",
  kind: "local_bash",
  name: "for i in 1 2 3 4; do echo passo $i; sleep 3; done; echo fim",
  outputFile:
    "/private/tmp/claude-501/-private-tmp-frota-b0/0fe40184-c6d2-4b25-8c52-2f56e898360b/tasks/btirvhvcs.output",
}
const SHELL = diferido(SHELL_CAMPOS)
const LANCADOR_DO_SHELL = {
  kind: "tool",
  id: "t-shell",
  name: "Bash",
  input: { command: SHELL_CAMPOS.name, run_in_background: true },
  toolId: "toolu_01RFbjqTZ3qCvvjFW6bCiqZs",
  ts: T0,
  result: { ok: true, text: "Command running in background with ID: btirvhvcs.", lines: 1 },
} as ChatItem
const SUBAGENTE = diferido({
  id: "a25537ec2c0bf1ccd",
  toolUseId: "toolu_01CuGcv88simK1tMYCZDLaU1",
  kind: "local_agent",
  name: "Run bash command with loop and echo",
  tokens: 11187,
  startedAt: T0 + 5_000,
})
const PASSO_DO_SUBAGENTE = {
  kind: "tool",
  id: "t-sub-bash",
  name: "Bash",
  input: { command: "for i in 1 2 3; do echo sub $i; sleep 4; done" },
  toolId: "toolu_012BksbYGpgzQ6wnkgtwBdhj",
  parentToolId: "toolu_01CuGcv88simK1tMYCZDLaU1",
  ts: T0 + 6_000,
} as ChatItem
const COMANDO_CODEX = {
  kind: "tool",
  id: "t-codex",
  name: "Bash",
  input: { command: "for i in 1 2 3 4 5 6; do echo cx $i; sleep 2; done; echo fim" },
  toolId: "item-cmd-1",
  ts: T0 + 1_000,
} as ChatItem

describe("bastidoresDaConversa", () => {
  it("shell em segundo plano vira terminal com o arquivo de saída e sem duplicar o lançador", () => {
    const lista = bastidoresDaConversa(
      [LANCADOR_DO_SHELL, SHELL],
      new Set(["toolu_01RFbjqTZ3qCvvjFW6bCiqZs"]),
    )
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({
      // `local_bash` é o termo gravado antes do contrato: lido como terminal.
      tipo: "terminal",
      estado: "vivo",
      fonte: { tipo: "arquivo", caminho: SHELL_CAMPOS.outputFile },
    })
  })

  it("subagente vira item com passos pelo lançador e tokens do progresso", () => {
    const items = [SUBAGENTE, PASSO_DO_SUBAGENTE]
    const [b] = bastidoresDaConversa(items)
    expect(b).toMatchObject({
      tipo: "subagente",
      tokens: 11187,
      fonte: { tipo: "passos", paiId: "toolu_01CuGcv88simK1tMYCZDLaU1" },
    })
    expect(passosDoSubagente(items, "toolu_01CuGcv88simK1tMYCZDLaU1")).toEqual([
      {
        id: "t-sub-bash",
        nome: "Bash",
        alvo: "for i in 1 2 3; do echo sub $i; sleep 4; done",
        estado: "vivo",
      },
    ])
  })

  it("comando do turno não entra: nem demorando, nem com saída ao vivo", () => {
    // Decisão de 21/09/2026: duração não é segundo plano. Até aqui entrava todo
    // Bash acima de 3 s, e o índice virava a lista de comandos do turno.
    // Formato do item Bash gravado na conversa real de 16/09/2026.
    const bash = (id: string, durou: number | null, extra: Record<string, unknown> = {}) =>
      ({
        kind: "tool",
        id,
        name: "Bash",
        input: { command: "cd app && bun run test > /tmp/g-test.out 2>&1", description: "Run full suite" },
        toolId: `toolu_${id}`,
        ts: T0,
        ...(durou == null ? {} : { activityAt: T0 + durou, result: { ok: true, text: "Tests  4239 passed", lines: 1 } }),
        ...extra,
      }) as ChatItem
    const lista = bastidoresDaConversa(
      [bash("rapido", 240), bash("longo", 31_000), bash("vivo-velho", null, { ts: T0 - 10_000 }), COMANDO_CODEX],
      new Set(["item-cmd-1", "toolu_longo"]),
    )
    expect(lista).toEqual([])
  })

  it("terminal que cedeu o controle entra como qualquer diferido e lê a saída do stream do lançador", () => {
    // O que o adapter do Codex emite para o comando da captura
    // codex-0.154.0/background-terminal-appserver.jsonl: mesmo id do item.
    const terminal = diferido({
      id: "item-cmd-1",
      toolUseId: "item-cmd-1",
      kind: "terminal",
      name: "for i in 1 2 3 4 5 6; do echo cx $i; sleep 2; done; echo fim",
    })
    const lista = bastidoresDaConversa([COMANDO_CODEX, terminal], new Set(["item-cmd-1"]))
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({
      tipo: "terminal",
      estado: "vivo",
      comando: "for i in 1 2 3 4 5 6; do echo cx $i; sleep 2; done; echo fim",
      fonte: { tipo: "stream", toolId: "item-cmd-1" },
    })
    // Sem saída ainda, não finge log.
    expect(bastidoresDaConversa([COMANDO_CODEX, terminal])[0].fonte).toEqual({ tipo: "sem-saida" })
  })

  it("tipo que o contrato não conhece vira tarefa genérica, nunca um chute", () => {
    expect(bastidoresDaConversa([diferido({ id: "x", kind: "other" })])[0].tipo).toBe("tarefa")
    expect(bastidoresDaConversa([diferido({ id: "y", kind: "remote_thing" })])[0].tipo).toBe("tarefa")
    expect(bastidoresDaConversa([diferido({ id: "z", kind: null })])[0].tipo).toBe("tarefa")
  })

  it("tarefa em segundo plano traz o comando do lançador", () => {
    expect(bastidoresDaConversa([LANCADOR_DO_SHELL, SHELL])[0].comando).toBe(SHELL_CAMPOS.name)
  })

  it("interrompido pelo motor (killed vira interrupted no reducer) sai como interrompido", () => {
    const morto = diferido({ ...SHELL_CAMPOS, status: "interrupted" })
    expect(bastidoresDaConversa([morto])[0].estado).toBe("interrompido")
  })

  it("vivos primeiro, mais recente no topo; terminados com teto", () => {
    const terminados = Array.from({ length: TERMINADOS_NO_INDICE + 3 }, (_, i) =>
      diferido({ ...SHELL_CAMPOS, id: `fim-${i}`, status: "completed", updatedAt: T0 + i }),
    )
    const lista = bastidoresDaConversa([SHELL, SUBAGENTE, ...terminados])
    expect(lista.slice(0, 2).map((b) => b.tipo)).toEqual(["subagente", "terminal"])
    expect(lista).toHaveLength(2 + TERMINADOS_NO_INDICE)
  })

  it("trabalho sem saída ao vivo diz isso em vez de fingir log", () => {
    const semArquivo = diferido({ id: "wf", kind: "local_workflow", name: "Workflow" })
    expect(bastidoresDaConversa([semArquivo])[0].fonte).toEqual({ tipo: "sem-saida" })
  })

  it("terminado sem nada para abrir não entra no índice (Bash comum gravado como task até o #386)", () => {
    // Item como ficou gravado na conversa real de 16/09/2026.
    const comum = diferido({
      id: "blbkztkpq",
      toolUseId: "toolu_01NdNhLc73uxxwvsGEkVgPBW",
      kind: "local_bash",
      name: "Stop dev server and build test app",
      summary: "Stop dev server and build test app",
      status: "completed",
      outputFile: "",
    })
    const morto = diferido({ ...SHELL_CAMPOS, status: "interrupted" })
    const lista = bastidoresDaConversa([comum, morto])
    expect(lista.map((b) => b.itemId)).toEqual([`deferred-${SHELL_CAMPOS.id}`])
  })

  it("task-fantasma gravada até o #386 não entra, e o comando comum dela também não", () => {
    const fantasma = diferido({
      id: "blbkztkpq",
      toolUseId: "toolu_01NdNhLc73uxxwvsGEkVgPBW",
      kind: "local_bash",
      name: "Stop dev server and build test app",
      status: "completed",
      outputFile: "",
    })
    const comando = {
      kind: "tool",
      id: "t-build",
      name: "Bash",
      input: { command: "./scripts/build.sh test", description: "Stop dev server and build test app" },
      toolId: "toolu_01NdNhLc73uxxwvsGEkVgPBW",
      ts: T0,
      activityAt: T0 + 82_000,
      result: { ok: true, text: "teste #385 pronto", lines: 1 },
    } as ChatItem
    expect(bastidoresDaConversa([comando, fantasma])).toEqual([])
  })

  it("resumo igual ao nome não vira detalhe repetido", () => {
    const vivo = diferido({ id: "x", name: "Build longo", summary: "Build longo" })
    expect(bastidoresDaConversa([vivo])[0].detalhe).toBeNull()
  })
})

describe("saída ao vivo", () => {
  it("limpa ANSI, OSC e barra de progresso como o Rust", () => {
    expect(limparLinha(`${ESC}[32m✓ Build${ESC}[0m  1m12s`)).toBe("✓ Build  1m12s")
    expect(limparLinha("baixando 10%\rbaixando 100%")).toBe("baixando 100%")
    expect(limparLinha(`${ESC}]0;titulo${BEL}texto`)).toBe("texto")
  })

  it("delta que parte a linha espera o resto (deltas reais do Codex)", () => {
    let s = somarTexto(SAIDA_VAZIA, "cx 2\ncx")
    expect(s.linhas).toEqual(["cx 2"])
    expect(s.resto).toBe("cx")
    s = somarTexto(s, " 3\nfim\n")
    expect(s.linhas).toEqual(["cx 2", "cx 3", "fim"])
    expect(s.resto).toBe("")
  })

  it("teto de linhas descarta as mais antigas e conta", () => {
    const muitas = Array.from({ length: LINHAS_MAX + 25 }, (_, i) => `l${i}`)
    const s = somarLinhas(SAIDA_VAZIA, muitas)
    expect(s.linhas).toHaveLength(LINHAS_MAX)
    expect(s.linhas[0]).toBe("l25")
    expect(s.descartadas).toBe(25)
  })
})
