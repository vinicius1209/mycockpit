// O índice que abre ao parar o mouse na régua de turnos (ADR-250, mock
// `docs/mocks/regua-de-turnos.html`, variante B).
//
// O traço sozinho obrigava a passar o mouse em cada um para saber o que tinha
// ali. O índice mostra a conversa inteira de relance: uma linha para o pedido,
// outra para a resposta, e o clique leva ao pedido no fio. É a versão de bolso
// da aba Conversa, com a mesma derivação e sem plano, custo nem hora; o rodapé
// leva para ela.

import { useLayoutEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { LinhaDeLista } from "@/components/ui/linha-de-lista"
import { fmtDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { marcoPedeAtencao, respostaDoMarco, type MarcoDaRegua } from "./marcosDaRegua"

function Direita({ marco }: { marco: MarcoDaRegua }) {
  const { pedido } = marco
  // O vivo no fio é movimento cinza (§2), não cor.
  if (pedido.estado === "rodando") return <span className="fio-cintila">rodando</span>
  if (pedido.duracaoMs != null && pedido.duracaoMs >= 1000) return <>{fmtDuration(pedido.duracaoMs)}</>
  return null
}

function LinhaDoIndice({
  marco,
  ativo,
  sobre,
  onIr,
}: {
  marco: MarcoDaRegua
  ativo: boolean
  sobre: boolean
  onIr: (marco: MarcoDaRegua) => void
}) {
  const { pedido } = marco
  const atencao = marcoPedeAtencao(marco)
  return (
    <li>
      <LinhaDeLista
        onClick={() => onIr(marco)}
        ativo={ativo}
        destacado={sobre}
        className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-x-2"
      >
        <span className="pt-px text-[11px] text-faint tabular-nums">{marco.ordem}</span>
        <span className={cn("truncate text-[13px]", pedido.retomada ? "text-muted-foreground" : "text-foreground")}>
          {pedido.retomada ? "Retomada automática" : pedido.texto}
        </span>
        <span className="flex items-center gap-1.5 pt-px text-[11px] whitespace-nowrap text-faint tabular-nums">
          {atencao && <span aria-hidden className="size-1.5 rounded-full bg-st-warning" />}
          <Direita marco={marco} />
        </span>
        <span
          className={cn(
            "col-span-2 col-start-2 truncate text-[12px]",
            atencao ? "text-st-warning" : "text-muted-foreground",
          )}
        >
          {respostaDoMarco(marco)}
        </span>
        {marco.avisos.length > 0 && (
          <span className="col-span-2 col-start-2 truncate text-[11px] text-faint">
            {marco.avisos[0]}
            {marco.avisos.length > 1 && ` · +${marco.avisos.length - 1}`}
          </span>
        )}
      </LinhaDeLista>
    </li>
  )
}

export function IndiceDaConversa({
  marcos,
  total,
  ativo,
  sobre,
  onIr,
  onHistorico,
}: {
  marcos: MarcoDaRegua[]
  /** Pedidos na conversa inteira; a régua só cobre a janela que o fio pinta. */
  total: number
  ativo: string | null
  sobre: string | null
  onIr: (marco: MarcoDaRegua) => void
  onHistorico: () => void
}) {
  const listaRef = useRef<HTMLOListElement>(null)

  // Abre com o pedido da tela à vista, no meio da lista. Mexe só no
  // `scrollTop` da própria lista: `scrollIntoView` rolaria o fio junto (ADR-122).
  useLayoutEffect(() => {
    const lista = listaRef.current
    const linha = lista?.querySelector<HTMLElement>("[data-ativo]")
    if (!lista || !linha) return
    lista.scrollTop = linha.offsetTop - lista.clientHeight / 2 + linha.offsetHeight / 2
  }, [])

  return (
    <div className="flex max-h-[min(70vh,520px)] w-[400px] flex-col">
      <div className="flex items-baseline gap-2 border-b border-border/40 px-3 pt-2.5 pb-2">
        <span className="etiqueta">Nesta conversa</span>
        <span className="ml-auto text-[11px] text-faint tabular-nums">
          {marcos.length === total
            ? `${total} ${total === 1 ? "pedido" : "pedidos"}`
            : `últimos ${marcos.length} de ${total} pedidos`}
        </span>
      </div>
      <ol ref={listaRef} className="relative min-h-0 flex-1 overflow-y-auto p-1">
        {marcos.map((marco) => (
          <LinhaDoIndice
            key={marco.key}
            marco={marco}
            ativo={ativo === marco.key}
            sobre={sobre === marco.key}
            onIr={onIr}
          />
        ))}
      </ol>
      <div className="border-t border-border/40 p-1">
        <Button variant="ghost" size="compacto" className="w-full justify-start text-muted-foreground" onClick={onHistorico}>
          Histórico completo na aba Conversa →
        </Button>
      </div>
    </div>
  )
}
