import { LockKeyhole, ShieldAlert, ShieldCheck } from "lucide-react"
import { Input } from "@/components/ui/input"
import { RichSelect } from "@/components/ui/RichSelect"
import { confirm } from "@/lib/confirm"
import { GATE_POLICY_OPTIONS, normalizeGatePolicy } from "@/lib/missionDraft"
import {
  PERMISSION_DESCRIPTION,
  PERMISSION_LABEL,
  effectivePermission,
  setProjectPermissionEverywhere,
} from "@/lib/permission"
import {
  phasePermission,
  type MissionGatePolicy,
  type MissionPhaseDef,
  type MissionPreset,
} from "@/lib/missionTypes"
import type { PermissionMode, Project } from "@/lib/types"

const SELECT_TRIGGER =
  "h-8 w-full gap-1.5 rounded-md border bg-secondary/40 px-2.5 text-[12px] text-foreground data-[size=default]:h-8"

const PROJECT_PERMISSION_OPTIONS: {
  value: PermissionMode
  label: string
  description: string
  badge?: string
}[] = (["leitura", "padrao", "auto", "liberado"] as const).map((mode) => ({
  value: mode,
  label: PERMISSION_LABEL[mode],
  description: PERMISSION_DESCRIPTION[mode],
  ...(mode === "liberado" ? { badge: "YOLO" } : {}),
}))

const AUTONOMY_OPTIONS = [
  {
    value: "inherit",
    label: "Herdar projeto",
    description: "Usa a permissão escolhida para o projeto.",
  },
  {
    value: "auto",
    label: "Autônomo",
    description: "Remove pausas rotineiras sem ultrapassar o teto do projeto.",
  },
]

export function FlightPlanSafetyInspector({
  plan,
  phase,
  project,
  onPatchPlan,
  onPatchPhase,
}: {
  plan: MissionPreset
  phase: MissionPhaseDef | null
  project: Project | null
  onPatchPlan: (next: MissionPreset) => void
  onPatchPhase: (patch: Partial<MissionPhaseDef>) => void
}) {
  const projectMode = effectivePermission(project)
  const effectivePhaseMode = phase
    ? (phasePermission(projectMode, phase) as PermissionMode)
    : null

  async function changeProjectPermission(mode: PermissionMode) {
    if (!project || mode === projectMode) return
    if (mode === "liberado") {
      const accepted = await confirm({
        title: `Liberar ações sem confirmação em “${project.name}”?`,
        description:
          "Este é o modo YOLO do projeto. Os agents podem executar e escrever sem pedir confirmação, inclusive nas fases deste plano.",
        confirmLabel: "Usar Liberado",
        danger: true,
      })
      if (!accepted) return
    }
    setProjectPermissionEverywhere(project, mode)
  }

  return (
    <div className="divide-y divide-border/40">
      <section className="space-y-3 p-3">
        <div>
          <h2 className="label-mono text-foreground">Permissão do projeto</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            É o teto de segurança de todas as fases. Alterar aqui também altera o projeto ativo.
          </p>
        </div>

        {project ? (
          <label className="grid gap-1 text-[11px] text-muted-foreground">
            Projeto {project.name}
            <RichSelect
              value={projectMode}
              onValueChange={(value) => void changeProjectPermission(value as PermissionMode)}
              options={PROJECT_PERMISSION_OPTIONS}
              triggerClassName={SELECT_TRIGGER}
            />
          </label>
        ) : (
          <div className="rounded-lg border bg-secondary/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
            Abra um projeto para configurar a permissão que será usada no lançamento.
          </div>
        )}

        {projectMode === "liberado" && (
          <div className="flex items-start gap-2 rounded-lg border border-st-warning/40 bg-st-warning/10 p-3 text-[11px] leading-relaxed text-st-warning">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong className="font-medium">Liberado está ativo.</strong> O plano não pedirá confirmação para comandos ou escrita.
            </span>
          </div>
        )}
      </section>

      <section className="space-y-3 p-3">
        <div>
          <h2 className="label-mono text-foreground">Autonomia da fase</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Autonomia remove pausas rotineiras, mas nunca concede mais acesso que o projeto.
          </p>
        </div>
        {phase ? (
          <>
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              {phase.label || "Fase sem nome"}
              <RichSelect
                value={phase.autonomy ?? "inherit"}
                onValueChange={(value) => onPatchPhase({ autonomy: value as "auto" | "inherit" })}
                options={AUTONOMY_OPTIONS}
                triggerClassName={SELECT_TRIGGER}
              />
            </label>
            {effectivePhaseMode && (
              <div className="flex items-start gap-2 rounded-lg bg-secondary/35 p-3">
                {effectivePhaseMode === "leitura" ? (
                  <LockKeyhole className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <div>
                  <div className="text-[12px] font-medium text-foreground">
                    Efetivo: {PERMISSION_LABEL[effectivePhaseMode]}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {PERMISSION_DESCRIPTION[effectivePhaseMode]}
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Selecione uma fase para ajustar sua autonomia.
          </p>
        )}
      </section>

      <section className="space-y-3 p-3">
        <div>
          <h2 className="label-mono text-foreground">Decisão humana</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            O gate controla quando a missão para e devolve a decisão para você.
          </p>
        </div>
        <label className="grid gap-1 text-[11px] text-muted-foreground">
          Gate da missão
          <RichSelect
            value={normalizeGatePolicy(plan.gatePolicy)}
            onValueChange={(value) => onPatchPlan({ ...plan, gatePolicy: value as MissionGatePolicy })}
            options={GATE_POLICY_OPTIONS}
            triggerClassName={SELECT_TRIGGER}
          />
        </label>
        <label className="grid gap-1 text-[11px] text-muted-foreground">
          Teto de custo em US$, vazio significa sem teto
          <Input
            type="number"
            min={0.5}
            step="0.5"
            value={plan.maxCostUsd ?? ""}
            onChange={(event) => {
              const raw = event.target.value.trim()
              const parsed = Number(raw)
              onPatchPlan({
                ...plan,
                maxCostUsd: raw === "" ? null : Number.isFinite(parsed) ? Math.max(0.5, parsed) : 0.5,
              })
            }}
            placeholder="Sem teto"
            className="h-8 text-[12px]"
          />
        </label>
      </section>
    </div>
  )
}
