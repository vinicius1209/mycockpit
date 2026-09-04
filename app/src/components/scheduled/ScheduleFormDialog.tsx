// O form da automação: CRIAR e EDITAR na mesma superfície (ADR-161). Antes só
// dava pra criar, e consertar uma automação que falhava significava excluir e
// redigitar o prompt inteiro — o que ninguém faz, então a automação quebrada
// simplesmente ficava lá.
//
// A lógica de validade mora em lib/scheduleForm (pura, testada): aqui é só
// tela. A régua é UMA (`draftInput`) — o botão desabilita pelo mesmo `null`
// que faria o handler desistir, então não existe estado em que a tela habilita
// e o store recusa.

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Route } from "lucide-react"
import { Button } from "@/components/ui/button"
import { controle } from "@/components/ui/controle"
import { AppDialog } from "@/components/ui/app-dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SELECTED_FILL, UNSELECTED } from "@/lib/selection"
import {
  agentEfforts,
  agentModels,
  defaultModelFor,
  LEAGUE_AGENTS,
} from "@/lib/agents"
import type { ScheduleRecord } from "@/lib/db"
import {
  draftFromSchedule,
  draftInput,
  draftRecurrence,
  emptyDraft,
  type RecurrenceMode,
  type ScheduleDraft,
} from "@/lib/scheduleForm"
import {
  fmtRunShort,
  nextRuns,
  parseCronExpr,
  parseLocalDateTime,
  recurrenceToText,
  toLocalDateTimeValue,
} from "@/lib/schedules"
import type { SchedulePermission } from "@/lib/sessionMode"
import { useApp } from "@/store/app"
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

const FIELD_LABEL =
  "text-[11px] font-medium tracking-wide text-muted-foreground uppercase"

/** Pré-preenchimento vindo do empty state ("Resumo matinal" etc.). */
export interface ScheduleTemplate {
  id: string
  name: string
  desc: string
  prompt: string
  mode: "daily" | "weekly"
  time: string
  weekday?: number
}

/** Campo de data+hora do "Uma vez" (input nativo datetime-local, hora local).
 *  `min` é só ajuda visual do browser — a guarda de verdade é o parse + a
 *  comparação com agora, no lib/scheduleForm e no store. */
export function DateTimeField({
  value,
  onChange,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
}) {
  return (
    <Input
      autoFocus={autoFocus}
      type="datetime-local"
      value={value}
      min={toLocalDateTimeValue(Date.now())}
      onChange={(e) => onChange(e.target.value)}
      className="w-[210px]"
    />
  )
}

/** Uma linha de botões-degrau (recorrência, fluxo, permissão): o mesmo gesto
 *  nas três, com o mesmo par de estilos de seleção. */
function ChipRow<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly (readonly [T, string, string])[]
  label: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={label}>
      {options.map(([v, texto, dica]) => (
        <button
          key={v}
          type="button"
          title={dica}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            controle("compacto"),
            "border transition-colors",
            value === v ? SELECTED_FILL : UNSELECTED,
          )}
        >
          {texto}
        </button>
      ))}
    </div>
  )
}

/** Dialog "Nova automação" / "Editar automação": nome + projeto + o que
 *  dispara (prompt num agent, ou um Plano de voo) + recorrência + permissão.
 *  `schedule` presente = modo edição; `template` pré-preenche o form novo. */
export function ScheduleFormDialog({
  open,
  onOpenChange,
  template,
  schedule,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  template?: ScheduleTemplate | null
  schedule?: ScheduleRecord | null
}) {
  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const plans = useApp((s) => s.settings.missionPresets)
  const createSchedule = useSchedules((s) => s.create)
  const editSchedule = useSchedules((s) => s.edit)

  const editando = schedule != null
  const [d, setD] = useState<ScheduleDraft>(() =>
    emptyDraft({
      projectId: activeProjectId ?? "",
      agent: "claude-code",
      model: defaultModelFor("claude-code"),
    }),
  )
  const [saving, setSaving] = useState(false)
  const patch = (p: Partial<ScheduleDraft>) => setD((cur) => ({ ...cur, ...p }))

  // reabrir o dialog reseta o rascunho: do registro (editar), do template
  // (empty state) ou em branco, sempre ancorado no projeto ativo.
  useEffect(() => {
    if (!open) return
    if (schedule) {
      setD(draftFromSchedule(schedule))
      return
    }
    const base = emptyDraft({
      projectId: activeProjectId ?? projects[0]?.id ?? "",
      agent: "claude-code",
      model: defaultModelFor("claude-code"),
    })
    setD(
      template
        ? {
            ...base,
            name: template.name,
            prompt: template.prompt,
            mode: template.mode,
            time: template.time,
            weekday: template.weekday ?? base.weekday,
          }
        : base,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schedule?.id])

  const cronValid = parseCronExpr(d.cron) != null
  const onceMs = d.mode === "once" ? parseLocalDateTime(d.onceAt) : null
  const onceFuture = onceMs != null && onceMs > Date.now()
  const recurrence = draftRecurrence(d)
  const input = draftInput(d)
  // Preview VIVO das próximas execuções (lição das UIs de cron): recalcula a
  // cada tecla — puro, sem invoke nem estado extra.
  const preview = recurrence ? nextRuns(recurrence, new Date(), 3) : []
  const plano = plans.find((p) => p.id === d.planId) ?? null
  const efforts = agentEfforts(d.agent)

  async function handleSave() {
    if (!input) return
    setSaving(true)
    try {
      if (schedule) await editSchedule(schedule.id, input)
      else await createSchedule(input)
      toast.success(
        `Automação "${d.name.trim()}" ${editando ? "salva" : "criada"}`,
      )
      onOpenChange(false)
    } catch (e) {
      // motivo real quando existe (ex.: a guarda de horário no passado do
      // store) — genérico só quando a falha vem muda.
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : `Falha ao ${editando ? "salvar" : "criar"} a automação`,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      className="max-w-[520px]"
      title={editando ? "Editar automação" : "Nova automação"}
      description={
        editando
          ? "As mudanças valem da próxima execução em diante. O histórico fica."
          : "Um pedido que roda sozinho no projeto, no horário que você definir."
      }
      footer={
        <>
          <Button variant="outline" size="padrao" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            size="padrao"
            disabled={!input || saving}
            onClick={() => void handleSave()}
          >
            {editando ? "Salvar" : "Criar automação"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL}>Nome</label>
          <Input
            autoFocus
            value={d.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Resumo matinal de PRs e CI"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL}>O que roda</label>
          <ChipRow
            label="O que a automação dispara"
            value={d.kind}
            onChange={(kind) => patch({ kind })}
            options={[
              ["agent", "Prompt", "um pedido, um agent, um turno"] as const,
              [
                "mission",
                "Plano de voo",
                "o time do plano executa a rota inteira, fase por fase",
              ] as const,
            ]}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL}>Projeto</label>
            <Select
              value={d.projectId}
              onValueChange={(projectId) => patch({ projectId })}
            >
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
          {/* No Plano de voo o agent/modelo/effort são POR FASE e moram no
              plano: mostrar os seletores aqui prometeria um controle que o
              disparo ignora. No lugar deles, o plano escolhido. */}
          {d.kind === "mission" ? (
            <div className="flex flex-col gap-1.5">
              <label className={FIELD_LABEL}>Plano de voo</label>
              <Select
                value={d.planId}
                onValueChange={(planId) => patch({ planId })}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue placeholder="Escolha o plano" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className={FIELD_LABEL}>Agent</label>
              <Select
                value={d.agent}
                onValueChange={(agent) =>
                  patch({
                    agent,
                    // trocar de agent zera modelo e effort pro default do novo
                    // (mesma regra do launcher de missão).
                    model: defaultModelFor(agent),
                    effort: "default",
                  })
                }
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
          )}
        </div>

        {d.kind === "mission" ? (
          plano ? (
            <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground/80">
              <Route className="size-3.5 text-muted-foreground" />
              <span>
                {plano.phases.length}{" "}
                {plano.phases.length === 1 ? "fase" : "fases"}:{" "}
                {plano.phases.map((f) => f.label).join(" → ")}
              </span>
              {plano.maxCostUsd != null && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="tabular-nums">
                    teto US$ {plano.maxCostUsd}
                  </span>
                </>
              )}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground/70">
              Cada fase do plano roda com o agent, o modelo e o esforço que ela
              já tem. Sem gate: ninguém está na frente pra responder, então as
              perguntas entram como aviso no fio e a missão segue.
            </p>
          )
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {agentModels(d.agent).length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className={FIELD_LABEL}>Modelo</label>
                <Select
                  value={d.model}
                  onValueChange={(model) => patch({ model })}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {agentModels(d.agent).map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {/* Esforço só aparece em agent que TEM a flag: um seletor morto
                prometeria um controle que o spawn ignora. */}
            {efforts.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className={FIELD_LABEL}>Esforço</label>
                <Select
                  value={d.effort}
                  onValueChange={(effort) => patch({ effort })}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {efforts.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL}>
            {d.kind === "mission" ? "Pedido da missão" : "Prompt"}
          </label>
          <Textarea
            value={d.prompt}
            onChange={(e) => patch({ prompt: e.target.value })}
            rows={3}
            placeholder={
              d.kind === "mission"
                ? "O que o time deve entregar nesta rodada"
                : "Resuma as PRs abertas e as falhas de CI. Não altere nada."
            }
            className="min-h-[72px] rounded-md border bg-transparent px-3 py-2 text-[13px]"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL}>Recorrência</label>
          <ChipRow
            label="Recorrência"
            value={d.mode}
            onChange={(mode: RecurrenceMode) => patch({ mode })}
            options={[
              ["once", "Uma vez", "roda uma vez na data e hora e para"] as const,
              ["daily", "Diário", "todo dia no mesmo horário"] as const,
              ["weekly", "Semanal", "toda semana no mesmo dia e horário"] as const,
              ["cron", "Avançado (cron)", "expressão de 5 campos"] as const,
            ]}
          />
          {/* o campo segue o modo: data+hora no "Uma vez", cron no avançado
              (o campo de cron SOME quando não é o modo escolhido). */}
          {d.mode === "once" ? (
            <div className="mt-1 flex items-center gap-2">
              <DateTimeField
                value={d.onceAt}
                onChange={(onceAt) => patch({ onceAt })}
              />
            </div>
          ) : d.mode !== "cron" ? (
            <div className="mt-1 flex items-center gap-2">
              {d.mode === "weekly" && (
                <Select
                  value={String(d.weekday)}
                  onValueChange={(v) => patch({ weekday: Number(v) })}
                >
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS_PT.map((dia, i) => (
                      <SelectItem key={dia} value={String(i)}>
                        {dia}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <span className="text-[12px] text-muted-foreground">às</span>
              <Input
                type="time"
                value={d.time}
                onChange={(e) => patch({ time: e.target.value })}
                className="w-[110px]"
              />
            </div>
          ) : (
            <div className="mt-1 flex flex-col gap-1">
              <Input
                value={d.cron}
                onChange={(e) => patch({ cron: e.target.value })}
                placeholder="0 8 * * 1  (min hora dia mês dia-da-semana)"
                className="font-mono text-[13px]"
                aria-invalid={!cronValid}
              />
            </div>
          )}
          {/* linha viva: 3 próximas execuções; cron inválido mostra o erro
              NO LUGAR do preview (mesma linha, sem pular layout). */}
          {d.mode === "cron" && !cronValid ? (
            <p className="text-[11px] text-st-error" data-testid="recurrence-preview">
              Expressão inválida. São 5 campos: números, *, */n e listas a,b
              (sem ranges na v1).
            </p>
          ) : d.mode === "once" && !onceFuture ? (
            <p className="text-[11px] text-st-error" data-testid="recurrence-preview">
              {onceMs == null
                ? "Escolha uma data e um horário."
                : "Esse horário já passou, escolha um no futuro."}
            </p>
          ) : recurrence != null ? (
            <p
              className="text-[11px] text-muted-foreground/80 tabular-nums"
              data-testid="recurrence-preview"
            >
              {recurrence.kind === "once"
                ? `Roda ${recurrenceToText(recurrence)} e para.`
                : preview.length > 0
                  ? `Próximas: ${preview.map(fmtRunShort).join(" · ")}`
                  : "Essa expressão nunca dispara."}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL}>Permissão</label>
          <ChipRow
            label="Permissão"
            value={d.permission}
            onChange={(permission: SchedulePermission) => patch({ permission })}
            options={[
              ["leitura", "Leitura", "só lê e relata (recomendado)"] as const,
              [
                "padrao",
                "Padrão",
                "pode editar; o que pedir permissão expira sem ninguém",
              ] as const,
              [
                "auto",
                "Auto",
                "roda sem pedir, com o freio de segurança da CLI",
              ] as const,
            ]}
          />
          <p className="text-[11px] leading-snug text-muted-foreground/70">
            Automação nunca roda com <strong className="font-medium">Liberado</strong>:
            bypass total sem ninguém na frente não tem quem segure um erro.
            O <strong className="font-medium">Auto</strong> é o meio-termo, roda sem
            pedir, mas com o freio da CLI (Claude barra o destrutivo por
            classificador; Codex confina em sandbox de SO; Antigravity só tem
            sandbox best-effort, então lá o freio é o mais fraco dos três).
            Em <strong className="font-medium">Padrão</strong>, o que pedir permissão
            expira sozinho e o turno morre, não há quem aprove às 3h.
          </p>
        </div>
      </div>
    </AppDialog>
  )
}
