// "Precisa de você" (ADR-268): a lista traz o gesto, e o vazio só é dito
// depois de olhar. Prometer "nada esperando" antes de ler o CLI seria teatro.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { AGENTS } from "@/lib/agents"
import { PrecisaDeVoce } from "./PrecisaDeVoce"

const global = AGENTS.find((a) => a.kind === "agent" && a.available && a.workMcpGlobalEnv)!
const render = (fatos: Parameters<typeof PrecisaDeVoce>[0]["fatos"]) =>
  renderToStaticMarkup(<PrecisaDeVoce fatos={fatos} onAbrir={vi.fn()} onResolvido={vi.fn()} />)

describe("PrecisaDeVoce", () => {
  it("motor sem acompanhamento: a linha diz o que falta e oferece Conectar ali mesmo", () => {
    const html = render({
      detected: { [global.id]: { installed: true, auth: "ok" } },
      trabalho: { [global.id]: "absent" },
    })
    expect(html).toContain(`${global.label} sem acompanhamento`)
    expect(html).toContain("Conectar")
    expect(html).toContain("Ver motor")
  })

  it("antes de ler o CLI, diz que está verificando, não que está tudo certo", () => {
    const html = render({})
    expect(html).toContain("Verificando")
    expect(html).not.toContain("Nada esperando")
  })

  it("lido e sem pendência: uma linha diz isso", () => {
    expect(render({ trabalho: {} })).toContain("Nada esperando por você")
  })

  it("leitura que falhou não vira 'tudo certo'", () => {
    const html = render({ trabalho: {}, trabalhoNaoVerificado: [global.id] })
    expect(html).not.toContain("Nada esperando")
    expect(html).toContain("não consegui verificar")
    expect(html).toContain(global.label)
  })
})
