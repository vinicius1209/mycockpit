import { type ChangeEvent, useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  Copy,
  Download,
  Maximize2,
  Minimize2,
  RotateCcw,
  Route,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { FlightPlanBuilder } from "@/components/mission/FlightPlanBuilder"
import { FlightPlanLibrary } from "@/components/mission/FlightPlanLibrary"
import { MissionsSection } from "@/components/layout/MissionsSection"
import {
  cloneFlightPlan,
  createFlightPlan,
  type FlightPlanKind,
} from "@/lib/flightPlanBuilder"
import { confirm } from "@/lib/confirm"
import { parseMissionPlan, serializeMissionPlan } from "@/lib/missionPlans"
import { DEFAULT_MISSION_PRESETS, type MissionPreset } from "@/lib/missionTypes"
import { useActiveProject, useApp } from "@/store/app"
import { cn } from "@/lib/utils"

function downloadPlan(plan: MissionPreset) {
  const blob = new Blob([serializeMissionPlan(plan)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  const slug = plan.name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "plano-de-voo"
  anchor.href = url
  anchor.download = `${slug}.frota-plan.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  toast(`Plano “${plan.name}” exportado.`)
}

export function FlightPlansView() {
  const plans = useApp((state) => state.settings.missionPresets)
  const missionEnabled = useApp((state) => state.settings.missionEnabled)
  const setSettings = useApp((state) => state.setSettings)
  const setFlightPlansOpen = useApp((state) => state.setFlightPlansOpen)
  const project = useActiveProject()
  const importInput = useRef<HTMLInputElement>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(plans[0]?.id ?? null)
  const [libraryOpen, setLibraryOpen] = useState(plans.length === 0)
  const [fullscreen, setFullscreen] = useState(false)
  const selectedPlanIndex = plans.findIndex((plan) => plan.id === selectedPlanId)
  const selectedPlan = selectedPlanIndex >= 0 ? plans[selectedPlanIndex] : null

  useEffect(() => {
    if (selectedPlan || plans.length === 0) return
    setSelectedPlanId(plans[0].id)
  }, [plans, selectedPlan])

  useEffect(() => {
    if (!fullscreen) return
    function leaveFullscreen(event: KeyboardEvent) {
      if (event.key === "Escape") setFullscreen(false)
    }
    window.addEventListener("keydown", leaveFullscreen)
    return () => window.removeEventListener("keydown", leaveFullscreen)
  }, [fullscreen])

  function savePlans(next: MissionPreset[]) {
    setSettings({ missionPresets: next })
  }

  function patchPlan(next: MissionPreset) {
    if (selectedPlanIndex < 0) return
    const current = plans[selectedPlanIndex]
    const versioned = {
      ...next,
      revision: (next.revision ?? 0) > (current.revision ?? 1)
        ? next.revision
        : (current.revision ?? 1) + 1,
    }
    savePlans(plans.map((plan, index) => index === selectedPlanIndex ? versioned : plan))
  }

  function openPlan(plan: MissionPreset) {
    setSelectedPlanId(plan.id)
    setLibraryOpen(false)
  }

  function addPlan(kind: FlightPlanKind) {
    const plan = createFlightPlan(kind)
    savePlans([...plans, plan])
    openPlan(plan)
  }

  function duplicateSelected() {
    if (!selectedPlan) return
    const duplicate = cloneFlightPlan(selectedPlan, { freshId: true })
    duplicate.name = `${selectedPlan.name} · cópia`
    savePlans([...plans, duplicate])
    openPlan(duplicate)
    toast("Plano duplicado.")
  }

  async function removeSelected() {
    if (!selectedPlan) return
    const accepted = await confirm({
      title: `Excluir “${selectedPlan.name}”?`,
      description: "O plano deixa de aparecer ao lançar uma Missão.",
      confirmLabel: "Excluir plano",
      danger: true,
    })
    if (!accepted) return
    const next = plans.filter((plan) => plan.id !== selectedPlan.id)
    savePlans(next)
    setSelectedPlanId(next[0]?.id ?? null)
    setFullscreen(false)
    setLibraryOpen(true)
  }

  async function restoreDefaults() {
    const accepted = await confirm({
      title: "Restaurar Planos de voo?",
      description: "Os planos atuais serão substituídos pelos três modelos de fábrica.",
      confirmLabel: "Restaurar",
      danger: true,
    })
    if (!accepted) return
    const next = DEFAULT_MISSION_PRESETS.map((plan) => cloneFlightPlan(plan))
    savePlans(next)
    setSelectedPlanId(next[0]?.id ?? null)
    setLibraryOpen(true)
  }

  async function importPlan(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const result = parseMissionPlan(await file.text())
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    const collision = plans.some((plan) => plan.id === result.plan.id)
    const plan = collision
      ? {
          ...result.plan,
          id: `plan-${crypto.randomUUID().slice(0, 8)}`,
          name: `${result.plan.name} · importado`,
        }
      : result.plan
    savePlans([...plans, plan])
    openPlan(plan)
    toast.success(`Plano “${plan.name}” importado.`)
  }

  function closeView() {
    setFullscreen(false)
    setFlightPlansOpen(false)
  }

  const content = (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden bg-background",
        fullscreen && "fixed inset-x-0 top-14 bottom-0 z-40 h-auto",
      )}
      data-flight-plan-fullscreen={fullscreen ? "true" : "false"}
    >
      <header className="flex h-16 shrink-0 items-center gap-4 border-b px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {!libraryOpen && selectedPlan ? (
            <Button
              variant="ghost"
              size="padrao"
              onClick={() => {
                setFullscreen(false)
                setLibraryOpen(true)
              }}
            >
              <ArrowLeft className="size-4" />
              Planos de voo
            </Button>
          ) : (
            <>
              <span className="grid size-8 place-items-center rounded-md bg-brass/10 text-brass">
                <Route className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-[14px] font-medium text-foreground">Planos de voo</h1>
                  <span className="rounded bg-brass/10 px-1.5 py-0.5 font-mono text-[11px] text-brass">
                    BETA
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  Desenhe o time, a rota e os limites que o motor de Missões executa.
                </p>
              </div>
            </>
          )}
        </div>

        <input
          ref={importInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void importPlan(event)}
        />

        <div className="flex items-center gap-1">
          {libraryOpen || !selectedPlan ? (
            <>
              <Button variant="ghost" size="padrao" onClick={() => importInput.current?.click()}>
                <Upload className="size-4" />
                Importar
              </Button>
              <Button variant="ghost" size="padrao" onClick={() => void restoreDefaults()}>
                <RotateCcw className="size-4" />
                Restaurar
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icone-padrao"
                onClick={() => downloadPlan(selectedPlan)}
                aria-label="Exportar plano"
                title="Exportar plano"
              >
                <Download className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icone-padrao"
                onClick={duplicateSelected}
                aria-label="Duplicar plano"
                title="Duplicar plano"
              >
                <Copy className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icone-padrao"
                onClick={() => void removeSelected()}
                className="hover:text-st-error"
                aria-label="Excluir plano"
                title="Excluir plano"
              >
                <Trash2 className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="padrao"
                onClick={() => setFullscreen((current) => !current)}
                aria-pressed={fullscreen}
                title={fullscreen ? "Sair da tela cheia (Esc)" : "Usar toda a área do Frota"}
              >
                {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                {fullscreen ? "Sair da tela cheia" : "Tela cheia"}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icone-padrao"
            onClick={closeView}
            aria-label="Fechar Planos de voo"
            title="Fechar"
          >
            <X className="size-4" />
          </Button>
        </div>
      </header>

      {libraryOpen || !selectedPlan ? (
        <FlightPlanLibrary
          plans={plans}
          onOpen={openPlan}
          onCreate={addPlan}
          historico={
            project ? <MissionsSection projectId={project.id} projectPath={project.path} /> : undefined
          }
        />
      ) : (
        <FlightPlanBuilder
          key={selectedPlan.id}
          plan={selectedPlan}
          project={project}
          missionEnabled={missionEnabled}
          onChange={patchPlan}
        />
      )}
    </div>
  )

  return content
}
