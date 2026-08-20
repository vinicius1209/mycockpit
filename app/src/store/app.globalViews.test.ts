import { beforeEach, describe, expect, it } from "vitest"
import { useApp } from "@/store/app"

beforeEach(() => {
  useApp.setState({
    viewMode: "linear",
    scheduledOpen: false,
    flightPlansOpen: false,
    fleetOpen: false,
    activeProjectId: "project-a",
  })
})

describe("workspaces globais", () => {
  it("Planos de voo e Agendado são mutuamente exclusivos", () => {
    useApp.getState().setScheduledOpen(true)
    expect(useApp.getState().scheduledOpen).toBe(true)

    useApp.getState().setFlightPlansOpen(true)
    expect(useApp.getState().flightPlansOpen).toBe(true)
    expect(useApp.getState().scheduledOpen).toBe(false)

    useApp.getState().setScheduledOpen(true)
    expect(useApp.getState().scheduledOpen).toBe(true)
    expect(useApp.getState().flightPlansOpen).toBe(false)
  })

  it("trocar de superfície fecha o workspace global", () => {
    useApp.getState().setFlightPlansOpen(true)
    useApp.getState().setViewMode("painel")

    expect(useApp.getState().viewMode).toBe("painel")
    expect(useApp.getState().flightPlansOpen).toBe(false)
  })

  it("trocar de projeto fecha o workspace global", () => {
    useApp.getState().setFlightPlansOpen(true)
    useApp.getState().setActiveProject("project-b")

    expect(useApp.getState().activeProjectId).toBe("project-b")
    expect(useApp.getState().flightPlansOpen).toBe(false)
  })

  it("Frota é mutuamente exclusiva com Agendado e Planos de voo", () => {
    useApp.getState().setScheduledOpen(true)
    useApp.getState().setFleetOpen(true)
    expect(useApp.getState().fleetOpen).toBe(true)
    expect(useApp.getState().scheduledOpen).toBe(false)

    useApp.getState().setFlightPlansOpen(true)
    expect(useApp.getState().flightPlansOpen).toBe(true)
    expect(useApp.getState().fleetOpen).toBe(false)

    useApp.getState().setFleetOpen(true)
    expect(useApp.getState().fleetOpen).toBe(true)
    expect(useApp.getState().flightPlansOpen).toBe(false)
  })

  it("trocar de superfície/projeto também fecha a Frota", () => {
    useApp.getState().setFleetOpen(true)
    useApp.getState().setViewMode("painel")
    expect(useApp.getState().fleetOpen).toBe(false)

    useApp.getState().setFleetOpen(true)
    useApp.getState().setActiveProject("project-b")
    expect(useApp.getState().fleetOpen).toBe(false)
  })
})
