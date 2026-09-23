// As invariantes da antiga faixa "Capacidades deste run", agora na aba e no
// composer (ADR-239). Fixture: o mesmo manifesto do teste da faixa.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { FerramentasDoTurno } from "./FerramentasDoTurno"
import { ListaDeExcecoes } from "@/components/chat/ExcecoesDoTurno"
import { excecoesDoTurno } from "@/lib/excecoesDoTurno"
import type { EffectiveRunManifest } from "@/lib/tooling"

const manifest: EffectiveRunManifest = {
  schemaVersion: 5,
  agentId: "engine",
  managedExternalMcp: true,
  instructions: [
    {
      id: "plugin-skill:acme.quality:review",
      label: "Quality · /acme.quality:review",
      kind: "plugin-skill",
      scope: "user",
      enforceability: "hard",
      invocation: "acme.quality:review",
    },
  ],
  notices: [],
  omissions: [],
  sources: [
    {
      id: "provider-native", label: "Tools nativas do provider", kind: "provider-native",
      transport: "native", scope: "run", enforceability: "advisory", inventory: "runtime-count",
      filtersPerRun: false, toolNames: [], observedCount: 12,
    },
    {
      id: "frota-work", label: "Trabalho e processos", kind: "frota-gateway",
      transport: "mcp", scope: "run", enforceability: "hard", inventory: "declared",
      filtersPerRun: true, toolNames: ["process_start", "work_plan"], observedCount: 2,
    },
  ],
  resources: [
    {
      id: "project-browser:playwright", label: "Navegador do projeto", kind: "project-browser",
      owner: "frota", scope: "project", enforceability: "hard", evidence: "binding",
      state: "ready", via: "playwright",
    },
  ],
  unobservedResources: false,
}

const ver = (m: EffectiveRunManifest | undefined) =>
  renderToStaticMarkup(<FerramentasDoTurno manifest={m} motor="Claude Code" />)

describe("Ferramentas deste turno, na aba", () => {
  it("uma linha por fonte, com quem controla em palavras, sem esconder o motor", () => {
    const html = ver(manifest)
    expect(html).toContain("14 ao todo")
    expect(html).toContain("Do próprio Claude Code")
    expect(html).toContain("o motor decide como usar")
    expect(html).toContain("Trabalho e processos")
    expect(html).toContain("a Frota controla")
    // os nomes só abrem por fonte
    expect(html).not.toContain("process_start · work_plan")
    expect(html).toContain("Quality · /acme.quality:review")
    expect(html).toContain("via playwright · possuído pela Frota · pronto")
    // o jargão da faixa antiga não volta
    expect(html).not.toContain("depende do provider")
    expect(html).not.toContain("tools confirmadas")
  })

  it("contagem desconhecida nunca vira zero", () => {
    const semContagem = {
      ...manifest,
      sources: [{ ...manifest.sources[0], observedCount: null }],
    }
    expect(ver(semContagem)).toContain("aguardando")
  })

  it("não transforma superfície opaca do motor em lista vazia segura", () => {
    expect(ver({ ...manifest, unobservedResources: true })).toContain("que a Frota não enumerou nem filtrou")
  })

  it("o que ficou fora aparece como fora, com o motivo", () => {
    const html = ver({
      ...manifest,
      omissions: [{ sourceId: "playwright", sourceLabel: "Playwright", code: "browser-offline", detail: null }],
    })
    expect(html).toContain("Playwright")
    expect(html).toContain("· fora")
    expect(html).toContain("navegador deste projeto desligado")
  })

  it("antes do primeiro envio, diz quando vai aparecer", () => {
    expect(ver(undefined)).toContain("Aparece depois do primeiro envio")
  })
})

describe("exceções do turno, no composer", () => {
  const lista = (m: EffectiveRunManifest) =>
    renderToStaticMarkup(<ListaDeExcecoes excecoes={excecoesDoTurno(m, "Antigravity")} onAcao={() => {}} />)

  it("turno sem exceção não desenha nada", () => {
    expect(lista(manifest)).toBe("")
  })

  it("navegador de terceiro aparece com nome e o gesto", () => {
    const html = lista({ ...manifest, externalBrowserMcps: ["playwright"] })
    expect(html).toContain("fora da Frota, pelo playwright")
    expect(html).toContain("Configurar")
  })
})
