import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { PlanMilestone } from "@/components/chat/PlanMilestone"
import type { AgentPlan } from "@/lib/tasks"

// Carimbo REAL de uma tarefa do turno cortado em 09/09/2026 (SQLite do app).
const NASCIMENTO = 1_788_962_190_605

const plano: AgentPlan = {
  id: "plano-coleta",
  turnId: "u-coleta",
  anchorId: "t-coleta",
  tasks: [
    {
      id: "1",
      title: "Consultar funis no banco local",
      description: null,
      active: null,
      status: "in_progress",
    },
  ],
  reportedUpdates: 0,
  createdAt: NASCIMENTO,
  terminal: null,
}

afterEach(() => {
  vi.useRealTimers()
})

describe("PlanMilestone: entrada só para o plano que nasce agora", () => {
  it("plano publicado agora entra deslizando", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NASCIMENTO + 50)
    const html = renderToStaticMarkup(<PlanMilestone plan={plano} live />)
    expect(html).toContain("fio-nasce-desliza")
  })

  it("reabrir a conversa no dia seguinte não reencena a chegada", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NASCIMENTO + 86_400_000)
    const html = renderToStaticMarkup(<PlanMilestone plan={plano} live={false} />)
    expect(html).not.toContain("fio-nasce-desliza")
    expect(html).not.toContain("animate-cockpit-rise")
  })

  it("plano legado sem carimbo chega pronto", () => {
    const { createdAt: _semCarimbo, ...legado } = plano
    const html = renderToStaticMarkup(<PlanMilestone plan={legado} live={false} />)
    expect(html).not.toContain("fio-nasce-desliza")
  })
})
