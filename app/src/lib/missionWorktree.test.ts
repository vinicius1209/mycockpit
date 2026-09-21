// MH1.4 — verdade no launch: o modal promete "no worktree desta conversa";
// ensureMissionCwd garante isso criando o worktree quando falta (mesmo
// mecanismo do toggle da sidebar: create_worktree por convId). Falha na
// criação NUNCA cai na pasta do projeto em silêncio (a mentira antiga): pede
// confirmação explícita, e recusa = missão não larga (fail-closed no efeito).

import { describe, expect, it, vi } from "vitest"
import type { ConfirmReq } from "@/lib/confirm"
import { ensureMissionCwd } from "./missionWorktree"

const ARGS = {
  convId: "conv-1",
  projectPath: "/proj",
  worktreePath: null as string | null,
  resume: false,
}

const inTauri = () => true

describe("ensureMissionCwd (MH1.4)", () => {
  it("conversa JÁ isolada: usa o worktree existente, sem criar nada", async () => {
    const create = vi.fn()
    const r = await ensureMissionCwd(
      { ...ARGS, worktreePath: "/proj/.worktrees/conv-1" },
      { create, inTauri },
    )
    expect(r).toEqual({
      ok: true,
      cwd: "/proj/.worktrees/conv-1",
      created: false,
      fallback: false,
    })
    expect(create).not.toHaveBeenCalled()
  })

  it("sem worktree: CRIA pelo mesmo mecanismo do toggle (projectPath + convId) e devolve o path/branch", async () => {
    // payload REAL do create_worktree (git.rs): worktree sob
    // .frota/worktrees/<slug>, branch mycockpit/<slug> (slug do convId).
    const create = vi.fn(async () => ({
      path: "/proj/.mycockpit/worktrees/conv-1",
      branch: "mycockpit/conv-1",
    }))
    const r = await ensureMissionCwd(ARGS, { create, inTauri })
    expect(create).toHaveBeenCalledWith("/proj", "conv-1")
    expect(r.ok).toBe(true)
    expect(r.created).toBe(true)
    expect(r.cwd).toBe("/proj/.mycockpit/worktrees/conv-1")
    expect(r.branch).toBe("mycockpit/conv-1")
  })

  it("RETOMADA nunca cria worktree: o run-state e os handoffs moram onde a missão começou", async () => {
    const create = vi.fn()
    const r = await ensureMissionCwd(
      { ...ARGS, resume: true },
      { create, inTauri },
    )
    expect(create).not.toHaveBeenCalled()
    expect(r).toEqual({ ok: true, cwd: "/proj", created: false, fallback: false })
  })

  it("criação FALHOU + usuário confirmou: cai na pasta do projeto com fallback=true (nunca silencioso)", async () => {
    // erro REAL do git.rs: string legível (mesma leitura do toggle da sidebar)
    const create = vi.fn(async () => {
      throw "fatal: not a git repository (or any of the parent directories): .git"
    })
    const ask = vi.fn(async (_req: ConfirmReq) => true)
    const r = await ensureMissionCwd(ARGS, { create, ask, inTauri })
    expect(ask).toHaveBeenCalledTimes(1)
    const req = ask.mock.calls[0][0]
    expect(req.title).toContain("worktree")
    expect(req.description).toContain("not a git repository")
    expect(req.description).toContain("pasta do projeto")
    expect(req.confirmLabel).toBe("Rodar na pasta do projeto")
    expect(r).toEqual({ ok: true, cwd: "/proj", created: false, fallback: true })
  })

  it("criação FALHOU + usuário recusou: ok=false, a missão NÃO larga (fail-closed)", async () => {
    const create = vi.fn(async () => {
      throw "erro qualquer do git"
    })
    const ask = vi.fn(async () => false)
    const r = await ensureMissionCwd(ARGS, { create, ask, inTauri })
    expect(r.ok).toBe(false)
    expect(r.fallback).toBe(false)
  })

  it("fora do Tauri (dev/teste): degrada pra pasta do projeto sem criar nem perguntar", async () => {
    const create = vi.fn()
    const ask = vi.fn()
    const r = await ensureMissionCwd(ARGS, {
      create,
      ask,
      inTauri: () => false,
    })
    expect(create).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
    expect(r).toEqual({ ok: true, cwd: "/proj", created: false, fallback: false })
  })
})
