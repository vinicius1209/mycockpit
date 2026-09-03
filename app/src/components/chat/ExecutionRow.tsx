import { cn } from "@/lib/utils"
import { permissionNote } from "@/lib/permissionNote"
import type { PermissionMode } from "@/lib/types"

/**
 * Linha de EXECUÇÃO simplificada — agora renderiza apenas avisos de segurança/permissão
 * quando ativos (por exemplo, aviso de incompatibilidade do Agy ou aviso de turno em voo).
 * Os seletores e controles de permissão, "Planeja antes" e identidade foram movidos
 * para o rodapé do composer no padrão do mockup de alta fidelidade (Paseo.sh).
 */
export function ExecutionRow({
  running,
  convAgent,
  mode,
}: {
  running?: boolean
  /** Agent EFETIVO da conversa (travado no 1º run) — quem obedece, ou não, ao modo. */
  convAgent: string | null
  mode: PermissionMode
}) {
  const note = convAgent ? permissionNote(convAgent, mode) : null

  if (!running && !note) return null

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="flex flex-col gap-1 px-3 pt-2 text-[11px]"
    >
      {/* O processo já nasceu com a permissão anterior. Manter a escolha
          editável preserva a preparação do próximo envio; esta frase impede
          que o controle pareça alterar retroativamente o turno em voo. */}
      {running && (
        <p className="leading-snug text-muted-foreground">
          Turno em andamento: a permissão vale a partir do próximo envio.
        </p>
      )}
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
