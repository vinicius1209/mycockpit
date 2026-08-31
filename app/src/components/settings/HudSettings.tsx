import { useEffect, useState } from "react"
import { MonitorUp, PanelTop } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RichSelect } from "@/components/ui/RichSelect"
import { Switch } from "@/components/ui/switch"
import { Field, Row } from "@/components/settings/parts"
import {
  HUD_POSITION_LABEL,
  hudRuntimeLabel,
  hudStatus,
  listenHudState,
  setHudExpanded,
  type HudPosition,
  type HudRuntimeView,
} from "@/lib/hud"
import { useApp } from "@/store/app"

const POSITIONS: Array<{
  value: HudPosition
  label: string
  description: string
}> = [
  {
    value: "notch",
    label: "Notch físico",
    description: "Mede a área segura da tela; sem notch, usa uma ilha no topo.",
  },
  {
    value: "island",
    label: "Ilha no topo",
    description: "Instrumento compacto centralizado, sem depender do hardware.",
  },
  {
    value: "left",
    label: "Borda esquerda",
    description: "Recolhido na lateral da tela ativa.",
  },
  {
    value: "right",
    label: "Borda direita",
    description: "Recolhido na lateral da tela ativa.",
  },
  {
    value: "bottom",
    label: "Base da tela",
    description: "Ilha compacta acima da borda inferior.",
  },
]

export function HudSettings() {
  const settings = useApp((state) => state.settings)
  const setSettings = useApp((state) => state.setSettings)
  const [runtime, setRuntime] = useState<HudRuntimeView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void hudStatus()
      .then((status) => {
        if (!disposed) setRuntime(status)
      })
      .catch((cause) => {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : String(cause))
      })
    void listenHudState((status) => {
      if (!disposed) {
        setRuntime(status)
        setError(null)
      }
    })
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((cause) => console.warn("Estado do instrumento indisponível:", cause))
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const measured = runtime?.screen
  const hardware = measured?.hasNotch
    ? `notch de ${Math.round(measured.notchWidth)} px`
    : "sem notch informado pelo sistema"

  return (
    <div className="border-t border-border/40 pt-1">
      <Field
        label="Instrumento fora da barra"
        hint="Mantém o estado real da frota visível na tela, sem abrir outro app ou navegador."
      >
        <Switch
          checked={settings.hudEnabled}
          onCheckedChange={(enabled) =>
            setSettings({
              hudEnabled: enabled,
              hudPosition:
                enabled && settings.hudPosition === "menubar"
                  ? "notch"
                  : settings.hudPosition,
            })
          }
          aria-label="Mostrar instrumento fora da barra de menus"
        />
      </Field>

      {settings.hudEnabled && (
        <>
          <Field
            label="Posição recolhida"
            hint="A Frota mede a tela ativa e aplica um fallback explícito quando necessário."
          >
            <RichSelect
              value={settings.hudPosition}
              options={POSITIONS}
              onValueChange={(value) =>
                setSettings({ hudPosition: value as HudPosition })
              }
              aria-label="Posição do instrumento"
            />
          </Field>
          <Field
            label="Expandir ao apontar"
            hint="O instrumento volta a recolher quando o ponteiro sai; clique fixa durante a interação."
          >
            <Switch
              checked={settings.hudHoverExpand}
              onCheckedChange={(hudHoverExpand) =>
                setSettings({ hudHoverExpand })
              }
              aria-label="Expandir instrumento ao apontar"
            />
          </Field>
          <Field
            label="Seguir a tela ativa"
            hint="Reposiciona quando a tela principal ou a configuração dos monitores muda."
          >
            <Switch
              checked={settings.hudFollowActiveScreen}
              onCheckedChange={(hudFollowActiveScreen) =>
                setSettings({ hudFollowActiveScreen })
              }
              aria-label="Seguir a tela ativa"
            />
          </Field>

          <ul className="mt-2">
            <Row
              glifo={
                runtime?.effectivePosition === "notch" ? (
                  <PanelTop className="size-4 text-muted-foreground" />
                ) : (
                  <MonitorUp className="size-4 text-muted-foreground" />
                )
              }
              titulo={hudRuntimeLabel(runtime)}
              dica={
                <>
                  {measured && (
                    <span className="block text-[11px]">
                      {measured.name} · {Math.round(measured.screenWidth)} ×{" "}
                      {Math.round(measured.screenHeight)} · {hardware}
                    </span>
                  )}
                  {runtime?.fallbackReason && (
                    <span className="mt-1 block text-[11px] text-st-warning">
                      {runtime.fallbackReason}
                    </span>
                  )}
                  {error && (
                    <span role="alert" className="mt-1 block text-[11px] text-st-error">
                      {error}
                    </span>
                  )}
                </>
              }
              direita={
                <Button
                  type="button"
                  size="compacto"
                  variant="outline"
                  disabled={!runtime?.enabled}
                  onClick={() => {
                    void setHudExpanded(!runtime?.expanded, !runtime?.expanded)
                      .then((status) => setRuntime(status))
                      .catch((cause) =>
                        setError(
                          cause instanceof Error ? cause.message : String(cause),
                        ),
                      )
                  }}
                >
                  {runtime?.expanded ? "Recolher" : "Mostrar agora"}
                </Button>
              }
            />
          </ul>
        </>
      )}

      {!settings.hudEnabled && (
        <p className="py-2 text-[12px] leading-snug text-muted-foreground">
          O clique no ícone continua abrindo o popover clássico na barra de
          menus. Nada aparece na tela sem você ligar esta opção.
        </p>
      )}
      {settings.hudEnabled && runtime && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          O ícone da barra de menus fica oculto enquanto este instrumento está
          ativo. Posição pedida: {HUD_POSITION_LABEL[runtime.requestedPosition]}.
          Posição efetiva: {HUD_POSITION_LABEL[runtime.effectivePosition]}.
        </p>
      )}
    </div>
  )
}
