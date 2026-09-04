import { cn } from "@/lib/utils"
import { permissionNote } from "@/lib/permissionNote"
import type { PermissionMode } from "@/lib/types"

/**
 * Linha de EXECUÇÃO simplificada — renderiza apenas incompatibilidades reais
 * entre o modo escolhido e o agent efetivo.
 * Os seletores e controles de permissão, "Planeja antes" e identidade foram movidos
 * para o rodapé do composer no padrão do mockup de alta fidelidade (Paseo.sh).
 */
export function ExecutionRow({
  convAgent,
  mode,
}: {
  /** Agent EFETIVO da conversa (travado no 1º run) — quem obedece, ou não, ao modo. */
  convAgent: string | null
  mode: PermissionMode
}) {
  const note = convAgent ? permissionNote(convAgent, mode) : null

  if (!note) return null

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="flex flex-col gap-1 px-3 pt-2 text-[11px]"
    >
      {/* O modo é do projeto, mas quem obedece é a CLI da conversa — e elas
          divergem (o agy não tem canal de aprovação nenhum). */}
      {note && (
        <p
          className={cn(
            "leading-snug",
            note.tone === "warn" ? "text-st-warning/90" : "text-muted-foreground",
          )}
        >
          {note.text}
        </p>
      )}
    </div>
  )
}
