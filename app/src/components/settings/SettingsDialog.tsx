import { useEffect, useState, type ReactNode } from "react"
import { getVersion } from "@tauri-apps/api/app"
import {
  AlertTriangle,
  Bot,
  Check,
  CircleDollarSign,
  Copy,
  Cpu,
  Download,
  Info,
  Loader2,
  Mic,
  Network,
  PanelTop,
  Palette,
  RotateCcw,
  Smartphone,
  Sparkles,
  Users,
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
import {
  DESTINATIONS,
  agentDef,
  agentModels,
  agentEfforts,
  normalizeModelValue,
} from "@/lib/agents"
import {
  crossChannelNote,
  detectAgents,
  latestLabel,
  refreshAgyModels,
  toProbeMap,
  updateAvailable,
  UPDATE_COMMANDS,
} from "@/lib/detect"
import {
  hydrateUpdateJobs,
  startUpdate,
  updateButtonState,
  useUpdates,
} from "@/lib/updates"
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
import { CompanionSettings } from "@/components/settings/CompanionSettings"
import { McpSettings } from "@/components/settings/McpSettings"
import { CostMaintenance } from "@/components/settings/CostMaintenance"
import { EspecialistasContent } from "@/components/settings/Especialistas"
import {
  DEFAULT_DICTATION_HOTKEY,
  captureHotkey,
  formatHotkey,
} from "@/lib/dictationHotkey"
import { cn } from "@/lib/utils"

type Section =
  | "appearance"
  | "tray"
  | "agents"
  | "presets"
  | "tools"
  | "suggestions"
  | "dictation"
  | "missions"
  | "companion"
  | "integrations"
  | "ledger"
  | "about"

// Grupos rotulados (label-mono no rail) — o `group` marca o INÍCIO de um bloco.
// Rótulos desambíguos: "Padrões"(=default de nova conversa) e "Agents"(=CLIs
// instaladas) eram os dois "coisa de agente"; "Missions" estava em inglês.
const SECTIONS: {
  id: Section
  label: string
  icon: typeof Bot
  group?: string
}[] = [
  { id: "appearance", label: "Aparência", icon: Palette, group: "Aparência" },
  { id: "tray", label: "Barra de menus", icon: PanelTop },
  {
    id: "agents",
    label: "Novas conversas",
    icon: Bot,
    group: "Comportamento",
  },
  { id: "presets", label: "Especialistas", icon: Users },
  { id: "suggestions", label: "Sugestões", icon: Sparkles },
  { id: "dictation", label: "Ditado", icon: Mic },
  { id: "missions", label: "Missões", icon: Waypoints },
  { id: "companion", label: "Companion", icon: Smartphone },
  { id: "integrations", label: "Integrações MCP", icon: Network, group: "Sistema" },
  { id: "tools", label: "CLIs instaladas", icon: Cpu },
  { id: "ledger", label: "Custo & histórico", icon: CircleDollarSign },
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
  // Jobs de update: estado GLOBAL (lib/updates), não do componente — o job é
  // do app e sobrevive ao fechar/reabrir o modal (incidente dos N cliques).
  const updateJobs = useUpdates((s) => s.byAgent)
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
    // Re-hidrata os jobs de update ao abrir o painel: job vivo volta a mostrar
    // spinner; desfecho perdido com o modal fechado é anunciado agora.
    void hydrateUpdateJobs()
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

  // "Atualizar": só dispara o JOB (lib/updates → update.rs). Dedupe, toast com
  // id estável, timeout gentil e re-verificação pós-sucesso são do job — nada
  // disso mora mais no componente, então fechar o modal não perde nada.

  return (
    <div>
      {/* pr-9: a ação "Verificar agora" não passa por baixo do X do dialog. */}
      <div className="mb-2 flex items-center justify-between pr-9">
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
          const job = updateJobs[tool.id]
          // spinning = o job DESTE agent está vivo; disabled = qualquer job
          // vivo (um update por vez — dois brew brigam pelo lock).
          const { spinning, disabled } = updateButtonState(updateJobs, tool.id)
          // "última" POR CANAL do binário gerenciado, rotulada ("última
          // v2.1.212 (homebrew)"): o teto do npm não vale pra binário do brew.
          const latestText = probe ? latestLabel(probe) : null
          // canal cruzado: outro canal tem versão maior que o teto do canal
          // do binário — informação pra decisão humana, sem botão.
          const channelNote = probe ? crossChannelNote(probe) : null
          return (
            <li
              key={tool.id}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
            >
              <span className="shrink-0">
                {/* Auth honesta (Sprint 0): CLI deslogada ou com auth incerta
                    nunca ganha o check verde — verde exige probe.auth ok/na. */}
                {!probe || !probe.installed ? (
                  <X className="size-4 text-st-error" />
                ) : hasUpdate ||
                  probe.auth === "missing" ||
                  probe.auth === "unknown" ? (
                  <AlertTriangle className="size-4 text-st-warning" />
                ) : (
                  <Check className="size-4 text-st-success" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                {/* o "update disponível" já é sinalizado pelo ícone âmbar à
                    esquerda + o botão "Atualizar agora" + a "última vX" abaixo,
                    então nada de badge (era ele que estourava a linha). */}
                <div className="truncate text-[13px] text-foreground">
                  {tool.label}{" "}
                  <span className="text-muted-foreground">· {tool.sub}</span>
                </div>
                <div
                  className="truncate text-[11.5px] text-muted-foreground"
                  title={probe?.detail ?? undefined}
                >
                  {!probe ? (
                    "não verificado ainda"
                  ) : !probe.installed ? (
                    "não instalado"
                  ) : (
                    <>
                      {`instalado v${probe.version ?? "?"}${
                        latestText ? ` · ${latestText}` : ""
                      }`}
                      {probe.auth === "ok" && (
                        <span>
                          {" · logado"}
                          {probe.detail ? ` (${probe.detail})` : ""}
                        </span>
                      )}
                      {probe.auth === "missing" && (
                        <span className="text-st-warning">{" · sem login"}</span>
                      )}
                      {probe.auth === "unknown" && (
                        <span className="text-st-warning">
                          {" · auth desconhecida"}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {/* Canal cruzado na cara: "o canal npm tem v2.1.220; este
                    binário é homebrew (teto v2.1.212)". Sem botão — trocar de
                    canal é gesto do usuário. */}
                {channelNote && (
                  <div
                    className="truncate text-[11px] text-muted-foreground"
                    title={channelNote}
                  >
                    {channelNote}
                  </div>
                )}
                {/* Honestidade sobre instalações duplicadas: o "atualizei e não
                    mudou nada" quase sempre é o app gerenciando uma cópia
                    diferente da que o shell do usuário resolve (brew × nvm). */}
                {job && job.otherPaths.length > 0 && (
                  <div
                    className="truncate text-[11px] text-st-warning"
                    title={[job.managedPath, ...job.otherPaths].join("\n")}
                  >
                    {job.otherPaths.length + 1} instalações no PATH · o app
                    gerencia {job.managedPath}
                  </div>
                )}
              </div>
              {cmd ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* "Atualizar" (dispara o job in-app) quando há update novo,
                      OU spinner enquanto o job dele vive (mesmo depois de
                      fechar e reabrir o modal); o "copiar comando" é
                      ÍCONE-ONLY (tooltip = comando) pra não estourar a
                      largura do painel. */}
                  {(hasUpdate || spinning) && (
                    <button
                      onClick={() => void startUpdate(tool.id)}
                      disabled={disabled}
                      title="Atualiza o CLI aqui (detecta npm/brew/self-update)"
                      className="flex items-center gap-1 rounded bg-brass px-2 py-1 text-[11px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {spinning ? (
                        <>
                          <Loader2 className="size-3 animate-spin" /> atualizando…
                        </>
                      ) : (
                        <>
                          <Download className="size-3" /> Atualizar
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => copyCmd(tool.id, cmd)}
                    title={`Copiar comando de update: ${cmd}`}
                    aria-label="Copiar comando de update"
                    className="grid size-6 shrink-0 place-items-center rounded bg-background/60 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {copied === tool.id ? (
                      <Check className="size-3 text-st-success" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </button>
                </div>
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
/** Campo "Atalho do ditado": mostra o combo formatado e grava um novo — em
 *  modo captura o PRÓXIMO keydown com ≥1 modificador vira o combo (validação
 *  em captureHotkey, pura); Esc cancela. Listener em CAPTURE + stopPropagation
 *  pra tecla nenhuma vazar pro dialog (Esc fecharia as Configurações). */
function HotkeyField() {
  const combo = useApp((s) => s.settings.dictationHotkey)
  const enabled = useApp((s) => s.settings.dictationEnabled)
  const setSettings = useApp((s) => s.setSettings)
  const [capturing, setCapturing] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === "Escape") {
        setCapturing(false)
        setWarn(null)
        return
      }
      const r = captureHotkey(e)
      if (r.kind === "pending") return // só modificador — segue esperando
      if (r.kind === "needs-modifier") {
        setWarn("Use ao menos um modificador: ⌥, ⌃, ⇧ ou ⌘.")
        return
      }
      if (r.kind === "reserved") {
        setWarn("⌘K é a paleta de comandos do app — escolha outro combo.")
        return
      }
      setSettings({ dictationHotkey: r.combo })
      setCapturing(false)
      setWarn(null)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [capturing, setSettings])

  // fora do modo captura o aviso não fica pendurado
  useEffect(() => {
    if (!capturing) setWarn(null)
  }, [capturing])

  return (
    <div className="py-3">
      <div className="text-[13px] text-foreground">Atalho do ditado</div>
      <div className="mb-2 text-[11.5px] leading-snug text-muted-foreground">
        Toque alterna o ditado; segurar é push-to-talk (solta, insere).
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-8 min-w-[130px] items-center justify-center rounded-md border bg-secondary/40 px-2.5 font-mono text-[12.5px]",
            capturing
              ? "border-ring text-foreground motion-safe:animate-pulse"
              : combo
                ? "text-foreground"
                : "text-muted-foreground",
          )}
          aria-live="polite"
        >
          {capturing
            ? "pressione o combo…"
            : combo
              ? formatHotkey(combo)
              : "desativado"}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={!enabled}
          onClick={() => setCapturing((c) => !c)}
        >
          {capturing ? "Cancelar (Esc)" : "Gravar atalho"}
        </Button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={!enabled || combo === DEFAULT_DICTATION_HOTKEY}
          onClick={() => {
            setCapturing(false)
            setSettings({ dictationHotkey: DEFAULT_DICTATION_HOTKEY })
          }}
        >
          Restaurar padrão
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={!enabled || combo === null}
          onClick={() => {
            setCapturing(false)
            setSettings({ dictationHotkey: null })
          }}
        >
          Desativar
        </Button>
      </div>
      {warn && (
        <div className="mt-1.5 text-[11.5px] text-st-warning">{warn}</div>
      )}
    </div>
  )
}

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
        // X: o DialogCloseX PADRÃO do dialog base (canto do dialog, z alto,
        // chip) — nada de X custom dentro do scroll (era o bug recorrente).
        // mais largo E mais alto: a área de conteúdo estava com ~456px (o form
        // de preset de 3 colunas truncava tudo). Agora ~700px de conteúdo, com
        // teto por viewport pra não estourar telas baixas.
        className="flex h-[min(88vh,640px)] w-[92vw] max-w-[900px] gap-0 overflow-hidden rounded-xl border-border/60 p-0 shadow-[var(--shadow-pop)] sm:max-w-[900px]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Configurações</DialogTitle>
          <DialogDescription>Preferências do app.</DialogDescription>
        </DialogHeader>

        {/* Rail de seções — agrupado (Aparência · Comportamento · Sistema) */}
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border/60 bg-rail p-2">
          {SECTIONS.map((s) => (
            <div key={s.id} className="contents">
              {s.group && (
                <div className="label-mono px-2 pt-3 pb-1 text-[9px]">
                  {s.group}
                </div>
              )}
              <button
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
            </div>
          ))}
        </nav>

        {/* Conteúdo — o X padrão do dialog base flutua no canto sup-direito;
            os cabeçalhos de seção com ação à direita reservam pr-9 pra não
            passar por baixo dele (regra do DialogCloseX). */}
        <div className="relative flex-1 overflow-y-auto p-5">
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

          {section === "tray" && (
            <div>
              <SectionTitle>Barra de menus</SectionTitle>
              <div className="divide-y divide-border/50">
                <Field
                  label="Continuar ao fechar"
                  hint="Mantém agents e automações rodando quando a janela é fechada. Use Sair para encerrar tudo."
                >
                  <Switch
                    checked={settings.keepInTrayOnClose}
                    onCheckedChange={(v) =>
                      setSettings({ keepInTrayOnClose: v })
                    }
                    aria-label="Continuar na barra de menus ao fechar"
                  />
                </Field>
                <div className="py-3">
                  <div className="text-[13px] text-foreground">
                    Instrumento compacto
                  </div>
                  <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                    Um clique mostra frota, decisões e automações. O clique
                    secundário abre o menu nativo de segurança.
                  </p>
                </div>
              </div>
              {settings.trayCloseHintShown && (
                <button
                  onClick={() => setSettings({ trayCloseHintShown: false })}
                  className="mt-3 text-[12px] text-muted-foreground transition-colors hover:text-brass"
                >
                  Mostrar novamente o aviso ao fechar
                </button>
              )}
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
                  {/* normaliza o persistido: id que saiu do picker (o3,
                      gpt-5.3-codex) exibiria "Padrão" mentiroso no trigger
                      enquanto os envios continuariam com o valor morto. */}
                  <RichSelect
                    value={
                      normalizeModelValue(
                        settings.defaultAgent,
                        settings.defaultModel,
                      ) ?? "default"
                    }
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

              <SectionTitle>Vigia de silêncio</SectionTitle>
              <div className="divide-y divide-border/50">
                <Field
                  label="Avisar após (minutos)"
                  hint="Cobre turnos rodando sem produzir nada novo E cards do board parados em revisão/bloqueado. Dispara notificação + aviso acionável. Só funciona com o app aberto. 0 desliga."
                >
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    value={settings.stalledAfterMin}
                    onChange={(e) => {
                      const n = Math.max(0, Math.min(120, Number(e.target.value) || 0))
                      setSettings({ stalledAfterMin: n })
                    }}
                    className="h-8 w-20 text-[13px]"
                    aria-label="Minutos de silêncio até avisar turno mudo"
                  />
                </Field>
              </div>

              <SectionTitle>Automação desassistida</SectionTitle>
              <div className="divide-y divide-border/50">
                <Field
                  label="Responder sozinho após (minutos)"
                  hint="Vale SÓ para runs disparados por automação (view Agendado). Se o agente pedir permissão ou fizer uma pergunta e ninguém responder nesse tempo, o app nega no seu lugar, o turno termina e o motivo fica no fio da conversa e no sino. Conversa que você digitou nunca expira. 0 desliga (o turno espera para sempre, e sem ninguém para responder ele congela)."
                >
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    value={settings.unattendedAnswerAfterMin}
                    onChange={(e) => {
                      const n = Math.max(0, Math.min(120, Number(e.target.value) || 0))
                      setSettings({ unattendedAnswerAfterMin: n })
                    }}
                    className="h-8 w-20 text-[13px]"
                    aria-label="Minutos até responder sozinho numa automação desassistida"
                  />
                </Field>
              </div>

            </div>
          )}

          {section === "presets" && (
            // Uma superfície só: o marketplace inline (grid + detalhe + criar),
            // sem dialog-sobre-dialog. Altura própria pro scroll interno.
            <div className="flex h-[min(70vh,560px)] flex-col overflow-hidden rounded-xl border border-border/60 bg-card/30">
              <EspecialistasContent />
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
                <HotkeyField />
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

          {section === "companion" && <CompanionSettings />}

          {section === "integrations" && <McpSettings />}

          {section === "ledger" && (
            <div>
              <SectionTitle>Custo & histórico</SectionTitle>
              <CostMaintenance />
            </div>
          )}

          {section === "about" && (
            <div>
              <SectionTitle>Sobre</SectionTitle>
              <div className="space-y-1 text-[13px]">
                <div className="font-medium text-foreground">Frota</div>
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
