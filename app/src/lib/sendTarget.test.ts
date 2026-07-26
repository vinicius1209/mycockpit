// Testes do alvo de envio (lib/sendTarget): quem manda no destino de um turno é
// a CONVERSA, não o projeto em foco. O bug que originou o módulo: uma mensagem
// enfileirada na conversa do projeto X foi enviada na conversa aberta do
// projeto Y (a drenagem da fila relia o foco no fim do turno).

import { describe, expect, it } from "vitest"
import type { ConvState } from "@/store/chat"
import type { Project } from "@/lib/types"
import { resolveSendTarget } from "./sendTarget"

function conv(projectId: string): ConvState {
  return {
    projectId,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
  }
}

const projX: Project = { id: "px", name: "X", path: "/x", createdAt: 0 }
const projY: Project = { id: "py", name: "Y", path: "/y", createdAt: 0 }
const byId = { cx: conv("px"), cy: conv("py") }

describe("resolveSendTarget", () => {
  it("o projeto vem da CONVERSA, não do que está em foco", () => {
    // foco em Y (cy), mas o envio é da conversa cx → tudo resolve em X
    const t = resolveSendTarget("cx", byId, [projX, projY])
    expect(t.status).toBe("ok")
    if (t.status !== "ok") return
    expect(t.project.id).toBe("px")
    expect(t.project.path).toBe("/x")
    expect(t.conv).toBe(byId.cx)
  })

  it("o projeto é lido FRESCO da lista (permissão trocada durante o turno vale)", () => {
    const liberado: Project = { ...projX, permissionMode: "liberado" }
    const t = resolveSendTarget("cx", byId, [liberado, projY])
    expect(t.status === "ok" && t.project.permissionMode).toBe("liberado")
  })

  it("sem conversa alvo → none (envio ignorado, sem toast)", () => {
    expect(resolveSendTarget(null, byId, [projX]).status).toBe("none")
  })

  it("conversa não hidratada em byId → loading (não fabrica estado vazio)", () => {
    const t = resolveSendTarget("cz", byId, [projX, projY])
    expect(t.status).toBe("loading")
    expect(t.status === "loading" && t.convId).toBe("cz")
  })

  it("projeto dono removido → orphan (não cai no projeto em foco)", () => {
    const t = resolveSendTarget("cx", byId, [projY])
    expect(t.status).toBe("orphan")
  })
})
