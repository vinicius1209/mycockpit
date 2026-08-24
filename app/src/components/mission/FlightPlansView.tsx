import {
  type ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  Download,
  ListTree,
  Plus,
  RotateCcw,
  Route,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RichSelect } from "@/components/ui/RichSelect"
import { Textarea } from "@/components/ui/textarea"
import { MissionPlanCanvas } from "@/components/mission/MissionPlanCanvas"
import { LinearRouteEditor } from "@/components/mission/LinearRouteEditor"
import { useApp } from "@/store/app"
import { LEAGUE_DESTINATIONS, agentEfforts, agentModels } from "@/lib/agents"
import { confirm } from "@/lib/confirm"
import { GATE_POLICY_OPTIONS, normalizeGatePolicy } from "@/lib/missionDraft"
import {
  enableGraphMode,
  missionPlanMode,
  moveMissionPhase,
  parseMissionPlan,
  serializeMissionPlan,
  syncMissionPlan,
  validateMissionPlan,
} from "@/lib/missionPlans"
import {
  DEFAULT_MISSION_PRESETS,
  type MissionGatePolicy,
  type MissionPhaseDef,
  type MissionPersona,
  type MissionPreset,
} from "@/lib/missionTypes"
import { cn } from "@/lib/utils"
import { SELECTED_FILL } from "@/lib/selection"

const SELECT_TRIGGER =
  "h-8 w-full gap-1.5 rounded-md border bg-secondary/40 px-2.5 text-[12px] text-foreground data-[size=default]:h-8"

const PERSONA_OPTIONS = [
  { value: "planner", label: "Planner", description: "Desenha a abordagem" },
  { value: "executor", label: "Executor", description: "Realiza o trabalho" },
  { value: "reviewer", label: "Reviewer", description: "Verifica a entrega" },
]

const AUTONOMY_OPTIONS = [
  { value: "inherit", label: "Herdar projeto", description: "Respeita o modo da conversa" },
  { value: "auto", label: "Autônomo", description: "Segue sem pausas rotineiras" },
]

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

function clonePlan(source: MissionPreset, freshId = false): MissionPreset {
  return {
    ...source,
    id: freshId ? uid("plan") : source.id,
    phases: source.phases.map((phase) => ({
      ...phase,
      entryCriteria: phase.entryCriteria ? [...phase.entryCriteria] : undefined,
      exitCriteria: phase.exitCriteria ? [...phase.exitCriteria] : undefined,
    })),
    graph: source.graph
      ? {
          ...source.graph,
          nodes: source.graph.nodes.map((node) => ({
            ...node,
            position: { ...node.position },
          })),
          edges: source.graph.edges.map((edge) => ({ ...edge })),
        }
      : undefined,
  }
}

function newPhase(): MissionPhaseDef {
  return {
    id: uid("phase"),
    label: "Nova fase",
    persona: "executor",
    agent: "claude-code",
    model: null,
    effort: null,
    maxRetries: 1,
  }
}

function newLinearPlan(): MissionPreset {
  return {
    id: uid("plan"),
    name: "Novo plano linear",
    description: "Uma rota direta para uma tarefa bem definida.",
    mode: "linear",
    maxCostUsd: null,
    phases: [{ ...newPhase(), label: "Executar" }],
  }
}

function newCanvasPlan(): MissionPreset {
  return enableGraphMode({
    id: uid("plan"),
    name: "Novo plano no canvas",
    description: "Planejar, executar e revisar numa rota visual.",
    maxCostUsd: null,
    phases: [
      { ...newPhase(), label: "Planejar", persona: "planner" },
      { ...newPhase(), label: "Executar", agent: "codex", maxRetries: 2 },
      { ...newPhase(), label: "Revisar", persona: "reviewer" },
    ],
  })
}

function downloadPlan(preset: MissionPreset) {
  const blob = new Blob([serializeMissionPlan(preset)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  const slug =
    preset.name
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "plano-de-voo"
  anchor.download = `${slug}.mycockpit-plan.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  toast(`Plano “${preset.name}” exportado.`)
}

function criteriaText(criteria: string[] | undefined): string {
  return (criteria ?? []).join("\n")
}

export function FlightPlansView() {
  const presets = useApp((state) => state.settings.missionPresets)
  const missionEnabled = useApp((state) => state.settings.missionEnabled)
  const setSettings = useApp((state) => state.setSettings)
  const setFlightPlansOpen = useApp((state) => state.setFlightPlansOpen)
  const importInput = useRef<HTMLInputElement>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    presets[0]?.id ?? null,
  )
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(
    presets[0]?.phases[0]?.id ?? null,
  )

  const selectedPlanIndex = presets.findIndex((plan) => plan.id === selectedPlanId)
  const selectedPlan = selectedPlanIndex >= 0 ? presets[selectedPlanIndex] : null
  const selectedPhaseIndex =
    selectedPlan?.phases.findIndex((phase) => phase.id === selectedPhaseId) ?? -1
  const selectedPhase =
    selectedPlan && selectedPhaseIndex >= 0
      ? selectedPlan.phases[selectedPhaseIndex]
      : null
  const mode = selectedPlan ? missionPlanMode(selectedPlan) : "linear"
  const errors = selectedPlan ? validateMissionPlan(selectedPlan) : []
  const selectedEfforts = selectedPhase ? agentEfforts(selectedPhase.agent) : []

  useEffect(() => {
    if (selectedPlan && selectedPhase) return
    const fallbackPlan = selectedPlan ?? presets[0] ?? null
    setSelectedPlanId(fallbackPlan?.id ?? null)
    setSelectedPhaseId(fallbackPlan?.phases[0]?.id ?? null)
  }, [presets, selectedPhase, selectedPlan])

  function savePresets(next: MissionPreset[]) {
    setSettings({ missionPresets: next })
  }

  function patchPlan(next: MissionPreset) {
    if (selectedPlanIndex < 0) return
    const current = presets[selectedPlanIndex]
    const versioned = {
      ...next,
      revision:
        (next.revision ?? 0) > (current.revision ?? 1)
          ? next.revision
          : (current.revision ?? 1) + 1,
    }
    savePresets(
      presets.map((plan, index) =>
        index === selectedPlanIndex ? versioned : plan,
      ),
    )
  }

  function selectPlan(plan: MissionPreset) {
    setSelectedPlanId(plan.id)
    setSelectedPhaseId(plan.phases[0]?.id ?? null)
  }

  function addPlan(kind: "linear" | "graph") {
    const plan = kind === "graph" ? newCanvasPlan() : newLinearPlan()
    savePresets([...presets, plan])
    selectPlan(plan)
  }

  function duplicateSelected() {
    if (!selectedPlan) return
    const duplicate = clonePlan(selectedPlan, true)
    duplicate.name = `${selectedPlan.name} · cópia`
    savePresets([...presets, duplicate])
    selectPlan(duplicate)
    toast("Plano duplicado.")
  }

  async function removeSelected() {
    if (!selectedPlan) return
    const ok = await confirm({
      title: `Excluir “${selectedPlan.name}”?`,
      description: "O plano deixa de aparecer no launcher de Missions.",
      confirmLabel: "Excluir plano",
      danger: true,
    })
    if (!ok) return
    const next = presets.filter((plan) => plan.id !== selectedPlan.id)
    savePresets(next)
    setSelectedPlanId(next[0]?.id ?? null)
    setSelectedPhaseId(next[0]?.phases[0]?.id ?? null)
  }

  async function restoreDefaults() {
    const ok = await confirm({
      title: "Restaurar Planos de voo?",
      description: "Os planos atuais serão substituídos pelos três modelos de fábrica.",
      confirmLabel: "Restaurar",
      danger: true,
    })
    if (!ok) return
    const next = DEFAULT_MISSION_PRESETS.map((plan) => clonePlan(plan))
    savePresets(next)
    selectPlan(next[0])
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
    const collision = presets.some((plan) => plan.id === result.plan.id)
    const plan = collision
      ? { ...result.plan, id: uid("plan"), name: `${result.plan.name} · importado` }
      : result.plan
    savePresets([...presets, plan])
    selectPlan(plan)
    toast.success(`Plano “${plan.name}” importado.`)
  }

  function patchPhase(patch: Partial<MissionPhaseDef>) {
    if (!selectedPlan || selectedPhaseIndex < 0) return
    patchPlan({
      ...selectedPlan,
      phases: selectedPlan.phases.map((phase, index) =>
        index === selectedPhaseIndex ? { ...phase, ...patch } : phase,
      ),
    })
  }

  function addPhase() {
    if (!selectedPlan) return
    const phase = newPhase()
    patchPlan(
      syncMissionPlan({
        ...selectedPlan,
        phases: [...selectedPlan.phases, phase],
      }),
    )
    setSelectedPhaseId(phase.id)
  }

  function removePhase() {
    if (!selectedPlan || selectedPhaseIndex < 0 || selectedPlan.phases.length <= 1) return
    const nextPhases = selectedPlan.phases.filter((_, index) => index !== selectedPhaseIndex)
    patchPlan(syncMissionPlan({ ...selectedPlan, phases: nextPhases }))
    setSelectedPhaseId(nextPhases[Math.min(selectedPhaseIndex, nextPhases.length - 1)]?.id ?? null)
  }

  function movePhase(delta: -1 | 1) {
    if (!selectedPlan || selectedPhaseIndex < 0) return
    const moved = moveMissionPhase(
      enableGraphMode(selectedPlan),
      selectedPhaseIndex,
      selectedPhaseIndex + delta,
    )
    patchPlan(mode === "linear" ? { ...moved, mode: "linear" } : moved)
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b px-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Route className="size-4 text-brass" />
            <h1 className="label-mono text-foreground">Planos de voo</h1>
            <span className="rounded border border-brass/30 bg-brass/10 px-1.5 py-px font-mono text-[11px] text-brass">
              BETA
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            Desenhe o time, a ordem e os critérios que o motor de Mission executa.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void importPlan(event)}
          />
          <Button variant="ghost" size="sm" onClick={() => importInput.current?.click()}>
            <Upload className="size-3.5" />
            Importar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void restoreDefaults()}>
            <RotateCcw className="size-3.5" />
            Restaurar
          </Button>
          <button
            type="button"
            onClick={() => setFlightPlansOpen(false)}
            className="ml-1 grid size-8 place-items-center rounded-md border border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Fechar Planos de voo"
          >
            <X className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r bg-secondary/10">
          <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
            <span className="label-mono">Biblioteca</span>
            <span className="font-mono text-[11px] text-muted-foreground">{presets.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="space-y-1">
              {presets.map((plan) => {
                const active = plan.id === selectedPlan?.id
                const planMode = missionPlanMode(plan)
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => selectPlan(plan)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                      active
                        ? SELECTED_FILL
                        : "border-transparent hover:bg-sel-hover",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          "mt-0.5 grid size-5 shrink-0 place-items-center rounded",
                          // Identidade do plano (linear × grafo), nunca "ativo":
                          // a silhueta do ícone já distingue, e tingi-la por
                          // seleção era a terceira linguagem de ativo (§2).
                          "bg-secondary text-muted-foreground",
                        )}
                      >
                        {planMode === "graph" ? (
                          <Route className="size-3" />
                        ) : (
                          <ListTree className="size-3" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-foreground">
                          {plan.name || "Plano sem nome"}
                        </span>
                        <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                          {plan.phases.length} trechos · {planMode === "graph" ? "fluxo" : "rota"}
                        </span>
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
            {presets.length === 0 && (
              <div className="mt-8 px-3 text-center text-[11px] leading-relaxed text-muted-foreground">
                Sua biblioteca está vazia. Crie uma rota abaixo ou restaure os modelos.
              </div>
            )}
          </div>
          <div className="shrink-0 space-y-1.5 border-t p-2">
            <Button variant="secondary" size="sm" className="w-full justify-start" onClick={() => addPlan("graph")}>
              <Route className="size-3.5 text-brass" />
              Novo fluxo visual
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => addPlan("linear")}>
              <ListTree className="size-3.5" />
              Nova rota
            </Button>
          </div>
        </aside>

        {selectedPlan ? (
          <>
            <main className="flex min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Input
                    value={selectedPlan.name}
                    onChange={(event) => patchPlan({ ...selectedPlan, name: event.target.value })}
                    className="h-8 border-transparent bg-transparent px-1 text-[14px] font-medium shadow-none hover:border-border/60 focus-visible:border-brass/50"
                    aria-label="Nome do Plano de voo"
                  />
                  <Input
                    value={selectedPlan.description ?? ""}
                    onChange={(event) => patchPlan({ ...selectedPlan, description: event.target.value })}
                    placeholder="Quando usar este plano?"
                    className="h-7 border-transparent bg-transparent px-1 text-[11px] text-muted-foreground shadow-none hover:border-border/60 focus-visible:border-brass/50"
                    aria-label="Descrição do Plano de voo"
                  />
                </div>
                <div className="flex shrink-0 rounded-md border border-border/70 bg-secondary/35 p-0.5">
                  <button
                    type="button"
                    onClick={() => patchPlan({ ...selectedPlan, mode: "linear" })}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] transition-colors",
                      mode === "linear" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <ListTree className="size-3.5" />
                    Rota
                  </button>
                  <button
                    type="button"
                    onClick={() => patchPlan(enableGraphMode(selectedPlan))}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] transition-colors",
                      // Segmentado é a exceção fechada do §2 (E1: bg-card +
                      // sombra). O irmão "Linear" já era assim; este estava em
                      // brass, o mesmo widget com duas linguagens de "ativo".
                      mode === "graph" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Route className="size-3.5" />
                    Fluxo visual
                  </button>
                </div>
                <Button variant="outline" size="sm" onClick={addPhase}>
                  <Plus className="size-3.5" />
                  Nó
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {mode === "linear" ? (
                  <LinearRouteEditor
                    preset={selectedPlan}
                    onChange={patchPlan}
                    selectedPhaseId={selectedPhaseId}
                    onSelectPhase={setSelectedPhaseId}
                    className="mx-auto max-w-3xl px-2 py-3"
                  />
                ) : (
                  <MissionPlanCanvas
                    preset={selectedPlan}
                    onChange={patchPlan}
                    selectedPhaseId={selectedPhaseId}
                    onSelectPhase={setSelectedPhaseId}
                    interactive
                    className="h-full min-h-[34rem] rounded-xl"
                  />
                )}
              </div>

              <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-t px-4">
                <div className="flex min-w-0 items-center gap-2">
                  {errors.length === 0 ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-st-success" />
                  ) : (
                    <AlertTriangle className="size-3.5 shrink-0 text-st-warning" />
                  )}
                  <span className="truncate text-[11px] text-muted-foreground">
                    {errors[0] ?? "Este mapa está pronto para ser executado por uma Missão."}
                  </span>
                </div>
                <span className={cn("font-mono text-[11px] uppercase", missionEnabled ? "text-st-success" : "text-muted-foreground")}>
                  Missions {missionEnabled ? "ativas" : "desativadas"}
                </span>
              </div>
            </main>

            <aside className="flex w-[19rem] shrink-0 flex-col border-l bg-secondary/10">
              <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
                <span className="label-mono">Inspetor</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => movePhase(-1)}
                    disabled={selectedPhaseIndex <= 0}
                    className="grid size-7 place-items-center rounded border border-border/60 text-muted-foreground hover:text-brass disabled:opacity-30"
                    aria-label="Mover fase para antes"
                  >
                    <ArrowLeft className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => movePhase(1)}
                    disabled={selectedPhaseIndex < 0 || selectedPhaseIndex >= selectedPlan.phases.length - 1}
                    className="grid size-7 place-items-center rounded border border-border/60 text-muted-foreground hover:text-brass disabled:opacity-30"
                    aria-label="Mover fase para depois"
                  >
                    <ArrowRight className="size-3.5" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {selectedPhase ? (
                  <div className="divide-y divide-border/60">
                    <section className="space-y-2.5 p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] tracking-wide text-brass uppercase">
                          Trecho {String(selectedPhaseIndex + 1).padStart(2, "0")}
                        </span>
                        <button
                          type="button"
                          onClick={removePhase}
                          disabled={selectedPlan.phases.length <= 1}
                          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-st-error disabled:opacity-30"
                          aria-label="Remover fase"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                      <label className="grid gap-1 text-[11px] text-muted-foreground">
                        Nome do nó
                        <Input value={selectedPhase.label} onChange={(event) => patchPhase({ label: event.target.value })} className="h-8 text-[12px]" />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="grid gap-1 text-[11px] text-muted-foreground">
                          Papel
                          <RichSelect value={selectedPhase.persona} onValueChange={(value) => patchPhase({ persona: value as MissionPersona })} options={PERSONA_OPTIONS} triggerClassName={SELECT_TRIGGER} />
                        </label>
                        <label className="grid gap-1 text-[11px] text-muted-foreground">
                          Code agent
                          <RichSelect
                            value={selectedPhase.agent}
                            onValueChange={(value) => patchPhase({ agent: value, model: null, effort: null })}
                            options={LEAGUE_DESTINATIONS.map((agent) => ({ value: agent.id, label: agent.label, description: agent.description }))}
                            triggerClassName={SELECT_TRIGGER}
                          />
                        </label>
                        <label className="grid gap-1 text-[11px] text-muted-foreground">
                          Modelo
                          <RichSelect value={selectedPhase.model ?? "default"} onValueChange={(value) => patchPhase({ model: value === "default" ? null : value })} options={agentModels(selectedPhase.agent)} triggerClassName={SELECT_TRIGGER} />
                        </label>
                        <label className="grid gap-1 text-[11px] text-muted-foreground">
                          Effort
                          {selectedEfforts.length > 0 ? (
                            <RichSelect
                              value={selectedPhase.effort ?? "default"}
                              onValueChange={(value) =>
                                patchPhase({
                                  effort: value === "default" ? null : value,
                                })
                              }
                              options={selectedEfforts}
                              triggerClassName={SELECT_TRIGGER}
                            />
                          ) : (
                            <div className="flex h-8 items-center rounded-md border bg-secondary/20 px-2.5 text-[11px] text-muted-foreground/70">
                              no modelo
                            </div>
                          )}
                        </label>
                      </div>
                      <div className="grid grid-cols-[1fr_5rem] gap-2">
                        <label className="grid gap-1 text-[11px] text-muted-foreground">
                          Autonomia
                          <RichSelect value={selectedPhase.autonomy ?? "inherit"} onValueChange={(value) => patchPhase({ autonomy: value as "auto" | "inherit" })} options={AUTONOMY_OPTIONS} triggerClassName={SELECT_TRIGGER} />
                        </label>
                        <label className="grid gap-1 text-[11px] text-muted-foreground">
                          Tentativas
                          <Input type="number" min={1} value={selectedPhase.maxRetries} onChange={(event) => patchPhase({ maxRetries: Math.max(1, Number(event.target.value) || 1) })} className="h-8 text-[12px]" />
                        </label>
                      </div>
                    </section>

                    <section className="space-y-2.5 p-3">
                      <h2 className="label-mono">Critérios</h2>
                      <label className="grid gap-1 text-[11px] text-muted-foreground">
                        Entrada · um por linha
                        <Textarea value={criteriaText(selectedPhase.entryCriteria)} onChange={(event) => patchPhase({ entryCriteria: event.target.value.split("\n") })} placeholder="Ex.: plano aprovado" className="min-h-20 resize-y text-[11px]" />
                      </label>
                      <label className="grid gap-1 text-[11px] text-muted-foreground">
                        Saída · um por linha
                        <Textarea value={criteriaText(selectedPhase.exitCriteria)} onChange={(event) => patchPhase({ exitCriteria: event.target.value.split("\n") })} placeholder="Ex.: testes passam" className="min-h-20 resize-y text-[11px]" />
                      </label>
                      <label className="grid gap-1 text-[11px] text-muted-foreground">
                        Instrução específica
                        <Textarea value={selectedPhase.instructions ?? ""} onChange={(event) => patchPhase({ instructions: event.target.value })} placeholder="Contexto adicional para este agent" className="min-h-24 resize-y text-[11px]" />
                      </label>
                    </section>
                  </div>
                ) : (
                  <div className="p-5 text-center text-[11px] text-muted-foreground">
                    Selecione um nó no canvas para editar.
                  </div>
                )}

                <section className="space-y-2.5 border-t border-border/60 p-3">
                  <h2 className="label-mono">Plano</h2>
                  <label className="grid gap-1 text-[11px] text-muted-foreground">
                    Gate humano
                    <RichSelect
                      value={normalizeGatePolicy(selectedPlan.gatePolicy)}
                      onValueChange={(value) => patchPlan({ ...selectedPlan, gatePolicy: value as MissionGatePolicy })}
                      options={GATE_POLICY_OPTIONS}
                      triggerClassName={SELECT_TRIGGER}
                    />
                  </label>
                  <label className="grid gap-1 text-[11px] text-muted-foreground">
                    Teto de custo em US$ · vazio = sem teto
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={selectedPlan.maxCostUsd ?? ""}
                      onChange={(event) => {
                        const raw = event.target.value.trim()
                        patchPlan({ ...selectedPlan, maxCostUsd: raw === "" ? null : Math.max(0, Number(raw) || 0) })
                      }}
                      placeholder="Sem teto"
                      className="h-8 text-[12px]"
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-1 pt-1">
                    <Button variant="ghost" size="sm" onClick={() => downloadPlan(selectedPlan)} title="Exportar plano">
                      <Download className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={duplicateSelected} title="Duplicar plano">
                      <Copy className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void removeSelected()} title="Excluir plano" className="hover:text-st-error">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </section>
              </div>
            </aside>
          </>
        ) : (
          <div className="grid min-w-0 flex-1 place-items-center p-8 text-center">
            <div className="max-w-sm">
              <Route className="mx-auto size-8 text-brass/60" />
              <h2 className="mt-4 text-[14px] font-medium">Desenhe sua primeira rota</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                Comece no Fluxo visual para desenhar decisões ou use Rota para uma sequência simples.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" onClick={() => addPlan("graph")}><Route className="size-3.5" />Fluxo visual</Button>
                <Button size="sm" variant="outline" onClick={() => addPlan("linear")}><ListTree className="size-3.5" />Rota</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
