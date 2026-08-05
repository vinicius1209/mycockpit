import { ListTree, Route } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useApp } from "@/store/app"
import { missionPlanMode } from "@/lib/missionPlans"

export function MissionSettings() {
  const settings = useApp((state) => state.settings)
  const setSettings = useApp((state) => state.setSettings)
  const setSettingsOpen = useApp((state) => state.setSettingsOpen)
  const setFlightPlansOpen = useApp((state) => state.setFlightPlansOpen)
  const canvasCount = settings.missionPresets.filter(
    (plan) => missionPlanMode(plan) === "graph",
  ).length

  function openFlightPlans() {
    setSettingsOpen(false)
    setFlightPlansOpen(true)
  }

  return (
    <div>
      <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
        Missions (beta)
      </h3>
      <div className="divide-y divide-border/50">
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <div className="text-[13px] text-foreground">Ativar Missions</div>
            <div className="text-[11.5px] leading-snug text-muted-foreground">
              Exibe o lançamento de missões no composer. Cada missão executa um
              Plano de voo salvo.
            </div>
          </div>
          <Switch
            checked={settings.missionEnabled}
            onCheckedChange={(missionEnabled) => setSettings({ missionEnabled })}
            aria-label="Ativar Missions"
          />
        </div>

        <div className="py-4">
          <div className="rounded-xl border border-border/70 bg-secondary/20 p-3.5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brass/10 text-brass">
                <Route className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-foreground">
                  Planos de voo agora têm uma prancheta própria
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Edite a biblioteca, o canvas e as propriedades dos nós numa
                  área ampla. As alterações continuam salvas globalmente e
                  aparecem no launcher de Missions.
                </p>
                <div className="mt-3 flex items-center gap-3 font-mono text-[9.5px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <ListTree className="size-3" />
                    {settings.missionPresets.length} planos
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Route className="size-3 text-brass" />
                    {canvasCount} no canvas
                  </span>
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="mt-4 w-full justify-center"
              onClick={openFlightPlans}
            >
              <Route className="size-3.5 text-brass" />
              Abrir Planos de voo
            </Button>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
            Você também pode abrir pela seção Geral, na barra lateral.
          </p>
        </div>
      </div>
    </div>
  )
}
