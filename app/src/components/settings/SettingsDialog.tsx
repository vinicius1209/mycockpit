import { useEffect, useState, type ReactNode } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { Bot, Info, Mic, Palette, Sparkles, Waypoints, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RichSelect } from "@/components/ui/RichSelect"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useApp } from "@/store/app"
import { DESTINATIONS, agentModels, agentEfforts } from "@/lib/agents"
import { MissionSettings } from "@/components/settings/MissionSettings"
import { cn } from "@/lib/utils"

type Section =
  | "appearance"
  | "agents"
  | "suggestions"
  | "dictation"
  | "missions"
  | "about"

const SECTIONS: { id: Section; label: string; icon: typeof Bot }[] = [
  { id: "appearance", label: "Aparência", icon: Palette },
  { id: "agents", label: "Padrões", icon: Bot },
  { id: "suggestions", label: "Sugestões", icon: Sparkles },
  { id: "dictation", label: "Ditado", icon: Mic },
  { id: "missions", label: "Missions", icon: Waypoints },
  { id: "about", label: "Sobre", icon: Info },
]

const HELPER_OPTIONS = [
  { value: "off", label: "Desligado", description: "Sem sugestões automáticas" },
  { value: "haiku", label: "Haiku", description: "Rápido e barato (recomendado)" },
  { value: "sonnet", label: "Sonnet", description: "Mais capaz" },
  { value: "opus", label: "Opus", description: "Máxima qualidade" },
]

/** Linha rótulo + controle (uma preferência). */
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-foreground">{label}</div>
        {hint && (
          <div className="text-[11.5px] leading-snug text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
      {children}
    </h3>
  )
}

const SELECT_TRIGGER =
  "h-8 gap-1.5 rounded-md border bg-secondary/40 px-2.5 text-[13px] text-foreground data-[size=default]:h-8"

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen)
  const setOpen = useApp((s) => s.setSettingsOpen)
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const [section, setSection] = useState<Section>("appearance")
  const [vocabDraft, setVocabDraft] = useState("")
  const [version, setVersion] = useState("")

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {})
  }, [])

  function addVocab() {
    const t = vocabDraft.trim()
    if (!t || settings.dictationVocab.includes(t)) {
      setVocabDraft("")
      return
    }
    setSettings({ dictationVocab: [...settings.dictationVocab, t] })
    setVocabDraft("")
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[520px] gap-0 overflow-hidden rounded-xl border-border/60 p-0 shadow-[var(--shadow-pop)] sm:max-w-2xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Configurações</DialogTitle>
          <DialogDescription>Preferências do MyCockpit.</DialogDescription>
        </DialogHeader>

        {/* Rail de seções */}
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border/60 bg-rail p-2">
          <div className="px-2 pt-1 pb-2 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
            Configurações
          </div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md p-2 text-left text-[13px] transition-colors",
                section === s.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <span className="grid size-5 shrink-0 place-items-center">
                <s.icon className="size-4" />
              </span>
              {s.label}
            </button>
          ))}
        </nav>

        {/* Conteúdo */}
        <div className="relative flex-1 overflow-y-auto p-5">
          <button
            onClick={() => setOpen(false)}
            className="absolute top-3 right-3 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>

          {section === "appearance" && (
            <div>
              <SectionTitle>Aparência & layout</SectionTitle>
              <div className="divide-y divide-border/50">
                <Field
                  label="Tema claro"
                  hint="Sua escolha agora fica salva entre reinícios."
                >
                  <Switch
                    checked={theme === "light"}
                    onCheckedChange={() => toggleTheme()}
                    aria-label="Tema claro"
                  />
                </Field>
                <div className="pt-3 text-[11.5px] leading-snug text-muted-foreground">
                  Sidebar, painel de contexto e o modo (Linear/Fusion/SDD) também
                  são lembrados automaticamente ao reabrir o app.
                </div>
              </div>
            </div>
          )}

          {section === "agents" && (
            <div>
              <SectionTitle>Padrões de novas conversas</SectionTitle>
              <div className="divide-y divide-border/50">
                <Field label="Agent" hint="Pré-selecionado ao abrir uma conversa nova.">
                  <RichSelect
                    value={settings.defaultAgent}
                    onValueChange={(v) =>
                      // troca de agent → zera modelo/effort p/ o default do novo agent
                      setSettings({
                        defaultAgent: v,
                        defaultModel: null,
                        defaultEffort: null,
                      })
                    }
                    options={DESTINATIONS.filter((d) => d.available).map((d) => ({
                      value: d.id,
                      label: d.label,
                      description: d.description,
                    }))}
                    triggerClassName={SELECT_TRIGGER}
                    aria-label="Agent default"
                  />
                </Field>
                <Field label="Modelo">
                  <RichSelect
                    value={settings.defaultModel ?? "default"}
                    onValueChange={(v) =>
                      setSettings({ defaultModel: v === "default" ? null : v })
                    }
                    options={agentModels(settings.defaultAgent)}
                    triggerClassName={SELECT_TRIGGER}
                    aria-label="Modelo default"
                  />
                </Field>
                {agentEfforts(settings.defaultAgent).length > 0 && (
                  <Field label="Esforço">
                    <RichSelect
                      value={settings.defaultEffort ?? "default"}
                      onValueChange={(v) =>
                        setSettings({ defaultEffort: v === "default" ? null : v })
                      }
                      options={agentEfforts(settings.defaultAgent)}
                      triggerClassName={SELECT_TRIGGER}
                      aria-label="Effort default"
                    />
                  </Field>
                )}
              </div>
              <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">
                Conversas já iniciadas mantêm o config do 1º envio — isto vale só
                para novas.
              </p>
            </div>
          )}

          {section === "suggestions" && (
            <div>
              <SectionTitle>Sugestões</SectionTitle>
              <div className="divide-y divide-border/50">
                <Field
                  label="Modelo helper (padrão)"
                  hint="Usado quando o projeto não define um no .mycockpit/config.toml."
                >
                  <RichSelect
                    value={settings.helperModel ?? "off"}
                    onValueChange={(v) =>
                      setSettings({ helperModel: v === "off" ? null : v })
                    }
                    options={HELPER_OPTIONS}
                    triggerClassName={SELECT_TRIGGER}
                    aria-label="Modelo helper"
                  />
                </Field>
              </div>
            </div>
          )}

          {section === "dictation" && (
            <div>
              <SectionTitle>Ditado (pt-BR, on-device)</SectionTitle>
              <div className="divide-y divide-border/50">
                <Field
                  label="Ativar ditado"
                  hint="Mostra o botão de microfone no composer."
                >
                  <Switch
                    checked={settings.dictationEnabled}
                    onCheckedChange={(v) => setSettings({ dictationEnabled: v })}
                    aria-label="Ativar ditado"
                  />
                </Field>
                <div className="py-3">
                  <div className="text-[13px] text-foreground">
                    Vocabulário personalizado
                  </div>
                  <div className="mb-2 text-[11.5px] leading-snug text-muted-foreground">
                    Termos que o reconhecedor costuma errar (nomes de serviços,
                    siglas). Somados aos termos fixos.
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={vocabDraft}
                      onChange={(e) => setVocabDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          addVocab()
                        }
                      }}
                      placeholder="ex.: cadastro-pessoa-gateway"
                      className="h-8 text-[13px]"
                      disabled={!settings.dictationEnabled}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={addVocab}
                      disabled={!settings.dictationEnabled || !vocabDraft.trim()}
                    >
                      Adicionar
                    </Button>
                  </div>
                  {settings.dictationVocab.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {settings.dictationVocab.map((t) => (
                        <span
                          key={t}
                          className="flex items-center gap-1.5 rounded-md border bg-secondary/50 px-2 py-1 text-[12px] text-foreground/80"
                        >
                          {t}
                          <button
                            onClick={() =>
                              setSettings({
                                dictationVocab: settings.dictationVocab.filter(
                                  (x) => x !== t,
                                ),
                              })
                            }
                            className="text-muted-foreground hover:text-st-error"
                            aria-label={`Remover ${t}`}
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {section === "missions" && <MissionSettings />}

          {section === "about" && (
            <div>
              <SectionTitle>Sobre</SectionTitle>
              <div className="space-y-1 text-[13px]">
                <div className="font-medium text-foreground">MyCockpit</div>
                <div className="font-mono text-[12px] text-muted-foreground">
                  local{version ? ` · v${version}` : ""}
                </div>
                <p className="pt-2 text-[11.5px] leading-snug text-muted-foreground">
                  Cockpit de agents. Preferências globais ficam salvas localmente;
                  config por projeto vive no painel de contexto.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
