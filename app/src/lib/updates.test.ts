// Jobs de update de CLI como estado GLOBAL (lib/updates): job RODANDO não
// gera toast (mora na faixa de status, ver lib/statusBar), só o DESFECHO
// (sucesso/erro/inalterado) vira toast, com id ESTÁVEL por agent — nunca
// empilha. Dedupe no gesto (a trava real é no backend), desfecho na
// transição running→ok/failed e re-hidratação por snapshot que NÃO re-anuncia
// job terminado em sessão antiga do modal.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({
  // toast() neutro + .loading/.success/.error: o store usa as quatro formas.
  toast: Object.assign(vi.fn(), {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }))
// fora do Tauri o módulo é no-op; os testes fingem o app de verdade.
vi.mock("@/lib/db", () => ({ isTauri: () => true }))
// detect dispara invoke de verdade — mock inteiro (só o spy interessa).
vi.mock("@/lib/detect", () => ({
  detectAgents: vi.fn(async () => []),
  toProbeMap: vi.fn(() => ({})),
}))

import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
import { detectAgents } from "@/lib/detect"
import {
  _handleUpdateEvent,
  _resetUpdatesState,
  hydrateUpdateJobs,
  startUpdate,
  updateButtonState,
  updateToastId,
  useUpdates,
  type UpdateJob,
} from "./updates"

const T0 = 1_700_000_000_000

function job(over: Partial<UpdateJob> = {}): UpdateJob {
  return {
    agent: "codex",
    status: "running",
    method: "homebrew",
    command: "brew upgrade codex",
    startedAt: T0,
    outputTail: "",
    version: "",
    managedPath: "/opt/homebrew/Caskroom/codex/0.146.0/bin/codex",
    otherPaths: [],
    ...over,
  }
}

type EventPayload = Parameters<typeof _handleUpdateEvent>[0]

function evt(over: Partial<EventPayload> = {}): EventPayload {
  const merged = {
    agent: "codex",
    phase: "started" as const,
    ok: null as boolean | null,
    method: "homebrew",
    command: "brew upgrade codex",
    startedAt: T0,
    outputTail: "",
    version: "",
    managedPath: "/opt/homebrew/Caskroom/codex/0.146.0/bin/codex",
    otherPaths: [] as string[],
    ...over,
  }
  // status espelha o Rust (job.status no emit); o fixture deriva quando o
  // caso de teste não fixa um explícito.
  const status =
    over.status ??
    (merged.phase === "started" ? "running" : merged.ok ? "ok" : "failed")
  return { ...merged, status }
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetUpdatesState()
})

describe("id estável do toast", () => {
  it("job RODANDO não gera toast; só o desfecho, com id estável", () => {
    _handleUpdateEvent(evt({ phase: "started" }))
    expect(toast).not.toHaveBeenCalled()
    expect(toast.loading).not.toHaveBeenCalled()

    _handleUpdateEvent(evt({ phase: "finished", ok: true }))
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.success).mock.calls[0][1]).toMatchObject({
      id: updateToastId("codex"),
    })
  })

  it("re-hidratar com o MESMO job vivo não gera toast nenhum", async () => {
    _handleUpdateEvent(evt({ phase: "started" }))
    // reabrir o modal → hydrate devolve o job ainda running.
    vi.mocked(invoke).mockResolvedValueOnce([job()])
    await hydrateUpdateJobs()
    expect(toast.loading).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(useUpdates.getState().byAgent.codex.status).toBe("running")
  })
})

describe("started → finished", () => {
  it("sucesso vira toast.success e dispara a re-verificação de versões", () => {
    _handleUpdateEvent(evt({ phase: "started" }))
    expect(useUpdates.getState().byAgent.codex.status).toBe("running")

    _handleUpdateEvent(evt({ phase: "finished", ok: true }))
    expect(useUpdates.getState().byAgent.codex.status).toBe("ok")
    expect(toast.success).toHaveBeenCalledWith(
      "Codex atualizado (homebrew).",
      expect.objectContaining({ id: updateToastId("codex") }),
    )
    expect(detectAgents).toHaveBeenCalledTimes(1)
  })

  it("erro vira toast.error com o comando no título e o tail na descrição", () => {
    _handleUpdateEvent(evt({ phase: "started" }))
    _handleUpdateEvent(
      evt({
        phase: "finished",
        ok: false,
        outputTail: "Error: Another active Homebrew process is already in progress.",
      }),
    )
    expect(useUpdates.getState().byAgent.codex.status).toBe("failed")
    expect(toast.error).toHaveBeenCalledWith(
      "Falha ao atualizar Codex (brew upgrade codex).",
      expect.objectContaining({
        id: updateToastId("codex"),
        description: expect.stringContaining("Homebrew"),
      }),
    )
    expect(detectAgents).not.toHaveBeenCalled()
  })

  it("sucesso com versão diz PRA QUAL versão foi (prova, não promessa)", () => {
    _handleUpdateEvent(evt({ phase: "started" }))
    _handleUpdateEvent(
      evt({ phase: "finished", ok: true, status: "ok", version: "0.147.0" }),
    )
    expect(toast.success).toHaveBeenCalledWith(
      "Codex atualizado (homebrew) para v0.147.0.",
      expect.objectContaining({ id: updateToastId("codex") }),
    )
  })

  it("exit 0 sem a versão mudar vira 'já está na última do canal', não success", () => {
    // O incidente do sucesso falso: brew respondia "latest version is already
    // installed" (exit 0) e o toast mentia "atualizado" sem nada mudar.
    _handleUpdateEvent(
      evt({ phase: "started", agent: "claude-code", command: "brew upgrade claude-code" }),
    )
    _handleUpdateEvent(
      evt({
        phase: "finished",
        ok: true,
        status: "unchanged",
        version: "2.1.212",
        agent: "claude-code",
        method: "homebrew",
        command: "brew upgrade claude-code",
      }),
    )
    expect(useUpdates.getState().byAgent["claude-code"].status).toBe("unchanged")
    expect(toast).toHaveBeenCalledWith(
      "Claude Code já está na última do canal homebrew (v2.1.212).",
      expect.objectContaining({ id: updateToastId("claude-code") }),
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    // re-verifica mesmo assim: o probe por canal conserta o "última vX".
    expect(detectAgents).toHaveBeenCalledTimes(1)
  })

  it("sem canal (method none) vira toast neutro com o caminho manual", () => {
    _handleUpdateEvent(evt({ phase: "started" }))
    _handleUpdateEvent(
      evt({
        phase: "finished",
        ok: false,
        method: "none",
        command: "",
        outputTail: "Este agent não tem canal de atualização conhecido.",
      }),
    )
    expect(toast).toHaveBeenCalledWith(
      "Não deu pra atualizar Codex automaticamente.",
      expect.objectContaining({ id: updateToastId("codex") }),
    )
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe("re-hidratação por snapshot (update_jobs)", () => {
  it("job que TERMINOU com o modal fechado ganha o desfecho atrasado", async () => {
    // o started chegou por evento (store viu running)…
    _handleUpdateEvent(evt({ phase: "started" }))
    // …os eventos de finished se perderam; reabrir o modal traz o snapshot.
    vi.mocked(invoke).mockResolvedValueOnce([job({ status: "ok" })])
    await hydrateUpdateJobs()
    expect(useUpdates.getState().byAgent.codex.status).toBe("ok")
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it("job terminado em sessão ANTIGA (sem running aqui) não ganha toast", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([job({ status: "failed" })])
    await hydrateUpdateJobs()
    expect(useUpdates.getState().byAgent.codex.status).toBe("failed")
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("falha do snapshot é fail-open: não derruba o estado que já existe", async () => {
    _handleUpdateEvent(evt({ phase: "started" }))
    vi.mocked(invoke).mockRejectedValueOnce(new Error("ipc fora do ar"))
    await hydrateUpdateJobs()
    expect(useUpdates.getState().byAgent.codex.status).toBe("running")
  })
})

describe("startUpdate (gesto do usuário)", () => {
  it("dispara o job, sem loading, e espelha o snapshot devolvido", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(job())
    await startUpdate("codex")
    expect(invoke).toHaveBeenCalledWith("update_agent", { agent: "codex" })
    expect(toast.loading).not.toHaveBeenCalled()
    expect(useUpdates.getState().byAgent.codex.status).toBe("running")
  })

  it("com job vivo NÃO invoca de novo (o incidente dos N cliques)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(job())
    await startUpdate("codex")
    await startUpdate("codex")
    await startUpdate("codex")
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it("falha do invoke vira toast.error no MESMO id (fail-open)", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("ipc fora do ar"))
    await startUpdate("codex")
    expect(toast.error).toHaveBeenCalledWith(
      "ipc fora do ar",
      expect.objectContaining({ id: updateToastId("codex") }),
    )
  })
})

describe("estado do botão Atualizar", () => {
  it("job vivo do agent: spinner nele e todos desabilitados", () => {
    _handleUpdateEvent(evt({ phase: "started" }))
    const byAgent = useUpdates.getState().byAgent
    expect(updateButtonState(byAgent, "codex")).toEqual({
      spinning: true,
      disabled: true,
    })
    // outro agent não gira, mas fica desabilitado (um update por vez).
    expect(updateButtonState(byAgent, "claude-code")).toEqual({
      spinning: false,
      disabled: true,
    })
  })

  it("sem job vivo, botão habilitado e sem spinner", () => {
    _handleUpdateEvent(evt({ phase: "started" }))
    _handleUpdateEvent(evt({ phase: "finished", ok: true }))
    const byAgent = useUpdates.getState().byAgent
    expect(updateButtonState(byAgent, "codex")).toEqual({
      spinning: false,
      disabled: false,
    })
  })
})
