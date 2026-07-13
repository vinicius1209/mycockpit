// Wizard de primeira instalação (docs/onboarding.md). Overlay full-screen sobre
// o layout; grava onboarded=true só no fim. Fechar no meio NÃO grava (idempotente
// no próximo boot; tema/default já aplicados persistem). Reusado nas Settings
// ("refazer onboarding") via a mesma prop de controle.
import { useEffect, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  FolderPlus,
  Loader2,
  Moon,
  RotateCcw,
  Sun,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import appIcon from "@/assets/app-icon.png"
import { useApp } from "@/store/app"
import { AGENTS, availability, type Availability } from "@/lib/agents"
import {
  detectAgents,
  toProbeMap,
  type DetectedTool,
} from "@/lib/detect"
import { addProjectViaDialog } from "@/lib/projects"
import { cn } from "@/lib/utils"

/** Ferramentas que o checklist mostra (na ordem), com dica de instalação. */
const TOOLS: {
  id: string
  label: string
  sub: string
  install?: { cmd?: string; url?: string }
}[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    sub: "CLI da Anthropic",
    install: { cmd: "npm i -g @anthropic-ai/claude-code" },
  },
  {
    id: "codex",
    label: "Codex",
    sub: "CLI da OpenAI",
    install: { cmd: "brew install codex" },
  },
  {
    id: "agy",
    label: "Antigravity",
    sub: "CLI do Google",
    install: { url: "https://antigravity.google/cli" },
  },
  { id: "git", label: "git", sub: "controle de versão" },
  {
    id: "swiftc",
    label: "swiftc",
    sub: "ditado on-device (opcional)",
    install: { cmd: "xcode-select --install" },
  },
]

function statusOf(t: DetectedTool | undefined): {
  icon: "ok" | "warn" | "missing"
  text: string
} {
  if (!t || !t.installed) return { icon: "missing", text: "não instalado" }
  const v = t.version ? `${t.version}` : "instalado"
  if (t.auth === "ok")
    return { icon: "ok", text: `${v} · logado${t.detail ? ` (${t.detail})` : ""}` }
  if (t.auth === "na") return { icon: "ok", text: v }
  if (t.auth === "missing") return { icon: "warn", text: `${v} · deslogado` }
  return { icon: "warn", text: `${v} · auth desconhecida` }
}

function StatusIcon({ icon }: { icon: "ok" | "warn" | "missing" }) {
  if (icon === "ok") return <Check className="size-4 text-st-success" />
  if (icon === "warn")
    return <AlertTriangle className="size-4 text-st-warning" />
  return <X className="size-4 text-st-error" />
}

const AVAIL_BADGE: Record<Availability, { label: string; cls: string } | null> = {
  ready: { label: "pronto", cls: "text-st-success" },
  "installed-auth-unknown": { label: "auth?", cls: "text-st-warning" },
  missing: { label: "ausente", cls: "text-st-error" },
  "not-integrated": null,
}

export function OnboardingWizard({ onClose }: { onClose?: () => void }) {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const projectCount = useApp((s) => s.projects.length)

  const [step, setStep] = useState(0)
  const [detecting, setDetecting] = useState(false)
  const [tools, setTools] = useState<DetectedTool[]>([])
  const startCount = useState(() => projectCount)[0]

  async function runDetection() {
    setDetecting(true)
    const found = await detectAgents()
    setTools(found)
    setSettings({ detected: toProbeMap(found, Date.now()) })
    setDetecting(false)
    // pré-seleção do default: 1º "ready" entre claude/codex/agy.
    const map = toProbeMap(found, Date.now())
    const pick = ["claude-code", "codex", "agy"].find(
      (id) => availability(id, map) === "ready",
    )
    if (pick) setSettings({ defaultAgent: pick })
  }

  // roda a detecção ao ENTRAR no passo 2 (índice 1), uma vez.
  useEffect(() => {
    if (step === 1 && tools.length === 0 && !detecting) void runDetection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const detectedMap = toProbeMap(tools, 0)
  const anyInstalled = tools.some((t) => t.installed && t.id !== "git")
  const addedHere = projectCount > startCount

  function setTheme(target: "dark" | "light") {
    if (theme !== target) toggleTheme()
  }

  function finish() {
    setSettings({ onboarded: true })
    onClose?.()
  }

  const agentDefs = AGENTS.filter((a) => a.kind === "agent")

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="flex w-[560px] max-w-[92vw] flex-col rounded-2xl border border-border bg-card p-7 shadow-2xl">
        {/* passo 1 — boas-vindas */}
        {step === 0 && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <img
              src={appIcon}
              alt="MyCockpit"
              className="size-20 rounded-[22px] shadow-md"
            />
            <div>
              <h1 className="text-xl font-semibold text-foreground">MyCockpit</h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Seu cockpit de code agents no macOS.
              </p>
            </div>
            <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
              Vamos verificar suas ferramentas e configurar o essencial em{" "}
              <span className="whitespace-nowrap">~1 minuto</span>.
            </p>
          </div>
        )}

        {/* passo 2 — detecção */}
        {step === 1 && (
          <div className="flex flex-col gap-3">
            <StepTitle
              title="Verificando suas ferramentas"
              action={
                <button
                  onClick={() => void runDetection()}
                  disabled={detecting}
                  className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <RotateCcw className={cn("size-3.5", detecting && "animate-spin")} />
                  Rodar de novo
                </button>
              }
            />
            <ul className="flex flex-col gap-1.5">
              {TOOLS.map((tool) => {
                const found = tools.find((t) => t.id === tool.id)
                const st = statusOf(found)
                return (
                  <li
                    key={tool.id}
                    className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
                  >
                    <span className="shrink-0">
                      {detecting && !found ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : (
                        <StatusIcon icon={st.icon} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-foreground">
                        {tool.label}{" "}
                        <span className="text-muted-foreground">· {tool.sub}</span>
                      </div>
                      <div className="truncate text-[11.5px] text-muted-foreground">
                        {detecting && !found ? "verificando…" : st.text}
                      </div>
                    </div>
                    {!detecting &&
                      found &&
                      !found.installed &&
                      (tool.install?.cmd || tool.install?.url) && (
                        <code className="shrink-0 rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                          {tool.install.cmd ?? tool.install.url}
                        </code>
                      )}
                  </li>
                )
              })}
            </ul>
            {!detecting && !anyInstalled && (
              <p className="text-[12px] text-st-warning">
                Nenhum agent instalado. Instale um (comando acima) e clique
                "Rodar de novo".
              </p>
            )}
          </div>
        )}

        {/* passo 3 — agent default */}
        {step === 2 && (
          <div className="flex flex-col gap-3">
            <StepTitle title="Qual agent abre por padrão?" />
            <div className="flex flex-col gap-1.5">
              {agentDefs.map((a) => {
                const av = availability(a.id, detectedMap)
                const badge = AVAIL_BADGE[av]
                const selected = settings.defaultAgent === a.id
                const disabled = av === "missing" || av === "not-integrated"
                return (
                  <button
                    key={a.id}
                    disabled={disabled}
                    onClick={() => setSettings({ defaultAgent: a.id })}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-brass/70 bg-brass/10"
                        : "border-border/50 hover:border-border",
                      disabled && "opacity-40",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded-full border",
                        selected ? "border-brass" : "border-muted-foreground/50",
                      )}
                    >
                      {selected && <span className="size-2 rounded-full bg-brass" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-foreground">{a.label}</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {a.description ?? a.shortLabel}
                      </div>
                    </div>
                    {badge && (
                      <span className={cn("shrink-0 text-[11px]", badge.cls)}>
                        {badge.label}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              Dá pra trocar por conversa e nas Configurações depois.
            </p>
          </div>
        )}

        {/* passo 4 — tema */}
        {step === 3 && (
          <div className="flex flex-col gap-3">
            <StepTitle title="Como você prefere o cockpit?" />
            <div className="grid grid-cols-2 gap-3">
              {(["dark", "light"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border p-5 transition-colors",
                    theme === t
                      ? "border-brass/70 bg-brass/10"
                      : "border-border/50 hover:border-border",
                  )}
                >
                  {t === "dark" ? (
                    <Moon className="size-6 text-brass" />
                  ) : (
                    <Sun className="size-6 text-brass" />
                  )}
                  <span className="text-[13px] text-foreground">
                    {t === "dark" ? "Escuro" : "Claro"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* passo 5 — primeiro projeto */}
        {step === 4 && (
          <div className="flex flex-col gap-3">
            <StepTitle title="Adicione seu primeiro projeto" />
            <button
              onClick={() => void addProjectViaDialog()}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-8 text-[13px] text-muted-foreground transition-colors hover:border-brass/60 hover:text-brass"
            >
              <FolderPlus className="size-5" />
              Escolher pasta do projeto
            </button>
            {addedHere ? (
              <p className="flex items-center gap-1.5 text-[12.5px] text-st-success">
                <Check className="size-4" /> Projeto adicionado.
              </p>
            ) : (
              <p className="text-[11.5px] text-muted-foreground">
                Aponte para a pasta de um repositório. Pode pular e adicionar
                depois pelo "+" na barra lateral.
              </p>
            )}
          </div>
        )}

        {/* passo 6 — pronto */}
        {step === 5 && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="grid size-14 place-items-center rounded-full bg-st-success/15">
              <Check className="size-7 text-st-success" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Tudo pronto</h2>
            <p className="text-[13px] text-muted-foreground">
              Agent padrão:{" "}
              <span className="text-foreground">
                {AGENTS.find((a) => a.id === settings.defaultAgent)?.label ??
                  settings.defaultAgent}
              </span>{" "}
              · Tema: {theme === "dark" ? "escuro" : "claro"}
            </p>
            {tools.some((t) => t.installed && t.auth !== "ok" && t.auth !== "na") && (
              <p className="max-w-sm text-[12px] text-st-warning/90">
                Algum agent está instalado mas sem auth confirmada. Se o primeiro
                run falhar, rode o CLI no terminal para logar.
              </p>
            )}
          </div>
        )}

        {/* navegação */}
        <div className="mt-6 flex items-center justify-between">
          <div>
            {step > 0 && step < 5 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep((s) => s - 1)}
                className="gap-1.5 text-muted-foreground"
              >
                <ArrowLeft className="size-3.5" />
                Voltar
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 4 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(5)}
                className="text-muted-foreground"
              >
                Pular por agora
              </Button>
            )}
            {step < 5 ? (
              <Button
                size="sm"
                onClick={() => setStep((s) => s + 1)}
                className="gap-1.5"
              >
                {step === 0 ? "Começar" : "Continuar"}
                <ArrowRight className="size-3.5" />
              </Button>
            ) : (
              <Button size="sm" onClick={finish} className="gap-1.5">
                Abrir o cockpit
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StepTitle({
  title,
  action,
}: {
  title: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[15px] font-medium text-foreground">{title}</h2>
      {action}
    </div>
  )
}
