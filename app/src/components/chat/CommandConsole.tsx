import { useEffect, useRef, useState } from "react"
import { ArrowUp, Paperclip, Sparkles, Square } from "lucide-react"
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
import { useActiveConv } from "@/store/chat"
import { useActiveProject } from "@/store/app"
import {
  readProjectCommands,
  listProjectFiles,
  readProjectSources,
} from "@/lib/sources"
import type { SlashCommand } from "@/lib/sources"
import { isTauri } from "@/lib/db"
import { cn } from "@/lib/utils"
import type { Destination } from "@/lib/types"

const DESTINATIONS: Destination[] = [
  { id: "claude-code", label: "Claude Code", kind: "agent", available: true, hint: "Agent" },
  { id: "codex", label: "Codex", kind: "agent", available: false, hint: "em breve" },
  { id: "opencode", label: "OpenCode", kind: "agent", available: false, hint: "em breve" },
  { id: "model", label: "Modelo direto", kind: "model", available: false, hint: "em breve" },
]

const CHIPS = [
  { label: "Explicar o projeto", prompt: "Explique a arquitetura deste projeto em alto nível." },
  { label: "Rodar os testes", prompt: "Rode a suíte de testes e me mostre o resultado." },
  { label: "Criar uma branch", prompt: "Crie uma branch nova a partir da main para esta tarefa." },
]

export function CommandConsole({
  onSend,
  disabled,
  running,
  onStop,
}: {
  onSend: (text: string, destinationId: string) => void
  disabled?: boolean
  running?: boolean
  onStop?: () => void
}) {
  const [value, setValue] = useState("")
  const [destination, setDestination] = useState(DESTINATIONS[0].id)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const conv = useActiveConv()
  const suggestions = conv.suggestions
  const suggesting = conv.suggesting
  const project = useActiveProject()
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [slashIdx, setSlashIdx] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)

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

  const dest = DESTINATIONS.find((d) => d.id === destination) ?? DESTINATIONS[0]
  const canSend = value.trim().length > 0 && !disabled && !running

  function submit() {
    if (!canSend) return
    onSend(value.trim(), destination)
    setValue("")
    ref.current?.focus()
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
                  <span className="shrink-0 rounded border px-1 py-px text-[8.5px] tracking-wide text-muted-foreground uppercase">
                    {c.kind === "skill" ? "skill" : "cmd"}
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
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setCursor(e.target.selectionStart ?? e.target.value.length)
            setSlashDismissed(false)
            setAtDismissed(false)
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
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
          <Select value={destination} onValueChange={setDestination}>
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

          <div className="ml-auto flex items-center gap-1.5">
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
