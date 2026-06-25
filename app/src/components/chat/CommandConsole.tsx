import { useRef, useState } from "react"
import { ArrowUp, Paperclip } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
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
}: {
  onSend: (text: string, destinationId: string) => void
  disabled?: boolean
}) {
  const [value, setValue] = useState("")
  const [destination, setDestination] = useState(DESTINATIONS[0].id)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  const dest = DESTINATIONS.find((d) => d.id === destination) ?? DESTINATIONS[0]
  const canSend = value.trim().length > 0 && !disabled

  function submit() {
    if (!canSend) return
    onSend(value.trim(), destination)
    setValue("")
    ref.current?.focus()
  }

  return (
    <div className="flex w-full flex-col gap-3">
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
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Peça algo ao seu time de agents…"
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
              className="rounded-full text-muted-foreground hover:text-foreground"
              title="Anexar arquivo"
              aria-label="Anexar arquivo"
            >
              <Paperclip className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              onClick={submit}
              disabled={!canSend}
              className="rounded-full"
              aria-label="Enviar"
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
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
        ))}
      </div>
    </div>
  )
}
