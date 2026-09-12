import { Ban } from "lucide-react"
import { rotuloDoCorte } from "@/lib/corte"
import { useNasceuAgora } from "@/lib/nascimento"
import { cn } from "@/lib/utils"
import type { ChatItem } from "@/store/chat"

/** O marco de uma interrupção no fio (ADR-180). Diz QUEM cortou quando o gesto
 *  carimbou a causa; sem causa (reconciliação, histórico antigo) diz só
 *  "interrompido". É estado, e fica: a brasa no bloco de cima é só a chegada. */
export function MarcoDeCorte({
  item,
}: {
  item: Extract<ChatItem, { kind: "cancelled" }>
}) {
  const nasceu = useNasceuAgora(item.ts)
  return (
    <div
      data-corte={item.cause ?? "sem-causa"}
      className={cn(
        "flex items-center gap-2 pt-1 text-[12px] text-muted-foreground",
        nasceu && "fio-nasce",
      )}
    >
      <Ban className="size-3.5" />
      <span>{rotuloDoCorte(item.cause)}</span>
    </div>
  )
}
