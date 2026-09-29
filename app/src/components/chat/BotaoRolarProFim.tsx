import { ArrowDown } from "lucide-react"
import { controle, iconeDeControle } from "@/components/ui/controle"
import { cn } from "@/lib/utils"

/** Aparece quando você subiu para ler; o clique volta a seguir o fim. Flutua
 *  sobre a borda de cima do composer, centrado no fio. */
export function BotaoRolarProFim({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        controle("compacto"),
        "absolute -top-2 left-1/2 z-20 -translate-x-1/2 -translate-y-full rounded-full border bg-card/95 text-foreground shadow-[var(--shadow-pop)] backdrop-blur transition-colors hover:bg-accent",
      )}
    >
      <ArrowDown className={iconeDeControle("compacto")} /> Rolar pro fim
    </button>
  )
}
