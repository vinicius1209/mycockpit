import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ColorSwatch({
  color,
  label,
  selected,
  onSelect,
}: {
  color: string
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icone-chip"
      onClick={onSelect}
      title={label}
      aria-label={`Cor ${label}`}
      aria-pressed={selected}
      className={cn(
        "rounded-full border border-border p-0",
        selected && "ring-2 ring-foreground",
      )}
      style={{ backgroundColor: color }}
    />
  )
}
