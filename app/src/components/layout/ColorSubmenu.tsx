import { Ban } from "lucide-react"
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import { LABEL_COLORS } from "@/lib/labelColors"
import { cn } from "@/lib/utils"

/** Submenu de cor reusado (conversa + projeto): swatches + remover. Mora fora
 *  do `Sidebar.tsx` porque a lista de conversas saiu de lá (catraca de tamanho)
 *  e os dois donos precisam do mesmo submenu, sem import circular. */
export function ColorSubmenu({
  current,
  onPick,
}: {
  current?: string | null
  onPick: (color: string | null) => void
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <span
          className="size-3.5 rounded-full border"
          style={current ? { background: current } : undefined}
        />
        Cor
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <div className="grid grid-cols-3 gap-1 p-1">
          {LABEL_COLORS.map((c) => (
            <ContextMenuItem
              key={c.id}
              title={c.name}
              onSelect={() => onPick(c.hex)}
              className="justify-center p-1.5"
            >
              <span
                className={cn(
                  "size-4 rounded-full",
                  current === c.hex &&
                    "ring-2 ring-foreground/40 ring-offset-1 ring-offset-popover",
                )}
                style={{ background: c.hex }}
              />
            </ContextMenuItem>
          ))}
        </div>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onPick(null)}>
          <Ban /> Remover cor
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}
