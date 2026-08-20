// O que morre junto com a conversa — com foco no que ENTROU agora: o worktree.
//
// O defeito que estes testes travam: desde que o fork passou a isolar sozinho,
// apagar um fork descartado deixava pasta e branch `mycockpit/*` para trás, e
// ninguém ficava sabendo. Então há duas famílias aqui: "recolheu?" e
// "contou quando sobrou?".

import { beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { useChat, type ConvState } from "../chat"
import { useApp } from "@/store/app"
import { removeWorktree } from "@/lib/git"

const h = vi.hoisted(() => ({ tauri: true }))

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  isTauri: () => h.tauri,
}))
// `worktreeRemovalNote` fica REAL de propósito: é a frase que o usuário lê, e
// reimplementá-la no mock criaria uma segunda verdade que diverge em silêncio.
vi.mock("@/lib/git", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/git")>()),
  removeWorktree: vi.fn(async () => ({ branch: null, branchRemoved: false })),
}))
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock("@/lib/db/conversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/conversations")>()),
  deleteConversation: vi.fn(async () => {}),
}))
vi.mock("@/lib/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attachments")>()),
  wipeAttachments: vi.fn(async () => {}),
}))

const PROJECT = "project"
const PROJECT_PATH = "/tmp/projeto"
const ALVO = "conv-alvo"
const OUTRA = "conv-outra"
const WT = "/tmp/projeto/.mycockpit/worktrees/convalvo"

function conv(): ConvState {
  return {
    projectId: PROJECT,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: null,
    model: null,
    contextTokens: 0,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
  }
}

function meta(id: string, worktreePath: string | null) {
  return {
    id,
    title: id,
    updatedAt: 0,
    color: null,
    worktreePath,
    agent: "claude-code",
  }
}

/** Monta o estado com a conversa-alvo isolada (ou não) e OUTRA como ativa —
 *  assim o delete não cai no ramo de trocar/criar conversa, que é outro assunto. */
function montar(worktreePath: string | null) {
  const lista = [meta(ALVO, worktreePath), meta(OUTRA, null)]
  useChat.setState({
    projectId: PROJECT,
    activeId: OUTRA,
    conversations: lista,
    conversationsByProject: { [PROJECT]: lista },
    byId: { [ALVO]: conv(), [OUTRA]: conv() },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.tauri = true
  vi.mocked(removeWorktree).mockResolvedValue({ branch: null, branchRemoved: false })
  useApp.setState({
    projects: [{ id: PROJECT, name: "projeto", path: PROJECT_PATH }],
  } as never)
  montar(WT)
})

describe("worktree morre junto com a conversa", () => {
  it("conversa isolada devolve o worktree ao repositório", async () => {
    await useChat.getState().removeConversation(ALVO)
    expect(removeWorktree).toHaveBeenCalledWith(PROJECT_PATH, WT)
  })

  it("conversa sem isolamento não mexe em git nenhum", async () => {
    montar(null)
    await useChat.getState().removeConversation(ALVO)
    expect(removeWorktree).not.toHaveBeenCalled()
  })

  it("fora do Tauri não tenta git (o dev no browser não tem repo)", async () => {
    h.tauri = false
    await useChat.getState().removeConversation(ALVO)
    expect(removeWorktree).not.toHaveBeenCalled()
  })

  it("a conversa some do estado mesmo assim", async () => {
    await useChat.getState().removeConversation(ALVO)
    const s = useChat.getState()
    expect(s.byId[ALVO]).toBeUndefined()
    expect(s.conversationsByProject[PROJECT].map((c) => c.id)).toEqual([OUTRA])
  })
})

describe("o que sobra é DITO; o esperado é silencioso", () => {
  it("branch apagado junto não vira aviso (já foi anunciado na confirmação)", async () => {
    vi.mocked(removeWorktree).mockResolvedValue({
      branch: "mycockpit/convalvo",
      branchRemoved: true,
    })
    await useChat.getState().removeConversation(ALVO)
    expect(toast).not.toHaveBeenCalled()
  })

  it("branch que SOBREVIVEU é anunciado com o nome (senão vira lixo invisível)", async () => {
    vi.mocked(removeWorktree).mockResolvedValue({
      branch: "mycockpit/convalvo",
      branchRemoved: false,
    })
    await useChat.getState().removeConversation(ALVO)
    expect(toast).toHaveBeenCalled()
    const [titulo, opts] = vi.mocked(toast).mock.calls[0] as [string, { description?: string }]
    expect(titulo).toContain("branch preservado")
    expect(opts?.description).toContain("mycockpit/convalvo")
  })

  it("pasta que ficou (mudança não-commitada) é dita COM o caminho", async () => {
    vi.mocked(removeWorktree).mockRejectedValue("contains modified files")
    await useChat.getState().removeConversation(ALVO)
    const [titulo, opts] = vi.mocked(toast).mock.calls[0] as [string, { description?: string }]
    expect(titulo).toContain("worktree ficou")
    expect(opts?.description).toContain(WT)
  })

  it("git falhando não impede a conversa de ser apagada", async () => {
    vi.mocked(removeWorktree).mockRejectedValue("qualquer erro do git")
    await useChat.getState().removeConversation(ALVO)
    expect(useChat.getState().byId[ALVO]).toBeUndefined()
  })
})
