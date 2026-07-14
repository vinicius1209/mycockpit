import { useEffect, useState, type ReactNode } from "react"
import { getVersion } from "@tauri-apps/api/app"
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  Cpu,
  Info,
  Mic,
  Palette,
  RotateCcw,
  Sparkles,
  Waypoints,
  X,
} from "lucide-react"
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
import { DESTINATIONS, agentDef, agentModels, agentEfforts } from "@/lib/agents"
import {
  detectAgents,
  refreshAgyModels,
  toProbeMap,
  updateAvailable,
  UPDATE_COMMANDS,
} from "@/lib/detect"
import {
  getModelsCatalog,
  refreshCatalogIntoSettings,
  type CatalogModel,
} from "@/lib/catalog"
import { catalogEntryFor, reloadActiveProposals } from "@/lib/modelCurator"
import {
  listModelProposals,
  setModelProposalStatus,
  type ModelProposal,
} from "@/lib/db"
import { MissionSettings } from "@/components/settings/MissionSettings"
import { cn } from "@/lib/utils"

type Section =
  | "appearance"
  | "agents"
  | "tools"
  | "suggestions"
  | "dictation"
  | "missions"
  | "about"

const SECTIONS: { id: Section; label: string; icon: typeof Bot }[] = [
  { id: "appearance", label: "Aparência", icon: Palette },
  { id: "agents", label: "Padrões", icon: Bot },
  { id: "tools", label: "Agents", icon: Cpu },
  { id: "suggestions", label: "Sugestões", icon: Sparkles },
  { id: "dictation", label: "Ditado", icon: Mic },
  { id: "missions", label: "Missions", icon: Waypoints },
  { id: "about", label: "Sobre", icon: Info },
]

/** Agents que a seção "Agents" lista (na ordem), com o rótulo do checklist. */
const AGENT_TOOLS: { id: string; label: string; sub: string }[] = [
  { id: "claude-code", label: "Claude Code", sub: "CLI da Anthropic" },
  { id: "codex", label: "Codex", sub: "CLI da OpenAI" },
  { id: "agy", label: "Antigravity", sub: "CLI do Google" },
]

function fmtCheckedAt(ts: number): string {
  if (!ts) return "nunca"
  const m = Math.floor((Date.now() - ts) / 60_000)
  if (m < 1) return "agora"
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

/** "$3 in · $15 out por 1M tokens" (preço do catálogo p/ uma proposta). */
function fmtCatalogPrice(m: CatalogModel | undefined): string | null {
  if (!m || (m.input == null && m.output == null)) return null
  const f = (v: number | null) => (v == null ? "?" : `$${v}`)
  return `${f(m.input)} in · ${f(m.output)} out por 1M tokens`
}

/** Seção "Agents": versão instalada × última oficial, comando de update
 *  copiável e re-verificação manual. Mesmo visual do checklist do onboarding. */
function AgentsToolsSection() {
  const detected = useApp((s) => s.settings.detected)
  const lastUpdateCheck = useApp((s) => s.settings.lastUpdateCheck)
  const catalogCount = useApp((s) => s.settings.catalogCount)
  const lastCatalogRefresh = useApp((s) => s.settings.lastCatalogRefresh)
  const setSettings = useApp((s) => s.setSettings)
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  // Gate humano do curador: propostas pendentes + catálogo (pro preço).
  const [proposals, setProposals] = useState<ModelProposal[]>([])
  const [catalog, setCatalog] = useState<CatalogModel[]>([])

  useEffect(() => {
    let cancelled = false
    void listModelProposals("proposed").then((p) => {
      if (!cancelled) setProposals(p)
    })
    void getModelsCatalog().then((c) => {
      if (!cancelled) setCatalog(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function checkNow() {
    setChecking(true)
    const tools = await detectAgents()
    const now = Date.now()
    if (tools.length > 0)
      setSettings({ detected: toProbeMap(tools, now), lastUpdateCheck: now })
    else setSettings({ lastUpdateCheck: now })
    await refreshAgyModels() // modelos dinâmicos do agy junto da verificação
    await refreshCatalogIntoSettings() // tabela de preços (models.dev) junto
    setChecking(false)
  }

  async function decideProposal(
    p: ModelProposal,
    status: "active" | "dismissed",
  ) {
    await setModelProposalStatus(p.id, status)
    // aprovado → recarrega o cache que o agentModels() mescla no picker.
    if (status === "active") await reloadActiveProposals()
    setProposals((prev) => prev.filter((x) => x.id !== p.id))
  }

  function copyCmd(id: string, cmd: string) {
    void navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(id)
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500)
    })
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <SectionTitle>Agents na máquina</SectionTitle>
        <button
          onClick={() => void checkNow()}
          disabled={checking}
          className="mb-1 flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          <RotateCcw className={cn("size-3.5", checking && "animate-spin")} />
          Verificar agora
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {AGENT_TOOLS.map((tool) => {
          const probe = detected[tool.id]
          const hasUpdate = probe ? updateAvailable(probe) : false
          const cmd = UPDATE_COMMANDS[tool.id]
          return (
            <li
              key={tool.id}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
            >
              <span className="shrink-0">
                {!probe || !probe.installed ? (
                  <X className="size-4 text-st-error" />
                ) : hasUpdate ? (
                  <AlertTriangle className="size-4 text-st-warning" />
                ) : (
                  <Check className="size-4 text-st-success" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] text-foreground">
                  <span>
                    {tool.label}{" "}
                    <span className="text-muted-foreground">· {tool.sub}</span>
                  </span>
                  {hasUpdate && (
                    <span className="shrink-0 rounded border border-st-warning/50 bg-st-warning/10 px-1.5 py-px text-[10px] tracking-wide text-st-warning uppercase">
                      atualização disponível
                    </span>
                  )}
                </div>
                <div className="truncate text-[11.5px] text-muted-foreground">
                  {!probe
                    ? "não verificado ainda"
                    : !probe.installed
                      ? "não instalado"
                      : `instalado v${probe.version ?? "?"}${
                          probe.latest ? ` · última v${probe.latest}` : ""
                        }`}
                </div>
              </div>
              {cmd ? (
                <button
                  onClick={() => copyCmd(tool.id, cmd)}
                  title="Copiar comando de update"
                  className="flex shrink-0 items-center gap-1.5 rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {copied === tool.id ? (
                    <>
                      <Check className="size-3 text-st-success" /> copiado
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" /> {cmd}
                    </>
                  )}
                </button>
              ) : (
                <span className="shrink-0 text-[11px] text-muted-foreground/60">
                  —
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">
        Verificação automática 1×/dia ao abrir o app (última:{" "}
        {fmtCheckedAt(lastUpdateCheck)}). Quando sai versão nova você recebe uma
        notificação única por versão.
      </p>
      <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
        Tabela de preços: models.dev · {catalogCount}{" "}
        {catalogCount === 1 ? "modelo" : "modelos"} · atualizada{" "}
        {fmtCheckedAt(lastCatalogRefresh)}
      </p>

      {proposals.length > 0 && (
        <div className="mt-5">
          <SectionTitle>Propostas do curador</SectionTitle>
          <ul className="flex flex-col gap-1.5">
            {proposals.map((p) => {
              const price = fmtCatalogPrice(
                catalogEntryFor(catalog, p.agent, p.value),
              )
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-foreground">
                      {p.label}{" "}
                      <span className="text-muted-foreground">
                        · {agentDef(p.agent)?.label ?? p.agent}
                      </span>
                    </div>
                    <div className="truncate text-[11.5px] text-muted-foreground">
                      {p.description}
                      {price ? ` · ${price}` : ""}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void decideProposal(p, "active")}
                  >
                    Aprovar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void decideProposal(p, "dismissed")}
                  >
                    Dispensar
                  </Button>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
            Modelos novos encontrados no catálogo pelo curador. Aprovar adiciona
            ao seletor de modelos do agent; nada entra sem a sua revisão.
          </p>
        </div>
      )}
    </div>
  )
}

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
                  Sidebar, painel de contexto e o modo (Linear/SDD) também
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

              <SectionTitle>Auto-revive em rate limit</SectionTitle>
              <div className="divide-y divide-border/50">
                <Field
                  label="Retomar automaticamente"
                  hint="Quando o turno para num limite de uso / “vou tentar depois”, reenvia sozinho após o reset. Cada tentativa é um run pago."
                >
                  <Switch
                    checked={settings.autoResume}
                    onCheckedChange={(v) => setSettings({ autoResume: v })}
                    aria-label="Auto-revive em rate limit"
                  />
                </Field>
                <Field
                  label="Máximo de tentativas"
                  hint="Teto de reenvios automáticos por turno (protege o custo)."
                >
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={settings.autoResumeMaxTries}
                    onChange={(e) => {
                      const n = Math.max(1, Math.min(20, Number(e.target.value) || 1))
                      setSettings({ autoResumeMaxTries: n })
                    }}
                    disabled={!settings.autoResume}
                    className="h-8 w-20 text-[13px]"
                    aria-label="Máximo de tentativas de auto-resume"
                  />
                </Field>
              </div>
            </div>
          )}

          {section === "tools" && <AgentsToolsSection />}

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
              <div className="mt-4 border-t border-border/50 pt-3">
                <button
                  onClick={() => {
                    setSettings({ onboarded: false })
                    setOpen(false)
                  }}
                  className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-brass"
                >
                  <RotateCcw className="size-3.5" />
                  Refazer onboarding (verificar agents de novo)
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
