import { memo, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  Bot,
  Check,
  ChevronRight,
  FileDiff,
  FilePen,
  FileText,
  Gauge,
  Globe,
  Globe2,
  GraduationCap,
  Loader2,
  Search,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { agentLabel } from "@/lib/agent"
import { DESTINATIONS } from "@/lib/agents"
import { fmtCost, fmtDuration, fmtTokens } from "@/lib/format"
import type { Attachment } from "@/lib/attachments"
import { attachmentUrl } from "@/lib/attachments"
import { attachmentRead, attachmentReadLabel } from "@/lib/attachmentRead"
import type { SaveLessonOutcome } from "@/lib/learning"
import {
  cleanResultText,
  presentTool,
  resultMeta,
  summarizeToolGroup,
  type ToolKind,
} from "@/lib/toolview"
import { lineDiff, trimOuterContext, type DiffRow } from "@/lib/linediff"
import { deriveTasks } from "@/lib/tasks"
import { openDeliveryDiff } from "@/lib/deliveryDiff"
import { Markdown } from "@/components/common/Markdown"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import { buildNodes, type ToolItem } from "@/components/chat/messageNodes"
import { useChat, type ChatItem } from "@/store/chat"

/** Máx. de linhas mostradas num bloco de diff (Edit/Write) antes de "… +N linhas". */
const DIFF_MAX_LINES = 80
/** Máx. de nós renderizados numa conversa longa (o resto atrás do botão). */
const CHAT_WINDOW = 150

const KIND_ICON: Record<ToolKind, LucideIcon> = {
  bash: Terminal,
  read: FileText,
  edit: FilePen,
  write: FilePen,
  search: Search,
  web: Globe,
  agent: Bot,
  generic: Wrench,
}

/** Cronômetro ao vivo enquanto o run pensa (atualiza a cada 1s). */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="tabular-nums">{fmtDuration(now - since)}</span>
}

/** Reúne os hunks de um tool de edição + contagem. Edit → 1 hunk; MultiEdit →
 *  1 por edição; Write → tudo adição. null = não é tool de edição. */
function editHunks(
  name: string,
  input: Record<string, unknown>,
): { hunks: DiffRow[][]; added: number; removed: number } | null {
  const acc = { hunks: [] as DiffRow[][], added: 0, removed: 0 }
  const push = (o: string, nw: string) => {
    const d = lineDiff(o, nw)
    acc.hunks.push(d.rows)
    acc.added += d.added
    acc.removed += d.removed
  }
  if (
    name === "Edit" &&
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    push(input.old_string, input.new_string)
    return acc
  }
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    for (const e of input.edits as Record<string, unknown>[]) {
      if (e && typeof e.old_string === "string") {
        push(e.old_string, typeof e.new_string === "string" ? e.new_string : "")
      }
    }
    return acc.hunks.length ? acc : null
  }
  if (name === "Write" && typeof input.content === "string") {
    push("", input.content)
    return acc
  }
  return null
}

/** Diff unificado (interleaved), estilo Warp: contexto cinza + add/del
 *  coloridos, contexto externo aparado, cap de linhas. */
function UnifiedDiff({ rows }: { rows: DiffRow[] }) {
  const trimmed = trimOuterContext(rows)
  const shown = trimmed.slice(0, DIFF_MAX_LINES)
  const hidden = trimmed.length - shown.length
  return (
    <div className="overflow-x-auto py-1 font-mono text-[11.5px] leading-relaxed">
      {shown.map((r, idx) => (
        <div
          key={idx}
          className={cn(
            "flex gap-2 px-2",
            r.type === "add" && "bg-st-success/10",
            r.type === "del" && "bg-st-error/10",
          )}
        >
          <span
            className={cn(
              "w-3 shrink-0 select-none text-center",
              r.type === "add"
                ? "text-st-success"
                : r.type === "del"
                  ? "text-st-error"
                  : "text-transparent",
            )}
          >
            {r.type === "add" ? "+" : r.type === "del" ? "−" : " "}
          </span>
          <span
            data-selectable
            className={cn(
              "break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
              r.type === "ctx" ? "text-muted-foreground/70" : "text-foreground/85",
            )}
          >
            {r.text || " "}
          </span>
        </div>
      ))}
      {hidden > 0 && (
        <div className="px-2 pl-7 text-muted-foreground">… +{hidden} linhas</div>
      )}
    </div>
  )
}

/** Status de uma ação técnica. `recorded` é histórico antigo/adapter sem
 * resultado: neutro, nunca finge que ainda está pendente. */
type StepStatus = "ok" | "error" | "running" | "recorded"

function StepDot({ status }: { status: StepStatus }) {
  if (status === "ok")
    return <span className="size-[7px] shrink-0 rounded-full bg-st-success" />
  if (status === "error")
    return <span className="size-[7px] shrink-0 rounded-full bg-st-error" />
  // Passo em execução GIRA (mesmo vocabulário do ToolGroupStatus): "girando =
  // este passo executando". O dot pulsante fica reservado ao rodapé
  // "trabalhando" (batimento do turno + cronômetro) — os dois sinais deixam de
  // ser dois pontos azuis idênticos.
  if (status === "running")
    return <Loader2 className="size-3 shrink-0 animate-spin text-st-running" />
  return <span className="size-[7px] shrink-0 rounded-full bg-muted-foreground/25" />
}

/** Tool call como LINHA (círculo de status + ícone + rótulo + meta), colapsável.
 *  A prosa do agent é o conteúdo; a ferramenta é rodapé, não caixa. `active` =
 *  o turno está rodando E este é o passo corrente (sem result ainda). */
const ToolLine = memo(function ToolLine({
  item,
  active = false,
}: {
  item: ToolItem
  active?: boolean
}) {
  const p = presentTool(item.name, item.input)
  const Icon = KIND_ICON[p.kind]
  const i = (item.input ?? {}) as Record<string, unknown>
  const diff = editHunks(item.name, i)
  // Nível 2 do disclosure: primeiro se abre o grupo semântico; só um gesto
  // explícito revela comando/input/output/diff desta ação.
  const [open, setOpen] = useState(false)
  const failed = item.result?.ok === false
  const status: StepStatus = item.result
    ? item.result.ok
      ? "ok"
      : "error"
    : active
      ? "running"
      : "recorded"
  const res = resultMeta(item.name, item.result)
  const meta = [p.meta, res].filter(Boolean).join(" · ")
  // Suprime o boilerplate de sucesso do write/edit ("File created…") — vira ""
  // e o bloco de result nem aparece (o cartão já mostra arquivo + diff).
  const resultText = cleanResultText(item.name, item.result)
  const expandable = Boolean(p.detail || diff || resultText)

  return (
    <div className="min-w-0">
      <button
        onClick={() => expandable && setOpen((o) => !o)}
        className={cn(
          "group/step flex w-full items-center gap-2.5 rounded-md px-2 py-[5px] text-left text-[12.5px] transition-colors",
          expandable && "hover:bg-accent/40",
          p.emphasis === "warning" && status !== "error" && "text-brass",
          // passo em execução PULA da sequência: leve tinta st-running.
          status === "running" && "bg-st-running/[0.06]",
        )}
      >
        <span
          className="grid size-3.5 shrink-0 place-items-center"
          title={status === "recorded" ? "sem resultado registrado" : undefined}
        >
          <StepDot status={status} />
        </span>
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            failed
              ? "text-st-error"
              : p.emphasis === "warning" || p.kind === "edit" || p.kind === "write"
                ? "text-brass"
                : "text-muted-foreground",
          )}
        />
        <span
          className={cn(
            "truncate",
            // estado no PRÓPRIO rótulo (não só no ponto): concluído assenta,
            // em execução fica pleno → a sequência ganha ritmo de progresso.
            failed
              ? "text-st-error"
              : status === "ok"
                ? "text-foreground/55"
                : status === "running"
                  ? "text-foreground"
                  : p.emphasis === "warning"
                    ? "text-brass"
                    : "text-foreground/75",
          )}
        >
          {p.label}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          {diff ? (
            <span className="font-mono text-[10.5px] tabular-nums">
              {diff.added > 0 && (
                <span className="text-st-success">+{diff.added}</span>
              )}
              {diff.added > 0 && diff.removed > 0 && " "}
              {diff.removed > 0 && (
                <span className="text-st-error">−{diff.removed}</span>
              )}
            </span>
          ) : (
            meta && (
              <span className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
                {meta}
              </span>
            )
          )}
          {expandable && (
            // seta de expandir no FIM (longe do ícone `>_` → sem duplicação).
            <ChevronRight
              className={cn(
                "size-3 text-muted-foreground/45 transition-transform group-hover/step:text-muted-foreground/70",
                open && "rotate-90",
              )}
            />
          )}
        </span>
      </button>
      {open && (
        <div className="mt-1 mb-1.5 ml-[30px] overflow-hidden rounded-md border border-border/60 bg-secondary/20">
          {p.detail && (
            <div className="p-2">
              <p className="mb-1 text-[9.5px] tracking-wide text-muted-foreground/70 uppercase">
                {p.kind === "bash" ? "Comando" : "Entrada"}
              </p>
              <div
                data-selectable
                className="font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/70"
              >
                {p.detail}
              </div>
            </div>
          )}
          {diff && (
            <div className={cn(p.detail && "border-t border-border/50")}>
              <p className="px-2 pt-2 text-[9.5px] tracking-wide text-muted-foreground/70 uppercase">
                Alterações
              </p>
              {diff.hunks.map((rows, idx) => (
                <div
                  key={idx}
                  className={cn(idx > 0 && "border-t border-border/40")}
                >
                  <UnifiedDiff rows={rows} />
                </div>
              ))}
            </div>
          )}
          {resultText && (
            <div className="border-t border-border/50 p-2">
              <p className="mb-1 text-[9.5px] tracking-wide text-muted-foreground/70 uppercase">
                {failed ? "Erro" : "Saída"}
              </p>
              <div
                data-selectable
                className={cn(
                  "font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
                  failed ? "text-st-error" : "text-muted-foreground",
                )}
              >
                {resultText}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

function ToolGroupStatus({
  state,
}: {
  state: ReturnType<typeof summarizeToolGroup>["state"]
}) {
  if (state === "running")
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-st-running" />
  if (state === "error")
    return <X className="size-3.5 shrink-0 text-st-error" aria-hidden="true" />
  if (state === "ok")
    return <Check className="size-3.5 shrink-0 text-st-success" aria-hidden="true" />
  return <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
}

/** Registro de voo: UMA caption por burst. O primeiro clique revela ações
 * humanas; cada ação guarda seu próprio nível técnico (comando/input/output). */
function ToolGroup({
  tools,
  defaultOpen,
  active = false,
}: {
  tools: ToolItem[]
  defaultOpen: boolean
  /** turno rodando E este é o grupo corrente → o passo sem result "roda". */
  active?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const manuallyToggled = useRef(false)
  const wasActive = useRef(active)
  const summary = summarizeToolGroup(tools, active)
  const diffTotal = tools.reduce(
    (acc, t) => {
      const d = editHunks(t.name, (t.input ?? {}) as Record<string, unknown>)
      if (d) {
        acc.added += d.added
        acc.removed += d.removed
      }
      return acc
    },
    { added: 0, removed: 0 },
  )

  // A atividade corrente pode abrir pra dar feedback ao vivo. Quando termina,
  // recolhe sozinha — exceto se o usuário assumiu o controle do disclosure.
  useEffect(() => {
    if (active && !manuallyToggled.current) setOpen(true)
    if (wasActive.current && !active && !manuallyToggled.current) setOpen(false)
    wasActive.current = active
  }, [active])

  return (
    <div className="min-w-0">
      <button
        onClick={() => {
          manuallyToggled.current = true
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        className={cn(
          "group/activity flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          summary.state === "error"
            ? "text-st-error"
            : summary.state === "running"
              ? "text-foreground"
              : summary.emphasis === "warning"
                ? "text-brass"
                : summary.emphasis === "quiet"
                  ? "text-muted-foreground/75"
                  : "text-muted-foreground",
        )}
      >
        <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">
          <ToolGroupStatus state={summary.state} />
        </span>
        <span className="min-w-0 flex-1 truncate">{summary.label}</span>
        {(diffTotal.added > 0 || diffTotal.removed > 0) && (
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums">
            {diffTotal.added > 0 && (
              <span className="text-st-success">+{diffTotal.added}</span>
            )}
            {diffTotal.added > 0 && diffTotal.removed > 0 && " "}
            {diffTotal.removed > 0 && (
              <span className="text-st-error">−{diffTotal.removed}</span>
            )}
          </span>
        )}
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground/35 transition-transform group-hover/activity:text-muted-foreground/70",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="mt-0.5 ml-[7px] flex flex-col gap-px border-l border-border/40 pl-2.5">
          {tools.map((t, i) => (
            <ToolLine
              key={t.id}
              item={t}
              // "rodando" é SÓ o último passo emitido (o corrente).
              active={active && i === tools.length - 1 && !t.result}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Thumbnail de um anexo no histórico (bytes → object URL cacheado). */
function AttachmentThumb({
  att,
  read,
}: {
  att: Attachment
  /** Selo de leitura: null = nada a afirmar (inlinado / sem telemetria). */
  read: { text: string; warn: boolean } | null
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    attachmentUrl(att)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [att.path])
  if (att.kind === "pdf") {
    return (
      <span className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground">
        <FileText className="size-3.5 shrink-0" />
        <span className="max-w-[160px] truncate">{att.name}</span>
        <ReadBadge read={read} />
      </span>
    )
  }
  if (failed) {
    return (
      <span className="rounded-md border bg-card px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
        anexo expirado
      </span>
    )
  }
  if (!url) {
    return <span className="size-20 animate-pulse rounded-lg border bg-secondary/40" />
  }
  return (
    <span className="relative inline-flex">
      <img
        src={url}
        alt={att.name}
        className="max-h-44 max-w-[220px] rounded-lg border object-contain"
      />
      {read && (
        <span className="absolute right-1 bottom-1">
          <ReadBadge read={read} />
        </span>
      )}
    </span>
  )
}

/** Selo do anexo: prova (ou falta dela) de que o agent ABRIU o arquivo.
 *  No Claude e no agy o anexo é um ponteiro — o modelo decide abrir —, então
 *  "respondeu" nunca significou "olhou". O rastro já existia no fio (a chamada
 *  da ferramenta de leitura); isto só o mostra. */
function ReadBadge({ read }: { read: { text: string; warn: boolean } | null }) {
  if (!read) return null
  return (
    <span
      title={
        read.warn
          ? "O agent respondeu sem abrir este anexo — a resposta pode não considerá-lo."
          : "O agent abriu este anexo durante o turno."
      }
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm",
        read.warn
          ? "bg-st-warning/20 text-st-warning ring-1 ring-st-warning/40"
          : "bg-card/85 text-muted-foreground ring-1 ring-border",
      )}
    >
      {read.text}
    </span>
  )
}

/** Contrato de feedback do Linear (M2), threadado do ChatPanel. `null` fora do
 *  Linear (Fusion/Mission não têm este loop). O gate humano vive no card:
 *  distill PROPÕE, o clique GRAVA. */
export interface FeedbackApi {
  /** 👍 leve: reforça (bumpLessonUses) as lições injetadas no último turno. */
  onThumbUp: () => void | Promise<void>
  /** Destila um candidato de regra + o veredito de learnability (Haiku julga se
   *  há algo durável). learnable:false → a UI avisa mas deixa salvar (gate humano). */
  distill: (
    agentTurn: string,
    userNote: string,
  ) => Promise<{ rule: string; learnable: boolean | null }>

  /** Grava a regra após o gate humano (dedup interno). O desfecho distingue
   *  duplicata de FALHA — antes os dois viravam `false` e a UI dizia "duplicata"
   *  quando o banco tinha caído. */
  save: (rule: string, scope: "global" | "project") => Promise<SaveLessonOutcome>
}

/** 👍/👎 + "salvar como regra" numa bolha de TEXTO do agente (kind text/result).
 *  Discreto (aparece no hover, padrão do CopyButton). O 👎 e o "salvar regra"
 *  abrem o MESMO fluxo: input inline → card de propor-regra com gate humano. */
function FeedbackControls({
  agentTurn,
  api,
}: {
  agentTurn: string
  api: FeedbackApi
}) {
  // "idle" | "ask" (input inline) | "card" (propor regra) | "done"
  const [mode, setMode] = useState<"idle" | "ask" | "card" | "done">("idle")
  const [thumbedUp, setThumbedUp] = useState(false)
  const [note, setNote] = useState("")
  const [rule, setRule] = useState("")
  // veredito do juiz de learnability: false = pouco generalizável (avisa, não bloqueia).
  const [learnable, setLearnable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  function thumbUp() {
    if (thumbedUp) return
    setThumbedUp(true)
    void api.onThumbUp()
  }

  // 👎 → abre input; "salvar como regra" → mesmo fluxo, seeded com "o que funcionou".
  function openAsk(seed: string) {
    setNote(seed)
    setMode("ask")
  }

  // input enviado → destila (Haiku ou cru) e mostra o card editável (gate humano).
  async function propose() {
    const n = note.trim()
    if (!n) return
    setBusy(true)
    try {
      const candidate = await api.distill(agentTurn, n)
      setRule(candidate.rule)
      setLearnable(candidate.learnable)
      setMode("card")
    } finally {
      setBusy(false)
    }
  }

  async function commit(scope: "global" | "project") {
    const r = rule.trim()
    if (!r) return
    setBusy(true)
    try {
      const r2 = await api.save(r, scope)
      setMode(r2 === "salva" ? "done" : "idle")
      if (r2 === "duplicata") toastDuplicate()
      if (r2 === "erro") {
        toast.error("Não consegui salvar a regra.", {
          description: "O detalhe está no console. Sua regra NÃO foi gravada.",
        })
      }
    } finally {
      setBusy(false)
    }
  }

  if (mode === "done") {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-st-success">
        <GraduationCap className="size-3.5" /> Regra salva
      </div>
    )
  }

  if (mode === "ask") {
    return (
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void propose()
            if (e.key === "Escape") setMode("idle")
          }}
          placeholder="O que faltou / estava errado?"
          className="min-w-0 flex-1 rounded-md border bg-background/60 px-2 py-1 text-[12px] outline-none focus:border-brass/60"
        />
        <button
          onClick={() => void propose()}
          disabled={busy || !note.trim()}
          className="shrink-0 rounded-md bg-brass px-2 py-1 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Propor regra"}
        </button>
        <button
          onClick={() => setMode("idle")}
          aria-label="Cancelar"
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    )
  }

  if (mode === "card") {
    return (
      <div
        className={cn(
          "mt-1.5 flex flex-col gap-2 rounded-lg border p-2.5",
          learnable === false
            ? "border-st-warning/40 bg-st-warning/5"
            : "border-brass/40 bg-brass/5",
        )}
      >
        {learnable === false ? (
          <div className="flex items-start gap-1.5 text-[11px] text-st-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" /> Isso parece
            pouco generalizável — nada óbvio pra virar regra. Salve só se for
            mesmo uma preferência durável.
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <GraduationCap className="size-3.5 text-brass" /> Regra proposta —
            revise antes de salvar
          </div>
        )}
        <textarea
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border bg-background/60 px-2 py-1.5 text-[12.5px] leading-snug outline-none focus:border-brass/60"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => void commit("project")}
            disabled={busy || !rule.trim()}
            className="rounded-md bg-brass px-2.5 py-1 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Salvar regra
          </button>
          <button
            onClick={() => void commit("global")}
            disabled={busy || !rule.trim()}
            className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11.5px] transition-colors hover:bg-accent disabled:opacity-40"
          >
            <Globe2 className="size-3.5" /> Salvar como global
          </button>
          <button
            onClick={() => setMode("idle")}
            className="rounded-md px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Descartar
          </button>
          {busy && <Loader2 className="size-3.5 animate-spin text-brass" />}
        </div>
      </div>
    )
  }

  // idle: ícones discretos no hover.
  return (
    <div className="mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100">
      <button
        onClick={thumbUp}
        title="Boa resposta (reforça as lições usadas)"
        aria-label="Boa resposta"
        className={cn(
          "rounded p-1 text-muted-foreground transition-colors hover:text-st-success",
          thumbedUp && "text-st-success",
        )}
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <button
        onClick={() => openAsk("")}
        title="Faltou algo / estava errado"
        aria-label="Feedback negativo"
        className="rounded p-1 text-muted-foreground transition-colors hover:text-st-error"
      >
        <ThumbsDown className="size-3.5" />
      </button>
      <button
        onClick={() => openAsk("O que funcionou aqui e vale como regra: ")}
        title="Salvar como regra"
        aria-label="Salvar como regra"
        className="rounded p-1 text-muted-foreground transition-colors hover:text-brass"
      >
        <GraduationCap className="size-3.5" />
      </button>
    </div>
  )
}

/** Aviso leve de duplicata: dedup preferível a ruído (nunca grava 2 regras iguais). */
function toastDuplicate() {
  toast("Já existe uma regra parecida — não salvei de novo.")
}

/** Célula do strip de telemetria: micro-label mono + valor tabular. `end` ancora
 *  a célula à direita (o custo fecha o strip como um total). */
function TeleCell({
  label,
  children,
  accent,
  end,
}: {
  label: string
  children: React.ReactNode
  accent?: boolean
  end?: boolean
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 border-l border-border px-3 py-1.5 first:border-l-0",
        end && "ml-auto border-l",
      )}
    >
      <span className="label-mono text-[9px]">{label}</span>
      <span
        className={cn(
          "font-mono text-[12px] tabular-nums whitespace-nowrap",
          accent ? "font-semibold text-brass" : "text-foreground/80",
        )}
      >
        {children}
      </span>
    </div>
  )
}

/** Telemetria de fim de turno como INSTRUMENTO (não linha cinza corrida): o dado
 *  mais denso do app — tempo, tokens por direção, cache, custo — em células
 *  rotuladas, com o custo promovido a brass. */
function TurnTelemetry({
  it,
}: {
  it: Extract<ChatItem, { kind: "result" }>
}) {
  const hasUsage = it.usage && (it.usage.input > 0 || it.usage.output > 0)
  return (
    // largura do conteúdo (w-full): as bordas do strip batem com a prosa e as
    // tools; o custo fecha à direita como um total. Nunca causa scroll lateral
    // (o container do chat é overflow-x-hidden e as células têm min-w-0).
    <div className="flex w-full flex-wrap items-stretch overflow-hidden rounded-lg border bg-card/40 text-muted-foreground">
      <div
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium",
          it.ok ? "text-st-success" : "text-st-error",
        )}
      >
        {it.ok ? (
          <Check className="size-3.5" />
        ) : (
          <AlertCircle className="size-3.5" />
        )}
        <span>{it.ok ? "concluído" : "erro"}</span>
      </div>
      {it.durationMs != null && (
        <TeleCell label="Tempo">{fmtDuration(it.durationMs)}</TeleCell>
      )}
      {hasUsage && (
        <TeleCell label="Tokens">
          {fmtTokens(it.usage!.input)} ↓ · {fmtTokens(it.usage!.output)} ↑
        </TeleCell>
      )}
      {it.usage && it.usage.cacheRead > 0 && (
        <TeleCell label="Cache">{fmtTokens(it.usage.cacheRead)}</TeleCell>
      )}
      {it.model && <TeleCell label="Modelo">{it.model}</TeleCell>}
      {it.costUsd != null && (
        <TeleCell label="Custo" accent end>
          <span
            title={
              it.costSource === "estimated"
                ? "estimado: tokens × tabela de preço"
                : undefined
            }
          >
            {fmtCost(it.costUsd, it.costSource)}
          </span>
        </TeleCell>
      )}
      {/* P3 — Entrega→diff em 1 clique: o strip de result É a entrega no fio;
          este botão abre o diff do worktree no painel de Alterações (com o
          header Pedir correção/Fechar). Sem worktree/diff vazio ⇒ toast. */}
      {it.ok && (
        <button
          type="button"
          onClick={() => {
            const convId = useChat.getState().activeId
            if (!convId) return
            void openDeliveryDiff({ convId, text: it.text ?? "" })
          }}
          title="Ver o diff desta entrega"
          aria-label="Ver o diff desta entrega"
          className={cn(
            "flex items-center gap-1.5 border-l border-border px-3 text-[11px] transition-colors hover:bg-secondary hover:text-foreground",
            it.costUsd == null && "ml-auto",
          )}
        >
          <FileDiff className="size-3.5" /> Diff
        </button>
      )}
    </div>
  )
}

/** Um item NÃO-tool da conversa. `memo`: só re-renderiza quando a REFERÊNCIA do
 *  item muda (itens não-streaming têm ref estável), não re-pinta a cada delta (F12). */
const MessageItem = memo(function MessageItem({
  item: it,
  feedback,
  reads,
}: {
  item: ChatItem
  feedback?: FeedbackApi | null
  /** Selo de leitura por PATH de anexo (só itens do usuário usam). Vem pronto
   *  do MessageList: calcular aqui exigiria o fio inteiro dentro de um `memo`
   *  por item, o que mataria a memoização a cada delta do streaming. */
  reads?: Record<string, { text: string; warn: boolean } | null>
}) {
  if (it.kind === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {it.attachments && it.attachments.length > 0 && (
          <div className="flex max-w-[82%] flex-wrap justify-end gap-1.5">
            {it.attachments.map((a) => (
              <AttachmentThumb key={a.path} att={a} read={reads?.[a.path] ?? null} />
            ))}
          </div>
        )}
        {it.text && (
          <div
            data-selectable
            className="max-w-[82%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[14px] break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground"
          >
            {it.text}
          </div>
        )}
      </div>
    )
  }

  if (it.kind === "text") {
    // No Linear (feedback != null), a bolha do agente ganha 👍/👎/salvar regra
    // no hover (group/msg). Só faz sentido em texto NÃO-vazio.
    if (feedback && it.text.trim()) {
      return (
        <div className="group/msg">
          <Markdown text={it.text} />
          <FeedbackControls agentTurn={it.text} api={feedback} />
        </div>
      )
    }
    return <Markdown text={it.text} />
  }

  if (it.kind === "tool") {
    return <ToolLine item={it} />
  }

  if (it.kind === "error") {
    return (
      <div className="rounded-lg border border-st-error/40 bg-st-error/10 px-3 py-2.5">
        <div className="mb-1 flex items-center gap-2 text-st-error">
          <AlertCircle className="size-3.5" />
          <span className="label-mono text-st-error">erro</span>
        </div>
        <div
          data-selectable
          className="font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/85"
        >
          {it.message}
        </div>
      </div>
    )
  }

  if (it.kind === "limit") {
    return (
      <div className="rounded-lg border border-st-warning/40 bg-st-warning/10 px-3 py-2.5">
        <div className="mb-1 flex items-center gap-2 text-st-warning">
          <Gauge className="size-3.5" />
          <span className="label-mono text-st-warning">limite de uso atingido</span>
          {it.resetHint && (
            <span className="text-[11.5px] text-st-warning/80">
              volta {it.resetHint}
            </span>
          )}
        </div>
        <div
          data-selectable
          className="font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/85"
        >
          {it.message}
        </div>
      </div>
    )
  }

  if (it.kind === "cancelled") {
    return (
      <div className="flex items-center gap-2 pt-1 text-[12px] text-muted-foreground">
        <Ban className="size-3.5" />
        <span>interrompido</span>
      </div>
    )
  }

  if (it.kind === "notice") {
    return (
      <div className="flex items-center gap-2 px-1 text-[11.5px] text-muted-foreground/80">
        <AlertCircle className="size-3 shrink-0" />
        <span>{it.message}</span>
      </div>
    )
  }

  return (
    <div className="group/msg flex flex-col gap-1.5">
      {!it.ok && it.text && (
        <div className="rounded-lg border border-st-error/40 bg-st-error/10 px-3 py-2">
          <div
            data-selectable
            className="font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/85"
          >
            {it.text}
          </div>
        </div>
      )}
      <TurnTelemetry it={it} />
      {feedback && it.ok && (
        <FeedbackControls agentTurn={it.text ?? ""} api={feedback} />
      )}
    </div>
  )
})

/** Revezamento: continuar a conversa em OUTRO agent (após limite ou erro).
 *  `subtle` = versão discreta pro cartão de erro comum. */
function ContinueRow({
  current,
  onPick,
  subtle,
}: {
  current: string
  onPick: (agent: string) => void
  subtle?: boolean
}) {
  const targets = DESTINATIONS.filter(
    (d) => d.available && d.kind === "agent" && d.id !== current,
  )
  if (targets.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!subtle && (
        <span className="text-[12px] text-muted-foreground">Revezamento:</span>
      )}
      {targets.map((d) => (
        <button
          key={d.id}
          onClick={() => onPick(d.id)}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors",
            subtle
              ? "text-muted-foreground hover:bg-accent hover:text-foreground"
              : "border-brass/40 bg-brass/10 text-brass hover:bg-brass/20",
          )}
        >
          <ArrowRightLeft className="size-3.5" /> Continuar no {d.label}
        </button>
      ))}
    </div>
  )
}

// Modelo de nós (buildNodes/continuesProse) mora em ./messageNodes — puro e
// testável, sem estragar o fast-refresh deste arquivo de componentes.

export function MessageList({
  items,
  running,
  finalizing,
  startedAt,
  agent,
  onContinueWith,
  feedback,
}: {
  items: ChatItem[]
  running: boolean
  finalizing: boolean
  startedAt: number | null
  agent: string
  /** Revezamento: continuar a conversa em outro agent (limite/erro). */
  onContinueWith?: (agent: string) => void
  /** Loop de feedback do Linear (M2). null/undefined fora do Linear. */
  feedback?: FeedbackApi | null
}) {
  const nodes = useMemo(() => buildNodes(items), [items])
  const tasks = useMemo(() => deriveTasks(items), [items])
  // Selo "lido / não foi aberto" por anexo. Calculado UMA vez aqui (varre o fio)
  // e entregue pronto ao MessageItem: fazer dentro do item quebraria o memo dele
  // a cada delta do streaming. Só muda quando items/running mudam.
  const attReads = useMemo(() => {
    const out: Record<string, { text: string; warn: boolean } | null> = {}
    items.forEach((it, i) => {
      if (it.kind !== "user" || !it.attachments?.length) return
      for (const a of it.attachments) {
        out[a.path] = attachmentReadLabel(
          attachmentRead(items, i, a, agent, running),
        )
      }
    })
    return out
  }, [items, agent, running])

  // Janela de renderização: conversa longa (já vimos 665KB de items) renderizava
  // TUDO — com diffs abertos por padrão o DOM explodia. Mostra os últimos
  // CHAT_WINDOW nós (agrupamento preservado) + botão pra revelar o histórico.
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = showAll ? 0 : Math.max(0, nodes.length - CHAT_WINDOW)
  const visible = hiddenCount > 0 ? nodes.slice(hiddenCount) : nodes

  // Custo acumulado da sessão (soma dos turnos com result), consciência de gasto.
  // Pula results seguidos de outro result (parciais da mesma invocação): somar
  // os parciais inflava a sessão (US$120 num turno que custou US$31).
  let sessionCost = 0
  let sessionEstimated = false
  let resultCount = 0
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind !== "result" || items[i + 1]?.kind === "result") continue
    resultCount++
    sessionCost += it.costUsd ?? 0
    if (it.costSource === "estimated" || it.costSource === "unknown")
      sessionEstimated = true
  }
  return (
    <div className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-4 px-8 py-8">
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="mx-auto rounded-full border bg-card/60 px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Mostrar {hiddenCount} itens anteriores
        </button>
      )}
      {visible.map((n, idx) => {
        if (n.type === "tasklist") {
          return (
            <div key={n.key} className="animate-cockpit-rise">
              <TaskChecklist tasks={tasks} />
            </div>
          )
        }
        const isLast = idx === visible.length - 1
        if (n.type === "prose") {
          // narração do turno (costurada) + as tools que ela disparou, juntas e
          // apertadas (gap-1.5): a palavra não é mais estraçalhada por um grupo
          // de status no meio. O grupo só "roda" quando é o último nó do run.
          const active = running && isLast
          const hasText = n.text.trim().length > 0
          return (
            <div key={n.key} className="group/msg flex flex-col gap-1.5">
              {hasText && <Markdown text={n.text} />}
              {n.tools.length > 0 && (
                <ToolGroup tools={n.tools} defaultOpen={active} active={active} />
              )}
              {feedback && hasText && (
                <FeedbackControls agentTurn={n.text} api={feedback} />
              )}
            </div>
          )
        }
        if (n.type === "tools") {
          return (
            <ToolGroup
              key={n.key}
              tools={n.tools}
              defaultOpen={running && isLast}
              active={running && isLast}
            />
          )
        }
        // cartão de limite/erro ganha a fileira de revezamento (só quando o
        // turno não está rodando; durante o run o Stop é o caminho).
        const continuable =
          onContinueWith &&
          !running &&
          (n.item.kind === "limit" || n.item.kind === "error") &&
          isLast
        if (continuable) {
          return (
            <div key={n.key} className="flex flex-col gap-2">
              <MessageItem item={n.item} feedback={feedback} reads={attReads} />
              <ContinueRow
                current={agent}
                onPick={onContinueWith}
                subtle={n.item.kind === "error"}
              />
            </div>
          )
        }
        return (
          <MessageItem
            key={n.key}
            item={n.item}
            feedback={feedback}
            reads={attReads}
          />
        )
      })}

      {(running || finalizing) && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="animate-cockpit-pulse size-2 rounded-full bg-st-running" />
          <span>
            {finalizing ? "finalizando…" : `${agentLabel(agent)} trabalhando…`}
          </span>
          {running && startedAt && (
            <span className="font-mono text-foreground/70">
              <Elapsed since={startedAt} />
            </span>
          )}
        </div>
      )}

      {resultCount >= 2 && sessionCost > 0 && (
        <div className="flex items-center gap-2 self-start pt-1">
          <span className="label-mono text-[9px]">Sessão</span>
          <span className="font-mono text-[11.5px] font-semibold tabular-nums text-brass">
            {fmtCost(sessionCost, sessionEstimated ? "estimated" : "reported")}
          </span>
        </div>
      )}
    </div>
  )
}
