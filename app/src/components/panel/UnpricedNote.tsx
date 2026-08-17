// ADR-047 — a ressalva do consumo SEM preço, em um lugar só.
//
// Todo total em US$ que sai do ledger é soma PARCIAL enquanto existir turno
// gravado sem preço (modelo fora da tabela). Antes esses turnos não existiam
// no banco e o total mentia por omissão; agora eles existem, e a ressalva é o
// que impede a segunda mentira: US$ 0,00 com cara de medido.
//
// Mesma regra do denominador à vista do ADR-040 — número derivado sem o que
// ficou de fora é o começo de uma métrica que ninguém confere.

import { fmtTokens } from "@/lib/format"
import type { UnpricedSpend } from "@/lib/panel"
import { cn } from "@/lib/utils"

export function UnpricedNote({
  spend,
  className,
}: {
  spend: UnpricedSpend
  className?: string
}) {
  if (spend.turns <= 0) return null
  return (
    <p className={cn("text-[11px] leading-relaxed text-faint", className)}>
      Fora do total: {spend.turns} turno{spend.turns === 1 ? "" : "s"} com{" "}
      {fmtTokens(spend.tokens)} tokens e preço desconhecido. O consumo está
      medido; o valor em US$ o app não sabe, e não inventa.
    </p>
  )
}
