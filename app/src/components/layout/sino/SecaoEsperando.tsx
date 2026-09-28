// "Esperando você": o que está parado agora, derivado de estado vivo
// (ADR-271). Âmbar do começo ao fim (§2), porque a seção inteira é o que
// segura trabalho até você decidir.

import {
  CircleHelp,
  Lightbulb,
  ListChecks,
  LogIn,
  MessageCircleQuestion,
  ShieldQuestion,
  SquareKanban,
  Swords,
  X,
} from "lucide-react"
import { fmtAgo } from "@/lib/format"
import type { Espera, EsperandoVoce } from "@/lib/sino/esperando"
import { LinhaDoSino, RotuloDoSino } from "@/components/layout/sino/LinhaDoSino"

const ICONE = "size-3.5 shrink-0 text-st-warning"

function IconeDaEspera({ e }: { e: Espera }) {
  if (e.tipo === "ferramenta") return <LogIn className={ICONE} />
  if (e.tipo === "missao") return <CircleHelp className={ICONE} />
  if (e.tipo === "decisao") {
    const k = e.decisao.kind
    if (k === "fusion") return <Swords className={ICONE} />
    if (k === "card") return <SquareKanban className={ICONE} />
    return <Lightbulb className={ICONE} />
  }
  if (e.pedido === "pergunta") return <MessageCircleQuestion className={ICONE} />
  if (e.pedido === "plano") return <ListChecks className={ICONE} />
  return <ShieldQuestion className={ICONE} />
}

function dicaDe(e: Espera): string {
  if (e.tipo === "ferramenta") return "Abrir o motor em Configurações"
  if (e.tipo === "decisao")
    return e.decisao.kind === "proposal" ? "Abrir a proposta do lead na fila" : e.decisao.title
  if (e.tipo === "pedido" && !e.convId) return "O cartão deste pedido está no canto da tela"
  return "Abrir a conversa no pedido"
}

export function SecaoEsperando({
  esperando,
  now,
  onAbrir,
  onDispensarProposta,
}: {
  esperando: EsperandoVoce
  now: number
  onAbrir: (e: Espera) => void
  onDispensarProposta: (proposalId: string) => void
}) {
  if (esperando.itens.length === 0) return null
  return (
    <section aria-label="Esperando você">
      <RotuloDoSino>
        Esperando você
        <span className="grid h-4 min-w-4 place-items-center rounded-full bg-st-warning px-1 font-semibold text-st-warning-foreground tabular-nums">
          {esperando.total}
        </span>
      </RotuloDoSino>
      {esperando.itens.map((e) => (
        <LinhaDoSino
          key={e.chave}
          icone={<IconeDaEspera e={e} />}
          titulo={e.titulo}
          meta={e.meta}
          fim={e.desde != null ? fmtAgo(now - e.desde) : null}
          dica={dicaDe(e)}
          onAbrir={() => onAbrir(e)}
          acoes={
            e.tipo === "decisao" && e.decisao.kind === "proposal"
              ? [
                  {
                    icone: X,
                    rotulo: "Dispensar a proposta",
                    fazer: () => {
                      if (e.decisao.kind === "proposal") onDispensarProposta(e.decisao.proposalId)
                    },
                  },
                ]
              : undefined
          }
        />
      ))}
    </section>
  )
}
