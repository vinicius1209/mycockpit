import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import {
  PluginReviewCard,
  pluginStatus,
  type PluginConfirmation,
} from "./PluginReviewCard"
import type { PluginView } from "@/lib/plugins"

function plugin(
  status: PluginView["grant"]["status"],
  runtime: PluginView["runtime"]["state"] = "idle",
): PluginView {
  return {
    key: "acme.quality",
    name: "Quality",
    version: "1.0.0",
    state: "validated",
    executable: true,
    capabilities: ["tools:provide", "browser:control", "desktop:control"],
    contributes: { skills: 1, mcpServers: 1, tools: 2 },
    fingerprint: "1234567890abcdef",
    detail: "Revisa páginas",
    grant: {
      status,
      enabled: status === "approved",
      reviewedAt: status === "pending" ? null : 1_700_000_000_000,
    },
    runtime: {
      state: runtime,
      pid: runtime === "running" ? 42 : null,
      activeTool: runtime === "idle" ? null : "auditar",
      startedAt: runtime === "idle" ? null : 1_700_000_000_000,
      lastError: null,
    },
    activeResources: runtime === "running" ? ["project-browser"] : [],
    audit: [],
  }
}

function markup(value: PluginView, confirmation: PluginConfirmation) {
  const noop = vi.fn()
  return renderToStaticMarkup(
    createElement(PluginReviewCard, {
      plugin: value,
      confirmation,
      busy: false,
      error: null,
      onConfirm: noop,
      onCancel: noop,
      onApprove: noop,
      onEnable: noop,
      onRevoke: noop,
      onStop: noop,
    }),
  )
}

describe("PluginReviewCard", () => {
  it("torna o consentimento pendente uma decisão explícita", () => {
    const html = markup(plugin("pending"), null)
    expect(html).toContain("Nada deste pacote é publicado")
    expect(html).toContain("Revisar e ativar")
    expect(html).toContain("border-st-warning/40")
    expect(html).not.toContain("Confirmar e ativar")
  })

  it("expõe a fronteira real antes de confirmar o fingerprint", () => {
    const html = markup(plugin("pending"), "review")
    expect(html).toContain("abrir esta tela não executam código")
    expect(html).toContain("somente quando uma tool for chamada")
    expect(html).toContain("só entram no prompt quando você")
    expect(html).toContain("health check a cada materialização")
    expect(html).toContain("não é um sandbox completo")
    expect(html).toContain("não inicia worker, MCP ou navegador por si só")
    expect(html).toContain("Confirmar e ativar")
    expect(html).toContain("fica bloqueado até existir um broker nativo")
  })

  it("mostra disponibilidade sob demanda e controle do runtime real", () => {
    const active = markup(plugin("approved"), null)
    expect(active).toContain("Abrir Configurações não inicia worker nem navegador")
    expect(active).toContain("Desativar")
    expect(active).toContain("Revogar permissão")

    const running = markup(plugin("approved", "running"), null)
    expect(running).toContain("está atendendo uma chamada agora")
    expect(running).toContain("Recursos em lease: Navegador do projeto")
    expect(running).toContain("Parar chamada")
  })

  it("um pacote alterado invalida o consentimento antigo", () => {
    expect(pluginStatus(plugin("stale"))).toMatchObject({
      label: "mudou",
      tone: "atencao",
    })
  })

  it("skills e MCPs materializados contam como contribuição ativa", () => {
    const contentOnly = plugin("approved")
    contentOnly.contributes.tools = 0
    expect(pluginStatus(contentOnly)).toMatchObject({ label: "ativo" })
  })

  it("pacote sem nenhuma contribuição fica apenas revisado", () => {
    const empty = plugin("approved")
    empty.contributes = { skills: 0, mcpServers: 0, tools: 0 }
    expect(pluginStatus(empty)).toMatchObject({ label: "revisado" })
    expect(markup(empty, null)).toContain("não declara contribuições efetivas")
  })
})
