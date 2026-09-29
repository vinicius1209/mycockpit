import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PreflightGateBanner } from "./ComposerBanners"
import type { McpPreflightGate } from "@/lib/tooling"

// O portão no formato que o Rust serializa (`segredos::portao`, conferido no
// teste `keychain_que_nao_entrega_vira_portao_com_continuar_sem`).
const gate = (nomes: string[]): McpPreflightGate => ({
  fingerprint: "a1b2c3d4e5f60718",
  issues: nomes.map((nome) => ({
    sourceId: `segredo:${nome}`,
    sourceLabel: nome,
    code: "secret-unavailable",
    disposition: "needs-decision",
    detail: "o Keychain recusou: -25293",
  })),
  allowedRecoveries: [
    { kind: "omit-for-this-run", sourceId: "segredos" },
    { kind: "open-mcp-settings", sourceId: null },
  ],
})

const noop = () => {}

describe("portão de segredo no composer (ADR-288)", () => {
  it("diz qual segredo, oferece enviar sem ele e abrir os Segredos", () => {
    const html = renderToStaticMarkup(
      <PreflightGateBanner gate={gate(["STRIPE_SECRET_KEY"])} onOpenSettings={noop} onOpenSecrets={noop} onContinueWithout={noop} />,
    )
    expect(html).toContain("O Keychain não entregou STRIPE_SECRET_KEY")
    expect(html).toContain("o Keychain recusou: -25293")
    expect(html).toContain("Enviar sem STRIPE_SECRET_KEY")
    expect(html).toContain("Abrir Segredos")
    expect(html).not.toContain("Revisar vínculo")
  })

  it("com vários, um gesto só para todos", () => {
    const html = renderToStaticMarkup(
      <PreflightGateBanner gate={gate(["A_KEY", "B_KEY"])} onOpenSettings={noop} onOpenSecrets={noop} onContinueWithout={noop} />,
    )
    expect(html).toContain("O Keychain não entregou 2 segredos")
    expect(html).toContain("Enviar sem estes segredos")
  })
})
