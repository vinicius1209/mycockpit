import { cn } from "@/lib/utils"
import { lineDiff, trimOuterContext, type DiffRow } from "@/lib/linediff"

const MAX_LINES = 80

/** Reúne os hunks de um tool de edição sem interpretar outros comandos. */
export function editHunks(
  name: string,
  input: Record<string, unknown>,
): { hunks: DiffRow[][]; added: number; removed: number } | null {
  const accumulated = { hunks: [] as DiffRow[][], added: 0, removed: 0 }
  const push = (oldText: string, newText: string) => {
    const diff = lineDiff(oldText, newText)
    accumulated.hunks.push(diff.rows)
    accumulated.added += diff.added
    accumulated.removed += diff.removed
  }
  if (
    name === "Edit" &&
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    push(input.old_string, input.new_string)
    return accumulated
  }
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    for (const edit of input.edits as Record<string, unknown>[]) {
      if (edit && typeof edit.old_string === "string") {
        push(
          edit.old_string,
          typeof edit.new_string === "string" ? edit.new_string : "",
        )
      }
    }
    return accumulated.hunks.length ? accumulated : null
  }
  if (name === "Write" && typeof input.content === "string") {
    push("", input.content)
    return accumulated
  }
  return null
}

/** Diff unificado compacto, usado dentro do fio para Edit, MultiEdit e Write. */
export function UnifiedDiff({ rows }: { rows: DiffRow[] }) {
  const trimmed = trimOuterContext(rows)
  const shown = trimmed.slice(0, MAX_LINES)
  const hidden = trimmed.length - shown.length
  return (
    <div className="overflow-x-auto py-1 font-mono text-[12px] leading-relaxed">
      {shown.map((row, index) => (
        <div
          key={index}
          className={cn(
            "flex gap-2 px-2",
            row.type === "add" && "bg-accent/35",
            row.type === "del" && "bg-st-error/10",
          )}
        >
          <span
            className={cn(
              "w-3 shrink-0 select-none text-center",
              row.type === "add"
                ? "text-foreground/60"
                : row.type === "del"
                  ? "text-st-error"
                  : "text-transparent",
            )}
          >
            {row.type === "add" ? "+" : row.type === "del" ? "−" : " "}
          </span>
          <span
            data-selectable
            className={cn(
              "break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
              row.type === "ctx" ? "text-muted-foreground/70" : "text-foreground/85",
            )}
          >
            {row.text || " "}
          </span>
        </div>
      ))}
      {hidden > 0 && (
        <div className="px-2 pl-7 text-muted-foreground">… +{hidden} linhas</div>
      )}
    </div>
  )
}
