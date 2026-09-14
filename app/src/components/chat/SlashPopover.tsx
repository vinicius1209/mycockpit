// Popover do "/" (ADR-189): o inventário em seções (Frota · Projeto · Plugins ·
// motor), um chip por item e o rodapé que diz DE ONDE veio a lista. O teclado
// chega pelo SlashMenuKeysPlugin do editor; aqui é só o desenho e o clique.
// O índice `idx` é o da lista plana, na mesma ordem das seções.

import { useEffect, useRef } from "react"
import { agentDef } from "@/lib/agents"
import { commandInventoryChannel, inventoryFootnote } from "@/lib/agentCommands"
import type { SlashSection } from "@/lib/slashSections"
import { slashChip } from "@/lib/slashSections"
import type { SlashInventoryMeta } from "@/hooks/useSlashCommands"
import type { Project } from "@/lib/types"
import { cn } from "@/lib/utils"

export function SlashPopover({
  project,
  agent,
  sections,
  inventory,
  idx,
  setIdx,
  onPick,
  now = Date.now(),
}: {
  project: Project | null
  agent: string
  sections: SlashSection[]
  inventory: SlashInventoryMeta | null
  idx: number
  setIdx: (i: number) => void
  onPick: (name: string) => void
  now?: number
}) {
  const listRef = useRef<HTMLDivElement>(null)
  // Item selecionado pelo teclado fica visível. Conta na caixa de rolagem da
  // própria lista, sem scrollIntoView (que rola ancestrais flexíveis, ADR-122).
  useEffect(() => {
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>(`[data-slash-idx="${idx}"]`)
    if (!list || !item) return
    const top = item.offsetTop
    const bottom = top + item.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight
  }, [idx])

  const agentLabel = agentDef(agent)?.label ?? agent
  const footnote = inventory
    ? inventoryFootnote({
        agentLabel,
        channel: commandInventoryChannel(agent),
        origin: inventory.origin,
        observedAt: inventory.observedAt,
        now,
      })
    : null
  let flatIdx = 0

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-xl border bg-popover shadow-[var(--shadow-pop)]">
      <div className="border-b px-3 py-1.5 text-[11px] tracking-wide text-muted-foreground uppercase">
        Comandos{project ? ` · ${project.name}` : ""}
      </div>
      <div ref={listRef} className="relative max-h-80 overflow-auto p-1">
        {sections.map((section) => (
          <div key={section.id} role="group" aria-label={section.label}>
            <div className="px-3 pt-2 pb-1 text-[11px] tracking-wide text-muted-foreground uppercase">
              {section.label}
            </div>
            {section.items.map((c) => {
              const i = flatIdx++
              return (
                <button
                  key={`${c.kind}:${c.name}`}
                  data-slash-idx={i}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => onPick(c.name)}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-1.5 text-left",
                    i === idx ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="truncate font-mono text-[13px] text-foreground">
                      /{c.name}
                    </span>
                    {/* um chip honesto: o que o item é (a seção diz de onde vem) */}
                    <span className="shrink-0 rounded border px-1 py-px text-[11px] tracking-wide text-muted-foreground uppercase">
                      {slashChip(c)}
                    </span>
                  </span>
                  {c.description && (
                    <span className="line-clamp-1 text-[12px] text-muted-foreground">
                      {c.description}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {(footnote || (inventory?.diagnostics.length ?? 0) > 0) && (
        <div className="space-y-0.5 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          {inventory?.diagnostics.map((d) => (
            <p key={d} className="text-st-warning">
              {d}
            </p>
          ))}
          {footnote && <p>{footnote}</p>}
        </div>
      )}
    </div>
  )
}
