import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { GitStatus } from "@/lib/git"
import type { EstadoDoRepo } from "@/lib/gitSync"
import { BotaoDeSincronia } from "./BotaoDeSincronia"

const NOW = Date.UTC(2026, 8, 28, 15, 0)
const status: GitStatus = { isRepo: true, branch: "main", upstream: "origin/main", ahead: 0, behind: 0, staged: [], unstaged: [] }
const estado: EstadoDoRepo = {
  ultimaBusca: NOW - 3 * 3_600_000,
  remotoGithub: true,
  temRemoto: true,
  operacao: null,
  conflitos: [],
  guardadas: 0,
}

function render(s: Partial<GitStatus>, e: Partial<EstadoDoRepo> = {}) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(BotaoDeSincronia, { cwd: "/fake", status: { ...status, ...s }, estado: { ...estado, ...e }, now: NOW }),
    ),
  )
}

describe("BotaoDeSincronia", () => {
  it("à frente mostra só a contagem, e o nome do gesto vai no aria-label", () => {
    const html = render({ ahead: 3 })
    expect(html).toContain('aria-label="Enviar 3 commits"')
    expect(html).toContain(">3<")
    expect(html).not.toContain(">Enviar<")
  })

  it("dos dois lados, as duas contagens no mesmo botão", () => {
    const html = render({ ahead: 3, behind: 2 })
    expect(html).toContain('aria-label="Trazer 2 e enviar 3"')
    expect(html).toContain(">2<")
    expect(html).toContain(">3<")
  })

  it("sem upstream o botão publica, e sem remoto ele não existe", () => {
    expect(render({ upstream: null })).toContain('aria-label="Publicar branch"')
    expect(render({ ahead: 3 }, { temRemoto: false })).toBe("")
  })
})
