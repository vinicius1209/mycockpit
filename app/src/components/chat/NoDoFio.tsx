import type { ReactNode } from "react"
import { useNasceuAgora } from "@/lib/nascimento"
import { cn } from "@/lib/utils"

/** O embrulho de um nó do fio: âncora de revelação (`data-chat-item-ids`, que
 *  a aba Conversa usa para achar a fonte) e a entrada de quem NASCE agora
 *  (ADR-179). Só opacidade: texto que chega não empurra o que já foi lido.
 *
 *  `ts` ausente = não anima. O MessageList não passa `ts` para o 1º nó do grupo
 *  (ele entra com o próprio grupo) nem para nós que animam a si mesmos (a linha
 *  de ação e o marco de plano), senão a mesma chegada tocaria duas vezes. */
export function NoDoFio({
  ids,
  revelado,
  ts,
  children,
}: {
  ids: string[]
  revelado?: string | null
  ts?: number
  children: ReactNode
}) {
  const nasceu = useNasceuAgora(ts)
  return (
    <div
      data-chat-item-ids={ids.join(" ")}
      className={cn(
        "min-w-0 rounded-md transition-colors",
        ids.includes(revelado ?? "") && "bg-brass-soft",
        nasceu && "fio-nasce",
      )}
    >
      {children}
    </div>
  )
}
