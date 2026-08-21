// Testes da fonte única de permissão (lib/permission). Existe porque agora DOIS
// lugares leem/escrevem o modo (a linha de execução do composer e o painel de
// contexto): uma cópia que esquecesse o config.toml deixaria a UI mentindo sobre
// o que o próximo turno vai fazer — o Rust resolve o spawn pelo .mycockpit.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { updateProjectPermission } from "@/lib/db"
import { writeMycockpitConfig } from "@/lib/mycockpit"
import { useApp } from "@/store/app"
import type { Project } from "@/lib/types"
import {
  PERMISSION_DESCRIPTION,
  PERMISSION_LABEL,
  effectivePermission,
  setProjectPermissionEverywhere,
} from "./permission"

vi.mock("@/lib/db", () => ({
  isTauri: () => true,
  updateProjectPermission: vi.fn(async () => {}),
}))
vi.mock("@/lib/mycockpit", () => ({
  writeMycockpitConfig: vi.fn(async () => {}),
}))

const proj: Project = {
  id: "px",
  name: "mycockpit",
  path: "/repo",
  createdAt: 0,
  permissionMode: "padrao",
}

beforeEach(() => {
  useApp.setState({ projects: [proj], mycockpit: {} })
  vi.mocked(updateProjectPermission).mockClear()
  vi.mocked(writeMycockpitConfig).mockClear()
})

describe("effectivePermission", () => {
  it("sem config, vale o cache do projeto", () => {
    expect(effectivePermission(proj)).toBe("padrao")
  })

  it("o config do .mycockpit VENCE o cache (é a verdade que o Rust lê)", () => {
    useApp.setState({
      mycockpit: {
        px: { exists: true, permission: "liberado", helper: "haiku", mode: "linear", extraDirs: [] },
      },
    })
    expect(effectivePermission(proj)).toBe("liberado")
  })

  it("sem projeto, assume padrao (nunca fail-open pra liberado)", () => {
    expect(effectivePermission(null)).toBe("padrao")
  })

  it("projeto sem modo gravado assume padrao", () => {
    expect(effectivePermission({ ...proj, permissionMode: undefined })).toBe("padrao")
  })
})

describe("setProjectPermissionEverywhere", () => {
  it("escreve nas TRÊS camadas: store, SQLite e config.toml", () => {
    setProjectPermissionEverywhere(proj, "liberado")
    // 1. store — é de lá que o envio lê project.permissionMode
    expect(useApp.getState().projects[0].permissionMode).toBe("liberado")
    // 2. SQLite — cache entre boots
    expect(updateProjectPermission).toHaveBeenCalledWith("px", "liberado")
    // 3. .mycockpit/config.toml — a verdade do spawn
    expect(writeMycockpitConfig).toHaveBeenCalledWith("/repo", {
      permission: "liberado",
    })
  })

  it("reflete no config em memória (o effectivePermission já vê)", () => {
    setProjectPermissionEverywhere(proj, "leitura")
    expect(useApp.getState().mycockpit.px?.permission).toBe("leitura")
    expect(effectivePermission(useApp.getState().projects[0])).toBe("leitura")
  })

  it("preserva o resto do config ao trocar só a permissão", () => {
    useApp.setState({
      mycockpit: {
        px: {
          exists: true,
          permission: "padrao",
          helper: null,
          mode: "sdd",
          extraDirs: ["/outro"],
        },
      },
    })
    setProjectPermissionEverywhere(proj, "liberado")
    const cfg = useApp.getState().mycockpit.px
    expect(cfg?.helper).toBeNull()
    expect(cfg?.mode).toBe("sdd")
    expect(cfg?.extraDirs).toEqual(["/outro"])
  })
})

describe("PERMISSION_LABEL", () => {
  it("cobre os QUATRO modos com rótulo curto (o controle não tem espaço)", () => {
    // `auto` entrou no M2 dos modos de sessão: o Rust já o aceitava e o
    // agendamento já o usava; só a conversa não tinha como escolher.
    expect(PERMISSION_LABEL).toEqual({
      leitura: "Só lê",
      padrao: "Pede",
      auto: "Auto",
      liberado: "Liberado",
    })
  })

  it("todo modo tem descrição (o menu mostra as duas linhas)", () => {
    for (const m of Object.keys(PERMISSION_LABEL) as (keyof typeof PERMISSION_LABEL)[]) {
      expect(PERMISSION_DESCRIPTION[m]?.length ?? 0).toBeGreaterThan(10)
    }
  })
})
