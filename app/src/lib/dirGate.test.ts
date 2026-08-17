// A CADEIA DO INCIDENTE 2026-08-16, montada com o store REAL.
//
// O QUE ESTE ARQUIVO PROVA (e por que não basta "o banner sumiu")
// ---------------------------------------------------------------------------
// Conceder acesso a uma pasta bloqueada no meio de um turno fez o MESMO prompt
// rodar duas vezes por inteiro: itens `#24` e `#48` da conversa
// `ec1642c1-…`, texto byte a byte idêntico, ids diferentes, 20 chamadas de
// ferramenta cada, ~2,4M de tokens a mais. A cadeia tinha cinco elos, e o
// banner era só o primeiro:
//
//   banner sem guarda → allowBlockedDir → handleSend com turno vivo →
//   enqueue na fila do HUMANO → drenagem no `finally` → segundo turno.
//
// Um teste que só olha o banner deixa os elos 3, 4 e 5 de pé. Aqui a cadeia
// inteira roda: o resolvedor é o REAL (`allowBlockedDir`), o gate de turno em
// voo é o REAL (`lib/sendGate`), a fila é a REAL (`useChat`), e a drenagem
// repete o que o `finally` do `handleSend` faz. O único pedaço simulado é o
// spawn do agente, que vira uma linha na lista `turnos`.

import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  write: vi.fn(async () => {}),
  toast: vi.fn(),
  sucesso: vi.fn(),
  erro: vi.fn(),
}))

vi.mock("@/lib/mycockpit", async (orig) => ({
  ...(await orig<typeof import("@/lib/mycockpit")>()),
  writeMycockpitConfig: h.write,
}))

vi.mock("sonner", () => ({
  toast: Object.assign(h.toast, { success: h.sucesso, error: h.erro }),
}))

import { allowBlockedDir } from "./dirGate"
import { retidoPorTurnoEmVoo } from "./sendGate"
import { HUMANO, PASTA_LIBERADA, type OrigemDoEnvio } from "./sendOrigin"
import type { Project } from "./types"
import { useApp } from "@/store/app"
import { useChat, type ConvState } from "@/store/chat"

const CONV = "ec1642c1-5328-409e-afc8-58e79a3cdca1"
const PROJ = "p-mycockpit"

/** O projeto do incidente. */
const projeto: Project = {
  id: PROJ,
  name: "mycockpit",
  path: "/Users/viniciusmachado/projetos/mycockpit",
  createdAt: 1_755_000_000_000,
  permissionMode: "liberado",
}

/** A pasta que o `detectBlockedDir` extraiu e que o clique gravou de verdade no
 *  `.mycockpit/config.toml` (mtime 16 Ago 17:47). */
const PASTA = "/Users/viniciusmachado/.gemini/antigravity-cli"

/** O prompt do item `#24`, o mesmo que reapareceu como `#48`. */
const PROMPT = "ok, eu uso o plano AI pro da google, e então faça as melhorias"

function conversa(over: Partial<ConvState> = {}): ConvState {
  return {
    projectId: PROJ,
    agent: "agy",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [{ kind: "user", id: "0757e8f6", text: PROMPT, ts: 1_755_360_337_000 }],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
    blockedDir: PASTA,
    ...over,
  }
}

/** Os turnos que NASCERAM. Cada linha aqui é um `runAgent` de verdade lá fora:
 *  minutos de parede e tokens cobrados. */
const turnos: string[] = []

/** O miolo do `handleSend` que interessa a este defeito: o gate de turno em voo
 *  (o REAL) e, passando por ele, o despacho do turno. */
function despachar(texto: string, origem: OrigemDoEnvio) {
  if (retidoPorTurnoEmVoo(CONV, texto, [], origem)) return
  turnos.push(texto)
}

/** O `finally` do `handleSend`: o turno termina e a fila drena coalescida
 *  (`drainQueued`). É o elo 5 da cadeia, o que despachou o segundo turno. */
function terminarTurno() {
  const cur = useChat.getState().byId[CONV]
  useChat.setState({
    byId: { ...useChat.getState().byId, [CONV]: { ...cur, running: false, finalizing: false } },
  })
  const fila = useChat.getState().dequeueQueued(CONV)
  if (fila.length === 0) return
  despachar(fila.map((q) => q.text).join("\n\n"), HUMANO)
}

/** O clique em "Liberar e reenviar", com o reenvio ligado no gate real. */
function clicarLiberar() {
  return allowBlockedDir({
    convId: CONV,
    project: projeto,
    dir: PASTA,
    reenviar: (texto) => despachar(texto, PASTA_LIBERADA),
  })
}

function fila() {
  return useChat.getState().byId[CONV]?.queued ?? []
}

beforeEach(() => {
  h.write.mockReset()
  h.write.mockResolvedValue(undefined)
  h.toast.mockClear()
  h.sucesso.mockClear()
  h.erro.mockClear()
  turnos.length = 0
  useApp.setState({ projects: [projeto], mycockpit: {} })
  useChat.setState({ byId: { [CONV]: conversa() }, activeId: CONV })
})

describe("liberar a pasta com o turno EM VOO", () => {
  it("persiste o extra_dirs (isso vale já) e não reenvia nada", async () => {
    useChat.setState({ byId: { [CONV]: conversa({ running: true }) } })
    expect(await clicarLiberar()).toBe("turno-em-voo")
    // a metade que o botão de fato entrega continua entregue:
    expect(h.write).toHaveBeenCalledWith(projeto.path, { extraDirs: [PASTA] })
    expect(useApp.getState().mycockpit[PROJ]?.extraDirs).toEqual([PASTA])
    // a metade impossível não acontece:
    expect(turnos).toEqual([])
  })

  it("não empilha nada na fila do humano", async () => {
    // O print do incidente: o prompt aparecia como chip "Na fila", e o × dali
    // apaga blobs de anexo do disco. Nada do app pode morar naquela lista.
    useChat.setState({ byId: { [CONV]: conversa({ running: true }) } })
    await clicarLiberar()
    expect(fila()).toEqual([])
  })

  it("o fim do turno não ressuscita o reenvio: o prompt não roda duas vezes", async () => {
    useChat.setState({ byId: { [CONV]: conversa({ running: true }) } })
    await clicarLiberar()
    terminarTurno()
    expect(turnos).toEqual([])
  })

  it("finalizing conta como turno em voo (o CLI ainda está fechando a conta)", async () => {
    useChat.setState({ byId: { [CONV]: conversa({ finalizing: true }) } })
    expect(await clicarLiberar()).toBe("turno-em-voo")
    expect(turnos).toEqual([])
    expect(fila()).toEqual([])
  })

  it("o aviso diz o que ficou de pé, sem prometer reenvio", async () => {
    useChat.setState({ byId: { [CONV]: conversa({ running: true }) } })
    await clicarLiberar()
    expect(h.sucesso).toHaveBeenCalledWith(
      "Pasta liberada. Vale a partir do próximo envio.",
    )
  })
})

describe("mesmo que um resolvedor futuro tente enviar com turno vivo", () => {
  it("a retomada de sistema não entra na fila nem roda depois", () => {
    // A segunda camada, sozinha: aqui ninguém passou pelo `allowBlockedDir`.
    // Se um caminho novo chamar o envio no meio do turno, ele morre no gate.
    useChat.setState({ byId: { [CONV]: conversa({ running: true }) } })
    despachar(PROMPT, PASTA_LIBERADA)
    expect(fila()).toEqual([])
    terminarTurno()
    expect(turnos).toEqual([])
  })

  it("mas a fila do HUMANO continua funcionando (não foi isso que quebrou)", () => {
    useChat.setState({ byId: { [CONV]: conversa({ running: true }) } })
    despachar("aproveita e roda os testes", HUMANO)
    expect(fila().map((q) => q.text)).toEqual(["aproveita e roda os testes"])
    terminarTurno()
    expect(turnos).toEqual(["aproveita e roda os testes"])
  })
})

describe("liberar a pasta com a conversa PARADA", () => {
  it("reenvia o último pedido do usuário, uma vez só", async () => {
    expect(await clicarLiberar()).toBe("reenviada")
    // Reenviar é o projeto CORRETO aqui: o --add-dir é fixo no spawn, então só
    // um turno novo nasce com a pasta. O erro nunca foi reenviar.
    expect(turnos).toEqual([PROMPT])
    expect(fila()).toEqual([])
  })

  it("sem pedido do usuário no fio, libera e não inventa turno", async () => {
    useChat.setState({ byId: { [CONV]: conversa({ items: [] }) } })
    expect(await clicarLiberar()).toBe("sem-pedido")
    expect(turnos).toEqual([])
  })

  it("pasta já liberada (dois cliques) só limpa o aviso", async () => {
    useApp.setState({
      mycockpit: {
        [PROJ]: {
          exists: true,
          permission: "liberado",
          helper: "haiku",
          mode: "linear",
          extraDirs: [PASTA],
        },
      },
    })
    expect(await clicarLiberar()).toBe("ja-liberada")
    expect(h.write).not.toHaveBeenCalled()
    expect(turnos).toEqual([])
    expect(useChat.getState().byId[CONV]?.blockedDir).toBeNull()
  })

  it("falha ao salvar o config aborta antes de reenviar (ADR-017)", async () => {
    h.write.mockRejectedValue(new Error("EACCES"))
    expect(await clicarLiberar()).toBe("falha-ao-salvar")
    expect(h.erro).toHaveBeenCalledWith(
      "Não consegui salvar a pasta permitida no config.",
    )
    // reenviar com a pasta ainda barrada só repetiria o turno que já falhou.
    expect(turnos).toEqual([])
    expect(useApp.getState().mycockpit[PROJ]).toBeUndefined()
  })
})
