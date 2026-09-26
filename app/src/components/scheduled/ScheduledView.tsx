// F6/F7 — view global "Agendado": a coleção cross-projeto de automações
// estilo CRON (docs/automation-evolution.md). Abre no lugar do conteúdo
// principal via useApp.scheduledOpen (estado próprio — o switcher
// Painel|Trabalho não a conhece). Tudo fail-soft: fora do Tauri a
// lista fica vazia e as ações degradam em silêncio.

import { useEffect, useMemo, useState } from "react"
import {
  Brush,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  FlaskConical,
  Info,
  Loader2,
  Pencil,
  Play,
  Plus,
  Sunrise,
  Trash2,
  X,
} from "lucide-react"
import { avisar, mensagemDe } from "@/lib/avisos"
import { Button } from "@/components/ui/button"
import { AppDialog } from "@/components/ui/app-dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { StatusDot } from "@/components/common/StatusDot"
import {
  DateTimeField,
  ScheduleFormDialog,
  type ScheduleTemplate,
} from "@/components/scheduled/ScheduleFormDialog"
import { confirm } from "@/lib/confirm"
import type { ScheduleRecord, ScheduleRunRecord } from "@/lib/db"
import { fmtCost } from "@/lib/format"
import {
  computeNextRun,
  fmtUntilShort,
  parseLocalDateTime,
  parseRecurrence,
  recurrenceToText,
  scheduleLifecycle,
} from "@/lib/schedules"
import { isScheduleRunning } from "@/lib/scheduleEngine"
import { nextFullHourValue } from "@/lib/scheduleForm"
import {
  fmtScheduleWhen,
  lastRunLabel,
  runStatusLabel,
  scheduleStatus,
} from "@/lib/schedulePresentation"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useSchedules } from "@/store/schedules"
import { cn } from "@/lib/utils"

/** Abre a conversa que uma execução criou (navega pro Trabalho). */
async function openRunConv(projectId: string, convId: string) {
  const app = useApp.getState()
  app.setActiveProject(projectId)
  await useChat.getState().openProject(projectId)
  await useChat.getState().switchConversation(convId)
  app.setViewMode("linear")
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
  const [reschedOpen, setReschedOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const running = firing || isScheduleRunning(s.id)

  const rec = parseRecurrence(s.recurrence)
  // estado de vida DERIVADO dos campos reais (lib/schedules): concluída ≠
  // pausada ≠ sem próxima execução.
  const life = scheduleLifecycle(s)
  // só a automação de uma vez pode ser reagendada: o botão troca o instante,
  // não a recorrência (um cron quebrado vira outro assunto). Vale em QUALQUER
  // estado dela — restringir a "concluída/sem próxima" criava dois becos sem
  // saída: (a) marquei 18:30 e quero 19:00, mas ela ainda está ativa e não há
  // como mexer; (b) pausei uma que já perdeu o horário e ela vira "pausada",
  // sem botão nenhum — ligar o switch não recria disparo, então a linha ficava
  // morta na lista.
  const canReschedule = rec?.kind === "once"
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

  async function handleToggle(v: boolean) {
    await toggle(s.id, v)
    // ligar de volta uma "uma vez" cujo horário já passou NÃO cria disparo
    // nenhum: avisa, em vez de deixar o switch verde mentindo.
    if (v && rec && computeNextRun(rec, new Date()) == null) {
      avisar.nota("Sem próxima execução: o horário já passou. Use Reagendar.")
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
      avisar.feito(`"${s.name}" excluída`)
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
            {/* Automação LEGADA do lead: o tipo saiu (ADR-078), mas a linha
                salva continua no banco. Ela é marcada e NUNCA roda — some
                daqui só quando você excluir. */}
            {s.kind === "lead" && (
              <span className="shrink-0 rounded bg-st-warning/15 px-1.5 py-px text-[11px] tracking-wide text-st-warning">
                tipo removido
              </span>
            )}
            {/* concluída ≠ pausada ≠ sem próxima: confundir os três faria o
                usuário achar que a automação ainda vai rodar. */}
            {life === "concluida" && (
              <span
                title={
                  s.completedAt != null
                    ? `Rodou e se encerrou em ${fmtScheduleWhen(s.completedAt)} (automação de uma vez).`
                    : "Rodou e se encerrou (automação de uma vez)."
                }
                className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground"
              >
                <Check className="size-2.5" />
                concluída
              </span>
            )}
            {life === "pausada" && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">
                pausada
              </span>
            )}
            {life === "sem_proxima" && (
              <span
                title="Ligada, mas sem próxima execução (o horário passou com o app fechado, ou a recorrência nunca casa)."
                className="shrink-0 rounded-full border border-st-queued/40 px-1.5 py-px text-[11px] font-medium text-st-queued"
              >
                não vai rodar
              </span>
            )}
            <span className="shrink-0 text-[12px] text-muted-foreground">
              {projectName}
            </span>
          </div>
          {/* metadados discretos: recorrência + última execução + custo médio
              (a leitura forte é a próxima execução, à direita). A "última" NÃO
              é enfeite: desde que o dot ambiente virou cinza, ela é o único
              desempate entre "nunca rodou" e "a última deu certo". */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground/80">
            <span>{recurrenceToText(rec)}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="tabular-nums">{lastRunLabel(s.lastRunAt)}</span>
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
            <div className="etiqueta">Próxima</div>
            <div className="font-mono text-[13px] tabular-nums text-foreground">
              {fmtUntilShort(s.nextRun - now)}
            </div>
          </div>
        )}
        {/* Reagendar: a automação de uma vez que já rodou (ou perdeu o horário)
            não some da lista — ganha um novo instante aqui. Fica no lugar do
            Switch, que seria mentira (ligar não recria disparo nenhum). */}
        {canReschedule && (
          <button
            onClick={() => setReschedOpen(true)}
            title="Escolher uma nova data e hora"
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-accent/60"
          >
            <CalendarClock className="size-3" />
            Reagendar
          </button>
        )}
        {/* Rodar agora aparece no hover — some da linha "em repouso" */}
        <button
          onClick={() => void handleRunNow()}
          disabled={running}
          title={
            rec?.kind === "once"
              ? "Rodar agora (encerra a automação de uma vez)"
              : "Rodar agora (não altera o calendário)"
          }
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-accent/60 disabled:opacity-40",
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
        {/* O Switch só aparece quando LIGAR/DESLIGAR ainda significa alguma
            coisa. Numa "uma vez" já concluída (ou que perdeu o horário) ligar
            não recria disparo nenhum — seria um controle que mente. Aí só
            Reagendar faz sentido. Ativa ou pausada, os dois convivem: pausar
            uma marcada pra 18:30 é ação legítima e diferente de remarcar. */}
        {(life === "ativa" || life === "pausada") && (
          <Switch
            checked={s.enabled}
            onCheckedChange={(v) => void handleToggle(v)}
            aria-label={s.enabled ? "Pausar automação" : "Ativar automação"}
          />
        )}
        {/* Editar no hover, do lado do Rodar: consertar o prompt (ou a
            permissão que fez o turno morrer em sandbox) tinha que ser excluir
            e redigitar tudo — e ninguém faz isso, então a automação quebrada
            ficava lá. */}
        <button
          onClick={() => setEditOpen(true)}
          title="Editar automação"
          aria-label="Editar automação"
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-colors group-hover:opacity-100 focus:opacity-100 hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
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
          {/* O que ela roda, legível sem abrir a edição: antes o prompt só
              aparecia dentro do formulário (nota de 03/09). */}
          {s.prompt.trim() && (
            <div className="mb-2 flex flex-col gap-0.5 border-b border-border/40 pb-2">
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {s.kind === "mission" ? "Pedido da missão" : "Prompt"}
              </span>
              <p className="line-clamp-6 text-[12px] whitespace-pre-wrap text-foreground/85 [overflow-wrap:anywhere]">
                {s.prompt}
              </p>
            </div>
          )}
          {runs.length === 0 ? (
            <p className="py-1.5 text-[12px] text-muted-foreground/80">
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
                  title={r.error ?? (r.convId ? "Abrir a conversa desta execução" : undefined)}
                  className="flex flex-col gap-0.5 rounded px-1 py-1.5 text-left text-[12px] transition-colors enabled:hover:bg-accent/50 disabled:cursor-default"
                >
                  <span className="flex w-full items-center gap-2.5">
                    <StatusDot status={scheduleStatus(r.status, false)} />
                    <span className="tabular-nums text-foreground/85">
                      {fmtScheduleWhen(r.startedAt)}
                    </span>
                    {/* Histórico assentado: "ok" é o caso comum e não ganha
                        tinta (STYLEGUIDE §2); só a falha grita. */}
                    <span
                      className={cn(
                        r.status === "ok"
                          ? "text-muted-foreground"
                          : r.status === "blocked"
                            ? "text-st-queued"
                            : "text-st-error",
                      )}
                    >
                      {runStatusLabel(r.status)}
                    </span>
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      {fmtCost(r.cost ?? undefined)}
                    </span>
                  </span>
                  {/* O MOTIVO, quando existe. Antes a linha dizia só "falhou" e
                      descobrir o porquê exigia abrir a conversa — que é
                      justamente o que ninguém faz às 8h da manhã. */}
                  {r.error && (
                    <span className="truncate pl-[18px] text-[11px] text-muted-foreground/80">
                      {r.error}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <RescheduleDialog
        s={s}
        open={reschedOpen}
        onOpenChange={setReschedOpen}
      />
      <ScheduleFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        schedule={s}
      />
    </div>
  )
}

/** "Reagendar": dá um novo instante à automação de uma vez que já rodou (ou
 *  que perdeu o horário). Ela volta a ficar ativa, sem perder o histórico. */
function RescheduleDialog({
  s,
  open,
  onOpenChange,
}: {
  s: ScheduleRecord
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const reschedule = useSchedules((st) => st.reschedule)
  const [at, setAt] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setAt(nextFullHourValue())
  }, [open])

  const ms = parseLocalDateTime(at)
  const future = ms != null && ms > Date.now()

  async function handleSave() {
    if (ms == null || !future) return
    setSaving(true)
    try {
      await reschedule(s.id, ms)
      avisar.feito(`"${s.name}" reagendada para ${fmtScheduleWhen(ms)}`)
      onOpenChange(false)
    } catch (e) {
      avisar.erro(`Não consegui reagendar "${s.name}".`, { detalhe: mensagemDe(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      className="max-w-[420px]"
      title={<>Reagendar "{s.name}"</>}
      description={
        <>
          Roda uma vez no novo horário e para de novo. O histórico anterior
          fica.
        </>
      }
      footer={
        <>
          <Button variant="outline" size="padrao" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            size="padrao"
            disabled={!future || saving}
            onClick={() => void handleSave()}
          >
            Reagendar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <DateTimeField autoFocus value={at} onChange={setAt} />
        {!future && (
          <p className="text-[11px] text-st-error">
            {ms == null
              ? "Escolha uma data e um horário."
              : "Esse horário já passou, escolha um no futuro."}
          </p>
        )}
      </div>
    </AppDialog>
  )
}

/** O ícone é só da vitrine do empty state, então mora aqui: o template que
 *  viaja pro form (lib do dialog) é dado puro. */
type TemplateCard = ScheduleTemplate & { icon: typeof Clock }

const TEMPLATES: TemplateCard[] = [
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
          <Clock className="size-3.5 text-muted-foreground" /> {/* §2: nunca brass */}
          <h1 className="etiqueta">Agendamentos</h1>
          {schedules.length > 0 && (
            <span className="text-[12px] text-muted-foreground/70 tabular-nums">
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
              <Button size="padrao" onClick={() => openDialog(null)}>
                <Plus className="size-3.5" />
                Nova automação
              </Button>
            )}
            <Button
              variant="ghost"
              size="icone-padrao"
              className="ml-2 text-muted-foreground/70 hover:text-foreground"
              onClick={() => setScheduledOpen(false)}
              title="Fechar"
              aria-label="Fechar Agendamentos"
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {!loaded ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
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
                  <t.icon className="size-3.5 text-muted-foreground" /> {/* §2: nunca brass */}
                  <span className="text-[13px] font-medium text-foreground">
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
              className="text-[12px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
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
      <ScheduleFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={dialogTemplate}
      />
    </ScrollArea>
  )
}
