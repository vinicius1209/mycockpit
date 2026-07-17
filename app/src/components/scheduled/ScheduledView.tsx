// F6/F7 — view global "Agendado": a coleção cross-projeto de automações
// estilo CRON (docs/automation-evolution.md). Abre no lugar do conteúdo
// principal via useApp.scheduledOpen (estado próprio — o switcher
// Painel|Trabalho|Features não a conhece). Tudo fail-soft: fora do Tauri a
// lista fica vazia e as ações degradam em silêncio.

import { useEffect, useMemo, useState } from "react"
import {
  Brush,
  ChevronDown,
  Clock,
  FlaskConical,
  Info,
  Loader2,
  Play,
  Plus,
  Sunrise,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { StatusDot } from "@/components/common/StatusDot"
import type { AgentStatus } from "@/lib/types"
import { confirm } from "@/lib/confirm"
import { agentModels, defaultModelFor, LEAGUE_AGENTS } from "@/lib/agents"
import type { SchedulePermission, ScheduleRecord, ScheduleRunRecord } from "@/lib/db"
import { fmtCost } from "@/lib/format"
import {
  fmtRunShort,
  fmtUntilShort,
  nextRuns,
  parseCronExpr,
  parseRecurrence,
  recurrenceToText,
  type Recurrence,
} from "@/lib/schedules"
import { isScheduleRunning } from "@/lib/scheduleEngine"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useSchedules } from "@/store/schedules"
import { cn } from "@/lib/utils"

const WEEKDAYS_PT = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
]

function fmtWhen(ts: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts))
}

/** Abre a conversa que uma execução criou (navega pro Trabalho). */
async function openRunConv(projectId: string, convId: string) {
  const app = useApp.getState()
  app.setActiveProject(projectId)
  await useChat.getState().openProject(projectId)
  await useChat.getState().switchConversation(convId)
  app.setViewMode("linear")
}

/** Estado da automação → AgentStatus do StatusDot canônico (pulsa azul quando
 *  rodando, verde ok, vermelho falhou, cinza nunca rodou). */
function scheduleStatus(
  lastRunStatus: string | null,
  running: boolean,
): AgentStatus {
  if (running) return "running"
  if (lastRunStatus === "ok") return "success"
  if (lastRunStatus === "failed") return "error"
  return "idle"
}

function ScheduleRow({
  s,
  runs,
  projectName,
  now,
}: {
  s: ScheduleRecord
  runs: ScheduleRunRecord[]
  projectName: string
  now: number
}) {
  const toggle = useSchedules((st) => st.toggle)
  const remove = useSchedules((st) => st.remove)
  const runNow = useSchedules((st) => st.runNow)
  const [open, setOpen] = useState(false)
  const [firing, setFiring] = useState(false)
  const running = firing || isScheduleRunning(s.id)

  const rec = parseRecurrence(s.recurrence)
  // custo médio das últimas 5 execuções COM custo reportado.
  const avgCost = useMemo(() => {
    const costs = runs
      .slice(0, 5)
      .map((r) => r.cost)
      .filter((c): c is number => c != null)
    if (costs.length === 0) return null
    return costs.reduce((a, c) => a + c, 0) / costs.length
  }, [runs])

  async function handleRunNow() {
    setFiring(true)
    try {
      await runNow(s.id)
    } finally {
      setFiring(false)
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Excluir "${s.name}"?`,
      description:
        "A automação e o histórico de execuções são apagados. As conversas já criadas ficam.",
      confirmLabel: "Excluir",
      danger: true,
    })
    if (ok) {
      await remove(s.id)
      toast(`"${s.name}" excluída`)
    }
  }

  return (
    <div
      className={cn(
        "group rounded-lg border border-border/70 bg-card/40",
        !s.enabled && "opacity-60", // pausada: a linha inteira recua
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <StatusDot status={scheduleStatus(s.lastRunStatus, running)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
              {s.name}
            </span>
            {!s.enabled && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                pausada
              </span>
            )}
            <span className="shrink-0 text-[11.5px] text-muted-foreground">
              {projectName}
            </span>
          </div>
          {/* metadados discretos: recorrência + custo médio (a leitura forte é a
              próxima execução, à direita) */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground/80">
            <span>{recurrenceToText(rec)}</span>
            {avgCost != null && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="tabular-nums">
                  ~{fmtCost(avgCost)} /execução
                </span>
              </>
            )}
          </p>
        </div>
        {/* leitura de instrumento: PRÓXIMA execução (o número operacional) */}
        {s.enabled && s.nextRun != null && (
          <div className="shrink-0 text-right">
            <div className="label-mono text-[9px]">Próxima</div>
            <div className="font-mono text-[12.5px] tabular-nums text-foreground">
              {fmtUntilShort(s.nextRun - now)}
            </div>
          </div>
        )}
        {/* Rodar agora aparece no hover — some da linha "em repouso" */}
        <button
          onClick={() => void handleRunNow()}
          disabled={running}
          title="Rodar agora (não altera o calendário)"
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium text-foreground transition-colors hover:bg-accent/60 disabled:opacity-40",
            !running && "opacity-0 group-hover:opacity-100 focus:opacity-100",
          )}
        >
          {running ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Play className="size-3" />
          )}
          {running ? "Rodando…" : "Rodar"}
        </button>
        <Switch
          checked={s.enabled}
          onCheckedChange={(v) => void toggle(s.id, v)}
          aria-label={s.enabled ? "Pausar automação" : "Ativar automação"}
        />
        {/* Excluir só aparece no hover — separado do Switch, evita o clique errado
            que a linha antiga convidava (destrutivo colado no benigno). */}
        <button
          onClick={() => void handleDelete()}
          title="Excluir automação"
          aria-label="Excluir automação"
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-colors group-hover:opacity-100 focus:opacity-100 hover:text-st-error"
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          title={open ? "Fechar histórico" : "Ver histórico"}
          aria-label={open ? "Fechar histórico" : "Ver histórico"}
          aria-expanded={open}
          className="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
      </div>
      {open && (
        <div className="border-t border-border/60 px-4 py-2">
          {runs.length === 0 ? (
            <p className="py-1.5 text-[11.5px] text-muted-foreground/80">
              Nunca rodou.
            </p>
          ) : (
            <div className="flex flex-col">
              {runs.slice(0, 8).map((r) => (
                <button
                  key={r.id}
                  disabled={!r.convId}
                  onClick={() =>
                    r.convId && void openRunConv(s.projectId, r.convId)
                  }
                  title={r.convId ? "Abrir a conversa desta execução" : undefined}
                  className="flex items-center gap-2.5 rounded px-1 py-1.5 text-left text-[11.5px] transition-colors enabled:hover:bg-accent/50 disabled:cursor-default"
                >
                  <StatusDot status={scheduleStatus(r.status, false)} />
                  <span className="tabular-nums text-foreground/85">
                    {fmtWhen(r.startedAt)}
                  </span>
                  <span
                    className={cn(
                      r.status === "ok" ? "text-st-success" : "text-st-error",
                    )}
                  >
                    {r.status === "ok" ? "ok" : "falhou"}
                  </span>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {fmtCost(r.cost ?? undefined)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

type RecurrenceMode = "daily" | "weekly" | "cron"

/** Template do empty state: clicar abre o dialog PRÉ-PREENCHIDO — o usuário
 *  só escolhe o projeto e confirma. Todos nascem com permissão Leitura. */
interface ScheduleTemplate {
  id: string
  name: string
  desc: string
  icon: typeof Clock
  prompt: string
  mode: Exclude<RecurrenceMode, "cron">
  time: string
  weekday?: number
}

const TEMPLATES: ScheduleTemplate[] = [
  {
    id: "resumo-matinal",
    name: "Resumo matinal",
    desc: "diário às 08:00",
    icon: Sunrise,
    mode: "daily",
    time: "08:00",
    prompt:
      "Resuma as PRs abertas e o estado do CI; liste o que precisa de decisão humana",
  },
  {
    id: "testes-noturnos",
    name: "Testes noturnos",
    desc: "diário às 22:00",
    icon: FlaskConical,
    mode: "daily",
    time: "22:00",
    prompt: "Rode a suíte de testes e resuma falhas com suspeitas de causa",
  },
  {
    id: "faxina-semanal",
    name: "Faxina semanal",
    desc: "semanal (sex) às 17:00",
    icon: Brush,
    mode: "weekly",
    weekday: 5,
    time: "17:00",
    prompt:
      "Liste arquivos temporários, branches mortas e dependências não usadas (só liste, não apague)",
  },
]

/** Dialog "+ Nova automação": nome + projeto + agent/modelo + prompt +
 *  recorrência (presets com hora; cron no modo avançado, validado ao vivo,
 *  com preview das 3 próximas execuções) + permissão (Leitura default |
 *  Padrão — Liberado NEM aparece). `template` pré-preenche o form. */
function NewScheduleDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  template: ScheduleTemplate | null
}) {
  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const createSchedule = useSchedules((s) => s.create)

  const [name, setName] = useState("")
  const [projectId, setProjectId] = useState<string>("")
  const [agent, setAgent] = useState("claude-code")
  const [model, setModel] = useState(defaultModelFor("claude-code"))
  const [prompt, setPrompt] = useState("")
  const [mode, setMode] = useState<RecurrenceMode>("daily")
  const [time, setTime] = useState("08:00")
  const [weekday, setWeekday] = useState(1)
  const [cron, setCron] = useState("0 8 * * *")
  const [permission, setPermission] = useState<SchedulePermission>("leitura")
  const [saving, setSaving] = useState(false)

  // reabrir o dialog reseta o form (e ancora o projeto no ativo); com
  // template, o form nasce preenchido — só falta escolher o projeto.
  useEffect(() => {
    if (!open) return
    setName(template?.name ?? "")
    setProjectId(activeProjectId ?? projects[0]?.id ?? "")
    setAgent("claude-code")
    setModel(defaultModelFor("claude-code"))
    setPrompt(template?.prompt ?? "")
    setMode(template?.mode ?? "daily")
    setTime(template?.time ?? "08:00")
    setWeekday(template?.weekday ?? 1)
    setCron("0 8 * * *")
    setPermission("leitura")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const timeParts = /^(\d{2}):(\d{2})$/.exec(time)
  const cronValid = parseCronExpr(cron) != null
  const recurrence: Recurrence | null =
    mode === "cron"
      ? cronValid
        ? { kind: "cron", expr: cron.trim() }
        : null
      : timeParts
        ? mode === "daily"
          ? {
              kind: "daily",
              hour: Number(timeParts[1]),
              minute: Number(timeParts[2]),
            }
          : {
              kind: "weekly",
              weekday,
              hour: Number(timeParts[1]),
              minute: Number(timeParts[2]),
            }
        : null

  // Preview VIVO das próximas execuções (lição das UIs de cron): recalcula a
  // cada tecla — puro (computeNextRun), sem invoke nem estado extra.
  const preview = recurrence ? nextRuns(recurrence, new Date(), 3) : []

  const canSave =
    !saving &&
    name.trim().length > 0 &&
    projectId.length > 0 &&
    prompt.trim().length > 0 &&
    recurrence != null

  async function handleSave() {
    if (!recurrence) return
    setSaving(true)
    try {
      await createSchedule({
        name,
        projectId,
        agent,
        model: model === "default" ? null : model,
        prompt,
        permission,
        recurrence,
      })
      toast.success(`Automação "${name.trim()}" criada`)
      onOpenChange(false)
    } catch {
      toast.error("Falha ao criar a automação")
    } finally {
      setSaving(false)
    }
  }

  const fieldLabel = "text-[11px] font-medium tracking-wide text-muted-foreground uppercase"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Nova automação</DialogTitle>
          <DialogDescription>
            Um prompt que roda sozinho no projeto, no horário que você definir.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <label className={fieldLabel}>Nome</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Resumo matinal de PRs e CI"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabel}>Projeto</label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue placeholder="Escolha o projeto" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabel}>Agent</label>
              <Select
                value={agent}
                onValueChange={(a) => {
                  setAgent(a)
                  setModel(defaultModelFor(a))
                }}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAGUE_AGENTS.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {agentModels(agent).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className={fieldLabel}>Modelo</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agentModels(agent).map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabel}>Prompt</label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Resuma as PRs abertas e as falhas de CI. Não altere nada."
              className="min-h-[72px] rounded-md border border-input bg-transparent px-3 py-2 text-[13px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabel}>Recorrência</label>
            <div className="flex items-center gap-1.5">
              {(
                [
                  ["daily", "Diário"],
                  ["weekly", "Semanal"],
                  ["cron", "Avançado (cron)"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-[12px] transition-colors",
                    mode === m
                      ? "border-brass/60 bg-brass/10 font-medium text-brass"
                      : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode !== "cron" ? (
              <div className="mt-1 flex items-center gap-2">
                {mode === "weekly" && (
                  <Select
                    value={String(weekday)}
                    onValueChange={(v) => setWeekday(Number(v))}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS_PT.map((d, i) => (
                        <SelectItem key={d} value={String(i)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <span className="text-[12px] text-muted-foreground">às</span>
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-[110px]"
                />
              </div>
            ) : (
              <div className="mt-1 flex flex-col gap-1">
                <Input
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 8 * * 1  (min hora dia mês dia-da-semana)"
                  className="font-mono text-[12.5px]"
                  aria-invalid={!cronValid}
                />
              </div>
            )}
            {/* linha viva: 3 próximas execuções; cron inválido mostra o erro
                NO LUGAR do preview (mesma linha, sem pular layout). */}
            {mode === "cron" && !cronValid ? (
              <p className="text-[11px] text-st-error" data-testid="recurrence-preview">
                Expressão inválida — 5 campos: números, *, */n e listas a,b
                (sem ranges na v1).
              </p>
            ) : recurrence != null ? (
              <p
                className="text-[11px] text-muted-foreground/80 tabular-nums"
                data-testid="recurrence-preview"
              >
                {preview.length > 0
                  ? `Próximas: ${preview.map(fmtRunShort).join(" · ")}`
                  : "Essa expressão nunca dispara."}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabel}>Permissão</label>
            <div className="flex items-center gap-1.5">
              {(
                [
                  ["leitura", "Leitura", "só lê e relata (recomendado)"],
                  ["padrao", "Padrão", "pode editar, aprovações normais"],
                ] as const
              ).map(([p, label, hint]) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPermission(p)}
                  title={hint}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-[12px] transition-colors",
                    permission === p
                      ? "border-brass/60 bg-brass/10 font-medium text-brass"
                      : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              Automação nunca roda com permissão Liberado.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" disabled={!canSave} onClick={() => void handleSave()}>
            Criar automação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ScheduledView() {
  const schedules = useSchedules((s) => s.schedules)
  const runs = useSchedules((s) => s.runs)
  const loaded = useSchedules((s) => s.loaded)
  const reload = useSchedules((s) => s.reload)
  const projects = useApp((s) => s.projects)
  const setScheduledOpen = useApp((s) => s.setScheduledOpen)
  const [dialogOpen, setDialogOpen] = useState(false)
  // template escolhido no empty state — null = form em branco.
  const [dialogTemplate, setDialogTemplate] = useState<ScheduleTemplate | null>(
    null,
  )
  function openDialog(t: ScheduleTemplate | null) {
    setDialogTemplate(t)
    setDialogOpen(true)
  }
  // relógio de 30s: mantém os "em 2h" frescos e recarrega o espelho do banco
  // (o motor pode ter rodado algo em background).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    void reload()
    const t = setInterval(() => {
      setNow(Date.now())
      void reload()
    }, 30_000)
    return () => clearInterval(t)
  }, [reload])

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  )
  const runsBySchedule = useMemo(() => {
    const map = new Map<string, ScheduleRunRecord[]>()
    for (const r of runs) {
      const list = map.get(r.scheduleId)
      if (list) list.push(r)
      else map.set(r.scheduleId, [r])
    }
    return map
  }, [runs])
  // próximas primeiro; pausadas/sem próxima vão pro fim, por nome.
  const ordered = useMemo(
    () =>
      [...schedules].sort((a, b) => {
        const an = a.enabled && a.nextRun != null ? a.nextRun : Infinity
        const bn = b.enabled && b.nextRun != null ? b.nextRun : Infinity
        if (an !== bn) return an - bn
        return a.name.localeCompare(b.name)
      }),
    [schedules],
  )

  return (
    <ScrollArea className="h-full w-full bg-background">
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-8 pt-8 pb-14">
        {/* header enxuto: a sidebar já diz onde o usuário está — aqui é só a
            etiqueta da seção. Contagem só quando > 0 (um "0" solto é ruído);
            CTA só quando já existe automação (com lista vazia ele vive no
            empty state — um CTA só na tela). A limitação honesta virou o ⓘ. */}
        <header className="flex items-center gap-2">
          <Clock className="size-3.5 text-brass" />
          <h1 className="label-mono">Agendado</h1>
          {schedules.length > 0 && (
            <span className="text-[11.5px] text-muted-foreground/70 tabular-nums">
              {schedules.length}
            </span>
          )}
          <span
            title="Automações rodam com o app aberto ou no tray. Fechar a janela não interrompe; Sair sim."
            aria-label="Como as automações rodam"
            className="cursor-help text-muted-foreground/50 transition-colors hover:text-muted-foreground"
          >
            <Info className="size-3.5" />
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {schedules.length > 0 && (
              <Button size="sm" onClick={() => openDialog(null)}>
                <Plus className="size-3.5" />
                Nova automação
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-2 text-muted-foreground/70 hover:text-foreground"
              onClick={() => setScheduledOpen(false)}
              title="Fechar"
              aria-label="Fechar Agendado"
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {!loaded ? (
          <div className="flex items-center gap-2 py-6 text-[12.5px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Carregando…
          </div>
        ) : ordered.length === 0 ? (
          /* empty state que ENSINA: templates clicáveis abrem o dialog já
             preenchido — o usuário só escolhe o projeto e confirma. */
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border/60 bg-card/30 px-6 py-10 text-center">
            <Clock className="size-6 text-muted-foreground/60" />
            <p className="text-[13px] text-muted-foreground">
              Um prompt que roda sozinho no horário que você definir. Comece
              por um modelo:
            </p>
            <div className="grid w-full max-w-[560px] grid-cols-1 gap-2 sm:grid-cols-3">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openDialog(t)}
                  data-testid={`schedule-template-${t.id}`}
                  className="flex flex-col items-start gap-1.5 rounded-lg border border-border/70 bg-card/50 px-3 py-2.5 text-left transition-colors hover:border-brass/50 hover:bg-accent/40"
                >
                  <t.icon className="size-3.5 text-brass" />
                  <span className="text-[12.5px] font-medium text-foreground">
                    {t.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t.desc}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => openDialog(null)}
              className="text-[11.5px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              ou comece do zero
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {ordered.map((s) => (
              <ScheduleRow
                key={s.id}
                s={s}
                runs={runsBySchedule.get(s.id) ?? []}
                projectName={projectNames.get(s.projectId) ?? "projeto"}
                now={now}
              />
            ))}
          </div>
        )}
      </div>
      <NewScheduleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={dialogTemplate}
      />
    </ScrollArea>
  )
}
