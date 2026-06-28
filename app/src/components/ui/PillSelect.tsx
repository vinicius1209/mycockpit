import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export interface PillOption {
  value: string
  label: string
  disabled?: boolean
}

// Classe-base da "pílula" (rounded-full + bg-secondary) compartilhada por todos os
// seletores em pílula. Altura/padding/gap/tom ficam por call site (triggerClassName),
// preservando as variações de cada lugar (h-7/h-8, tom muted/foreground).
const PILL_TRIGGER =
  "w-fit rounded-full border bg-secondary/50 text-[12px] shadow-none focus-visible:ring-0"

/** Select em formato de "pílula" para listas simples de opções {value,label}. */
export function PillSelect({
  value,
  onValueChange,
  options,
  disabled,
  align = "start",
  triggerClassName,
  itemClassName,
  contentClassName,
  placeholder,
  title,
  "aria-label": ariaLabel,
}: {
  value: string
  onValueChange: (v: string) => void
  options: PillOption[]
  disabled?: boolean
  align?: "start" | "center" | "end"
  triggerClassName?: string
  itemClassName?: string
  contentClassName?: string
  placeholder?: string
  title?: string
  "aria-label"?: string
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        aria-label={ariaLabel}
        title={title}
        className={cn(PILL_TRIGGER, triggerClassName)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent align={align} className={contentClassName}>
        {options.map((o) => (
          <SelectItem
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            className={itemClassName}
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
