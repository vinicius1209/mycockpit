import { useEffect, useRef, useState } from "react"
import {
  ArrowUp,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Sparkles,
  Square,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { open } from "@tauri-apps/plugin-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useActiveConv, useChat } from "@/store/chat"
import { useActiveProject } from "@/store/app"
import {
  readProjectCommands,
  listProjectFiles,
  readProjectSources,
} from "@/lib/sources"
import type { SlashCommand } from "@/lib/sources"
import { isTauri } from "@/lib/db"
import { cn } from "@/lib/utils"
import type { Attachment } from "@/lib/attachments"
import {
  AGENT_CAPS,
  MAX_ATTACH_BYTES,
  MAX_ATTACH_COUNT,
  saveAttachment,
  deleteAttachment,
} from "@/lib/attachments"
import { useFusion, type LeagueConfig } from "@/store/fusion"
import type { Destination } from "@/lib/types"

const DESTINATIONS: Destination[] = [
  { id: "claude-code", label: "Claude Code", kind: "agent", available: true, hint: "Agent" },
  { id: "codex", label: "Codex", kind: "agent", available: true, hint: "Agent" },
  { id: "opencode", label: "OpenCode", kind: "agent", available: false, hint: "em breve" },
  { id: "model", label: "Modelo direto", kind: "model", available: false, hint: "em breve" },
]

const CHIPS = [
  { label: "Explicar o projeto", prompt: "Explique a arquitetura deste projeto em alto nível." },
  { label: "Rodar os testes", prompt: "Rode a suíte de testes e me mostre o resultado." },
  { label: "Criar uma branch", prompt: "Crie uma branch nova a partir da main para esta tarefa." },
]

// Modelo + effort por agent (valores verificados vs --help/doc oficial).
// "default" = não passa flag (usa o default do CLI/config).
const MODELS: Record<string, { value: string; label: string }[]> = {
  "claude-code": [
    { value: "default", label: "modelo" },
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
    { value: "haiku", label: "Haiku" },
  ],
  codex: [
    { value: "default", label: "modelo" },
    { value: "gpt-5.5", label: "gpt-5.5" },
    { value: "o3", label: "o3" },
  ],
}
const EFFORTS: Record<string, { value: string; label: string }[]> = {
  "claude-code": [
    { value: "default", label: "effort" },
    { value: "low", label: "low" },
    { value: "medium", label: "medium" },
    { value: "high", label: "high" },
    { value: "xhigh", label: "xhigh" },
    { value: "max", label: "max" },
  ],
  codex: [
    { value: "default", label: "effort" },
    { value: "minimal", label: "minimal" },
    { value: "low", label: "low" },
    { value: "medium", label: "medium" },
    { value: "high", label: "high" },
    { value: "xhigh", label: "xhigh" },
  ],
}
// Modelo pré-selecionado por agent (o default observado de cada um). Como passar
// o default explícito é equivalente a não passar, é seguro pré-selecionar.
const DEFAULT_MODEL: Record<string, string> = {
  "claude-code": "opus",
  codex: "gpt-5.5",
}

export function CommandConsole({
  onSend,
  disabled,
  running,
  finalizing,
  onStop,
}: {
  onSend: (
    text: string,
    cfg: { agent: string; model: string | null; effort: string | null },
    attachments: Attachment[],
  ) => void
  disabled?: boolean
  running?: boolean
  finalizing?: boolean
  onStop?: () => void
}) {
  const [value, setValue] = useState("")
  const [destination, setDestination] = useState(DESTINATIONS[0].id)
  const [model, setModel] = useState(
    DEFAULT_MODEL[DESTINATIONS[0].id] ?? "default",
  )
  const [effort, setEffort] = useState("default")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const conv = useActiveConv()
  const suggestions = conv.suggestions
  const suggesting = conv.suggesting
  const project = useActiveProject()
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [slashIdx, setSlashIdx] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  // histórico tipo shell (↑/↓ recupera prompts já enviados). null = editando.
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const [draft, setDraft] = useState("")
  const activeId = useChat((s) => s.activeId)

  // comandos do projeto p/ o "/" (.claude/commands)
  useEffect(() => {
    if (!project || !isTauri()) {
      setCommands([])
      return
    }
    readProjectCommands(project.path)
      .then(setCommands)
      .catch(() => setCommands([]))
  }, [project?.path])

  // "/" no início do input (sem espaço) → modo slash
  const slashQuery = value.match(/^\/([\w:-]*)$/)?.[1] ?? null
  const slashMatches =
    slashQuery !== null
      ? commands
          .filter((c) => c.name.toLowerCase().includes(slashQuery.toLowerCase()))
          .slice(0, 8)
      : []
  const showSlash = !slashDismissed && slashMatches.length > 0

  useEffect(() => {
    setSlashIdx(0)
  }, [slashQuery])

  function insertCommand(name: string) {
    setValue(`/${name} `)
    ref.current?.focus()
  }

  // ---- "@" referências (arquivos + agents), mid-text ----
  const [files, setFiles] = useState<string[]>([])
  const [agents, setAgents] = useState<string[]>([])
  const [cursor, setCursor] = useState(0)
  const [atIdx, setAtIdx] = useState(0)
  const [atDismissed, setAtDismissed] = useState(false)
  const mentionLoadedRef = useRef<string | null>(null)

  // token "@..." antes do cursor (precedido por início ou espaço)
  const before = value.slice(0, cursor)
  const atMatch = before.match(/(?:^|\s)@(\S*)$/)
  const atQuery = atMatch ? atMatch[1] : null

  // carrega arquivos + agents lazy (1ª vez que o @ aparece, cache por projeto)
  useEffect(() => {
    if (atQuery === null || !project || !isTauri()) return
    if (mentionLoadedRef.current === project.path) return
    mentionLoadedRef.current = project.path
    void listProjectFiles(project.path)
      .then(setFiles)
      .catch(() => setFiles([]))
    void readProjectSources(project.path)
      .then((s) => setAgents(s.personas.map((p) => p.name)))
      .catch(() => setAgents([]))
  }, [atQuery, project?.path])

  const atItems: { kind: "agent" | "file"; value: string }[] =
    atQuery === null
      ? []
      : [
          ...agents
            .filter((a) => a.toLowerCase().includes(atQuery.toLowerCase()))
            .map((a) => ({ kind: "agent" as const, value: a })),
          ...files
            // tira os .claude/agents/*.md — já estão listados como AGENT acima
            .filter(
              (f) =>
                !f.startsWith(".claude/agents/") &&
                f.toLowerCase().includes(atQuery.toLowerCase()),
            )
            .map((f) => ({ kind: "file" as const, value: f })),
        ].slice(0, 8)
  const showAt = !atDismissed && atItems.length > 0

  useEffect(() => {
    setAtIdx(0)
  }, [atQuery])

  function insertMention(val: string) {
    if (!atMatch) return
    const atStart = cursor - (atMatch[1].length + 1)
    const next = `${value.slice(0, atStart)}@${val} ${value.slice(cursor)}`
    const pos = atStart + val.length + 2
    setValue(next)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(pos, pos)
      setCursor(pos)
    })
  }

  // conversa estabelecida trava no agent/modelo/effort dela; o seletor reflete
  const locked = conv.items.length > 0
  const effectiveDest = locked ? conv.agent : destination
  const effectiveModel = locked ? (conv.reqModel ?? "default") : model
  const effectiveEffort = locked ? (conv.effort ?? "default") : effort
  const dest =
    DESTINATIONS.find((d) => d.id === effectiveDest) ?? DESTINATIONS[0]
  // trava de capacidade: o agent-alvo precisa suportar cada anexo (espelha o trait)
  const caps = AGENT_CAPS[effectiveDest] ?? { image: false, pdf: false }
  const allSupported = attachments.every((a) =>
    a.kind === "image" ? caps.image : a.kind === "pdf" ? caps.pdf : false,
  )
  const canSend =
    (value.trim().length > 0 || attachments.length > 0) &&
    !disabled &&
    !running &&
    !finalizing &&
    allSupported

  // Histórico tipo shell: os prompts já enviados nesta conversa (mais novo = fim).
  const userPrompts = conv.items.flatMap((it) =>
    it.kind === "user" ? [it.text] : [],
  )

  function recallPrev() {
    if (userPrompts.length === 0) return
    if (histIdx === null) {
      setDraft(value)
      setHistIdx(userPrompts.length - 1)
      setValue(userPrompts[userPrompts.length - 1])
    } else if (histIdx > 0) {
      setHistIdx(histIdx - 1)
      setValue(userPrompts[histIdx - 1])
    }
  }

  function recallNext() {
    if (histIdx === null) return
    const idx = histIdx + 1
    if (idx >= userPrompts.length) {
      setHistIdx(null)
      setValue(draft)
    } else {
      setHistIdx(idx)
      setValue(userPrompts[idx])
    }
  }

  // depois de recuperar, leva o cursor pro fim p/ editar
  useEffect(() => {
    if (histIdx !== null && ref.current) {
      const len = ref.current.value.length
      ref.current.setSelectionRange(len, len)
    }
  }, [histIdx])

  // trocar de conversa zera o histórico + os anexos pendentes (F19)
  useEffect(() => {
    setHistIdx(null)
    setDraft("")
    setAttachments([])
  }, [activeId])

  function submit() {
    if (!canSend) return
    onSend(
      value.trim(),
      {
        agent: effectiveDest,
        model: model === "default" ? null : model,
        effort: effort === "default" ? null : effort,
      },
      attachments,
    )
    setValue("")
    setAttachments([])
    setHistIdx(null)
    setDraft("")
    ref.current?.focus()
  }

  // Fusion — dispara a disputa com a liga default (agent atual + o complementar).
  // O League Builder configurável é o próximo polimento.
  async function submitFusion() {
    const text = value.trim()
    if (!text || !project || !activeId) return
    const complementary = effectiveDest === "codex" ? "claude-code" : "codex"
    const cfg: LeagueConfig = {
      scope: "read-only",
      judgeModel: "sonnet",
      candidates: [
        {
          agent: effectiveDest,
          model: model === "default" ? null : model,
          effort: effort === "default" ? null : effort,
        },
        { agent: complementary, model: null, effort: null },
      ],
    }
    setValue("")
    setHistIdx(null)
    setDraft("")
    await useFusion
      .getState()
      .launch(activeId, cfg, text, [], project.path, project.permissionMode ?? "padrao")
  }

  function removeAttachment(path: string) {
    setAttachments((a) => a.filter((x) => x.path !== path))
    void deleteAttachment(path)
  }

  function insertAtCursor(insert: string) {
    const ta = ref.current
    if (!ta) {
      setValue((v) => v + insert)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    setValue((v) => v.slice(0, start) + insert + v.slice(end))
  }

  // Colar imagem/PDF: captura os File SÍNCRONO antes de qualquer await (F21),
  // preserva o texto colado junto (F20), valida tamanho/contagem (F8/F22), salva.
  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!isTauri() || !activeId) return
    const files = [...e.clipboardData.items]
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter(
        (f): f is File =>
          !!f &&
          (f.type.startsWith("image/") ||
            f.type === "application/pdf" ||
            f.type === ""),
      )
    if (!files.length) return // paste de texto puro → comportamento default
    const text = e.clipboardData.getData("text/plain")
    e.preventDefault()
    if (text) insertAtCursor(text)
    let count = attachments.length
    for (const f of files) {
      if (f.size > MAX_ATTACH_BYTES) {
        toast.error(`"${f.name || "anexo"}" excede 10 MB`)
        continue
      }
      if (count >= MAX_ATTACH_COUNT) {
        toast.error("máx. 8 anexos por mensagem")
        break
      }
      try {
        const buf = new Uint8Array(await f.arrayBuffer())
        const att = await saveAttachment(activeId, f.name || "colado", f.type, buf)
        setAttachments((a) => [...a, att])
        count++
      } catch (err) {
        toast.error(typeof err === "string" ? err : "falha ao anexar")
      }
    }
  }

  // Anexo real (B3 — inspirado no ai-04): file picker do Tauri → insere @path.
  async function attach() {
    if (!isTauri()) return
    const sel = await open({ multiple: true, title: "Anexar arquivo(s)" })
    if (!sel) return
    const paths = (Array.isArray(sel) ? sel : [sel]).filter(Boolean) as string[]
    if (!paths.length) return
    const refs = paths.map((p) => `@${p}`).join(" ")
    setValue((v) => (v.trim() ? `${v} ${refs}` : refs))
    ref.current?.focus()
  }

  return (
    <div className="relative flex w-full flex-col gap-3">
      {showSlash && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-xl border bg-popover shadow-[var(--shadow-pop)]">
          <div className="border-b px-3 py-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
            Comandos{project ? ` · ${project.name}` : ""}
          </div>
          <div className="max-h-64 overflow-auto p-1">
            {slashMatches.map((c, i) => (
              <button
                key={`${c.kind}:${c.name}`}
                onMouseEnter={() => setSlashIdx(i)}
                onClick={() => insertCommand(c.name)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-1.5 text-left",
                  i === slashIdx ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="font-mono text-[13px] text-foreground">
                    /{c.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {c.origin === "global" && (
                      <span className="text-[8.5px] tracking-wide text-muted-foreground/55 uppercase">
                        global
                      </span>
                    )}
                    <span className="rounded border px-1 py-px text-[8.5px] tracking-wide text-muted-foreground uppercase">
                      {c.kind === "skill" ? "skill" : "cmd"}
                    </span>
                  </span>
                </span>
                {c.description && (
                  <span className="line-clamp-1 text-[11.5px] text-muted-foreground">
                    {c.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      {showAt && !showSlash && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-xl border bg-popover shadow-[var(--shadow-pop)]">
          <div className="border-b px-3 py-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
            Referências{project ? ` · ${project.name}` : ""}
          </div>
          <div className="max-h-64 overflow-auto p-1">
            {atItems.map((m, i) => (
              <button
                key={`${m.kind}:${m.value}`}
                onMouseEnter={() => setAtIdx(i)}
                onClick={() => insertMention(m.value)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left",
                  i === atIdx ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="truncate font-mono text-[12.5px] text-foreground">
                  @{m.value}
                </span>
                <span className="shrink-0 rounded border px-1 py-px text-[8.5px] tracking-wide text-muted-foreground uppercase">
                  {m.kind}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        onClick={() => ref.current?.focus()}
        className={cn(
          "flex cursor-text flex-col rounded-2xl border bg-card transition-[box-shadow,border-color] duration-200",
          "shadow-[var(--shadow-pop)]",
          focused
            ? "border-brass/70 shadow-[0_0_0_3px_var(--brass-soft),var(--shadow-pop)]"
            : "hover:border-border-strong",
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {attachments.map((a) => {
              const ok =
                a.kind === "image"
                  ? caps.image
                  : a.kind === "pdf"
                    ? caps.pdf
                    : false
              const Icon = a.kind === "pdf" ? FileText : ImageIcon
              return (
                <span
                  key={a.path}
                  title={ok ? a.name : `${a.name} — não suportado por ${dest.label}`}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px]",
                    ok
                      ? "bg-secondary/50 text-foreground/80"
                      : "border-st-error/50 bg-st-error/10 text-st-error",
                  )}
                >
                  <Icon className="size-3 shrink-0" />
                  <span className="max-w-[140px] truncate">{a.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeAttachment(a.path)
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              )
            })}
          </div>
        )}
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setCursor(e.target.selectionStart ?? e.target.value.length)
            setSlashDismissed(false)
            setAtDismissed(false)
            setHistIdx(null)
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (showSlash) {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setSlashIdx((i) => (i + 1) % slashMatches.length)
                return
              }
              if (e.key === "ArrowUp") {
                e.preventDefault()
                setSlashIdx(
                  (i) => (i - 1 + slashMatches.length) % slashMatches.length,
                )
                return
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault()
                insertCommand(slashMatches[slashIdx].name)
                return
              }
              if (e.key === "Escape") {
                e.preventDefault()
                setSlashDismissed(true)
                return
              }
            }
            if (showAt && !showSlash) {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setAtIdx((i) => (i + 1) % atItems.length)
                return
              }
              if (e.key === "ArrowUp") {
                e.preventDefault()
                setAtIdx((i) => (i - 1 + atItems.length) % atItems.length)
                return
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault()
                insertMention(atItems[atIdx].value)
                return
              }
              if (e.key === "Escape") {
                e.preventDefault()
                setAtDismissed(true)
                return
              }
            }
            // histórico tipo shell: ↑ recupera prompts (cursor na 1ª linha),
            // ↓ avança; só fora dos popovers de / e @.
            if (!showSlash && !showAt) {
              const ta = e.currentTarget
              const before = value.slice(0, ta.selectionStart ?? 0)
              const after = value.slice(ta.selectionEnd ?? value.length)
              if (
                e.key === "ArrowUp" &&
                !before.includes("\n") &&
                userPrompts.length > 0
              ) {
                e.preventDefault()
                recallPrev()
                return
              }
              if (
                e.key === "ArrowDown" &&
                histIdx !== null &&
                !after.includes("\n")
              ) {
                e.preventDefault()
                recallNext()
                return
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={
            commands.length > 0
              ? "Peça algo…  ou / para comandos"
              : "Peça algo ao seu time de agents…"
          }
          rows={1}
          className="max-h-[240px] min-h-[56px] resize-none border-0 bg-transparent! px-4 pt-3.5 text-[15px] leading-relaxed text-foreground shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />

        <div className="flex items-center gap-2 p-2.5 pt-1">
          <Select
            value={effectiveDest}
            onValueChange={(v) => {
              setDestination(v)
              setModel(DEFAULT_MODEL[v] ?? "default")
              setEffort("default")
            }}
            disabled={locked}
          >
            <SelectTrigger className="h-8 w-fit gap-2 rounded-full border bg-secondary/50 pr-2 pl-2.5 text-[13px] text-foreground shadow-none focus-visible:ring-0 data-[size=default]:h-8">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  dest.available ? "bg-brass" : "bg-st-idle",
                )}
              />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" className="min-w-56">
              {DESTINATIONS.map((d) => (
                <SelectItem
                  key={d.id}
                  value={d.id}
                  disabled={!d.available}
                  className="gap-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-[13px]">{d.label}</span>
                    <span
                      className={cn(
                        "rounded border px-1 py-px text-[9px] font-medium tracking-wide uppercase",
                        d.available
                          ? "border-brass/40 text-brass"
                          : "text-muted-foreground",
                      )}
                    >
                      {d.hint}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={effectiveModel} onValueChange={setModel} disabled={locked}>
            <SelectTrigger className="h-8 w-fit gap-1 rounded-full border bg-secondary/50 px-2.5 text-[12px] text-muted-foreground shadow-none focus-visible:ring-0 data-[size=default]:h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {(MODELS[effectiveDest] ?? []).map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-[13px]">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={effectiveEffort}
            onValueChange={setEffort}
            disabled={locked}
          >
            <SelectTrigger className="h-8 w-fit gap-1 rounded-full border bg-secondary/50 px-2.5 text-[12px] text-muted-foreground shadow-none focus-visible:ring-0 data-[size=default]:h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {(EFFORTS[effectiveDest] ?? []).map((e) => (
                <SelectItem key={e.value} value={e.value} className="text-[13px]">
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void submitFusion()}
              disabled={!value.trim() || disabled || running || finalizing}
              title="Disputar entre agents (Fusion)"
              className="rounded-full text-muted-foreground hover:text-brass"
            >
              <Sparkles className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={attach}
              className="rounded-full text-muted-foreground hover:text-foreground"
              title="Anexar arquivo"
              aria-label="Anexar arquivo"
            >
              <Paperclip className="size-4" />
            </Button>
            {running ? (
              <Button
                size="icon-sm"
                onClick={onStop}
                className="rounded-full"
                aria-label="Parar"
                title="Parar"
              >
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                onClick={submit}
                disabled={!canSend}
                className="rounded-full"
                aria-label="Enviar"
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {suggesting && suggestions.length === 0 ? (
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-3 py-1.5 text-[13px] text-muted-foreground">
            <Sparkles className="size-3.5 animate-pulse text-brass" />
            buscando sugestões…
          </span>
        ) : suggestions.length > 0 ? (
          suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => {
                setValue(s)
                ref.current?.focus()
              }}
              className="flex items-center gap-1.5 rounded-full border border-brass/30 bg-brass/5 px-3 py-1.5 text-[13px] text-foreground/80 transition-colors hover:border-brass/60 hover:bg-brass/10 hover:text-foreground"
            >
              <Sparkles className="size-3 text-brass" />
              {s}
            </button>
          ))
        ) : (
          CHIPS.map((c) => (
            <button
              key={c.label}
              onClick={() => {
                setValue(c.prompt)
                ref.current?.focus()
              }}
              className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground"
            >
              {c.label}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
