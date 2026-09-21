// MH2.3 — canais do desfecho de missão (lib/notify): feed do sino + nativa do
// SO, dedupe por missão (UM aviso de desfecho por missionId) e recovery como
// irmão do gate (família "esperando VOCÊ"). Copy pt-BR sem travessão.

import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  native: [] as { title: string; body: string }[],
}))

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn((n: { title: string; body: string }) => {
    h.native.push(n)
  }),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }))
vi.mock("sonner", () => ({ toast: vi.fn() }))
// só o isTauri muda (liga o caminho nativo); o resto do db segue real.
vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>()
  return { ...mod, isTauri: () => true }
})

import {
  _resetMissionEndNotified,
  notifyMissionEnd,
  notifyMissionRecovery,
} from "./notify"
import { useNotifs } from "@/store/notifications"
import { useChat, type ConvState } from "@/store/chat"
import { useApp } from "@/store/app"

const CONV = "c1"
const PROJ = "proj1"

function seed() {
  const conv = {
    projectId: PROJ,
    agent: "claude-code",
    items: [],
  } as unknown as ConvState
  useChat.setState({
    byId: { [CONV]: conv },
    conversations: [],
    conversationsByProject: {
      [PROJ]: [
        {
          id: CONV,
          title: "Missão · refactor do parser",
          updatedAt: 0,
          color: null,
          worktreePath: null,
          agent: "claude-code",
        },
      ],
    },
  })
  useApp.setState({
    projects: [
      { id: PROJ, name: "Frota", path: "/tmp/p" },
    ] as unknown as ReturnType<typeof useApp.getState>["projects"],
  })
}

function feed() {
  return useNotifs.getState().items
}

/** Deixa o nativeNotify assíncrono terminar (permissão + send). */
function flush() {
  return new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  h.native = []
  vi.clearAllMocks()
  _resetMissionEndNotified()
  useNotifs.setState({ items: [] })
  seed()
})

describe("notifyMissionEnd · dedupe por missão", () => {
  it("segundo aviso do MESMO desfecho é engolido (um por missionId)", async () => {
    notifyMissionEnd({
      missionId: "m1",
      convId: CONV,
      outcome: "concluida",
      costUsd: 3.2,
    })
    notifyMissionEnd({
      missionId: "m1",
      convId: CONV,
      outcome: "falha",
      costUsd: 3.2,
    })
    await flush()
    expect(feed()).toHaveLength(1)
    expect(h.native).toHaveLength(1)
  })

  it("missões DIFERENTES avisam cada uma a sua", async () => {
    notifyMissionEnd({ missionId: "m1", convId: CONV, outcome: "concluida", costUsd: 1 })
    notifyMissionEnd({ missionId: "m2", convId: CONV, outcome: "falha", costUsd: 2 })
    await flush()
    expect(feed()).toHaveLength(2)
  })
})

describe("notifyMissionEnd · copy e canais por desfecho", () => {
  it("concluida → feed run_done com título da conversa, custo e projeto + nativa", async () => {
    notifyMissionEnd({
      missionId: "m1",
      convId: CONV,
      outcome: "concluida",
      costUsd: 3.2,
      detail: "preset Feature completa",
    })
    await flush()
    const n = feed()[0]
    expect(n.kind).toBe("run_done")
    expect(n.title).toBe("Missão · refactor do parser")
    expect(n.subtitle).toContain("US$ 3.20")
    expect(n.subtitle).toContain("Frota")
    expect(n.projectId).toBe(PROJ)
    expect(n.convId).toBe(CONV)
    expect(h.native[0].title).toContain("missão concluída")
  })

  it("ressalva → run_done mas o texto cobra a revisão do parecer (nunca fim seco)", async () => {
    notifyMissionEnd({ missionId: "m1", convId: CONV, outcome: "ressalva", costUsd: 5 })
    await flush()
    expect(feed()[0].kind).toBe("run_done")
    expect(feed()[0].subtitle).toContain("SEM aprovação do revisor")
    expect(h.native[0].body).toContain("Revise o parecer")
  })

  it("falha → run_error com o motivo", async () => {
    notifyMissionEnd({
      missionId: "m1",
      convId: CONV,
      outcome: "falha",
      costUsd: 0.4,
      detail: "erro de compilação no arquivo x",
    })
    await flush()
    expect(feed()[0].kind).toBe("run_error")
    expect(feed()[0].subtitle).toContain("erro de compilação")
    expect(h.native[0].title).toContain("missão falhou")
  })

  it("teto → run_error dizendo que parou no teto (e onde mordeu)", async () => {
    notifyMissionEnd({
      missionId: "m1",
      convId: CONV,
      outcome: "teto",
      costUsd: 25.1,
      detail: "teto de US$ 25.00 atingido durante a fase 2",
    })
    await flush()
    expect(feed()[0].kind).toBe("run_error")
    expect(feed()[0].subtitle).toContain("teto")
    expect(feed()[0].subtitle).toContain("fase 2")
    expect(h.native[0].body).toContain("worktree")
  })

  it("copy sem travessão (convenção da casa)", async () => {
    for (const outcome of ["concluida", "ressalva", "falha", "teto"] as const) {
      notifyMissionEnd({ missionId: `m-${outcome}`, convId: CONV, outcome, costUsd: 1 })
    }
    await flush()
    for (const n of feed()) expect(n.subtitle).not.toContain("—")
    for (const n of h.native) {
      expect(n.title).not.toContain("—")
      expect(n.body).not.toContain("—")
    }
  })
})

describe("notifyMissionRecovery · a missão está esperando VOCÊ", () => {
  it("feed 'gate' (família âmbar) + nativa explicando a pausa e o gesto", async () => {
    notifyMissionRecovery(CONV, "Frota", "Executar")
    await flush()
    const n = feed()[0]
    expect(n.kind).toBe("gate")
    expect(n.subtitle).toContain("Recuperação pendente")
    expect(n.subtitle).toContain("Executar")
    expect(n.subtitle).toContain("Frota")
    expect(h.native[0].body).toContain("pausada")
    expect(h.native[0].body).toContain("outro agent")
  })
})
