import type { ReactNode } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export interface RichOption {
  value: string
  label: string
  description?: string
  badge?: string
  disabled?: boolean
}

// Trigger minimalista (padrão ai-02 do blocks.so): sem pílula/borda, transparente,
// muted → foreground no hover. Tom/altura/padding por call site.
const BASE_TRIGGER =
  "w-fit border-0 bg-transparent! text-[12px] shadow-none transition-colors hover:text-foreground focus-visible:ring-0"

function OptBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-brass/40 px-1 py-px text-[10px] font-medium tracking-wide text-brass uppercase">
      {children}
    </span>
  )
}

/** Select "rico": cada opção mostra nome + badge (inline) + descrição (linha 2), com
 *  check no selecionado (do shadcn). Trigger em pílula mostra só o nome + badge.
 *  Unifica agent/modelo/effort no mesmo padrão. */
export function RichSelect({
  value,
  onValueChange,
  options,
  disabled,
  align = "start",
  triggerClassName,
  title,
  dot,
  "aria-label": ariaLabel,
}: {
  value: string
  onValueChange: (v: string) => void
  options: RichOption[]
  disabled?: boolean
  align?: "start" | "center" | "end"
  triggerClassName?: string
  title?: string
  /** Bolinha de status à esquerda no trigger (usada no seletor de agent). */
  dot?: boolean
  "aria-label"?: string
}) {
  const selected = options.find((o) => o.value === value) ?? options[0]
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        aria-label={ariaLabel}
        title={title}
        className={cn(BASE_TRIGGER, triggerClassName)}
      >
        {dot && (
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              selected?.disabled ? "bg-st-idle" : "bg-brass",
            )}
          />
        )}
        <SelectValue>
          <span className="flex items-center gap-1.5">
            <span>{selected?.label}</span>
            {selected?.badge && <OptBadge>{selected.badge}</OptBadge>}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align={align} className="min-w-60">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5">
                <span className="text-[13px] text-foreground">{o.label}</span>
                {o.badge && <OptBadge>{o.badge}</OptBadge>}
              </span>
              {o.description && (
                <span className="text-[11.5px] leading-snug text-muted-foreground">
                  {o.description}
                </span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
