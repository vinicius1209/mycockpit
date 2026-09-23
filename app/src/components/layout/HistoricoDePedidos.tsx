// O histórico de pedidos da aba Conversa (mock `docs/mocks/aba-conversa.html`,
// rev. 2, aprovado em 23/09/2026). A derivação é pura e mora em
// `lib/conversationMap/historico.ts`; aqui só a tipografia.
//
// Regras do mock que moram AQUI:
//  - a cabeça da linha do tempo é o "agora": o pedido mais novo nasce aberto,
//    com o plano dele dentro; não há cartão repetido em cima;
//  - sucesso é só o ✓ e a palavra fica para a exceção (mesma régua do fio,
//    `TurnTelemetry`): onze "concluído" enterravam o único "interrompido";
//  - hora absoluta E relativa em toda linha, porque é um log lido do fim;
//  - o texto do pedido é selecionável e nunca fica dentro de um botão.

import { useState } from "react"
import { AlertCircle, Check, Copy, LocateFixed } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import { copyText } from "@/lib/clipboard"
import type { EstadoDoPedido, PedidoDoFio } from "@/lib/conversationMap/historico"
import { fmtAgo, fmtCost, fmtDuration, fmtTime } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Quantos pedidos aparecem antes do "mostrar todos". */
const VISIVEIS = 8

const PALAVRA: Record<Exclude<EstadoDoPedido, "concluido">, string> = {
  rodando: "rodando",
  erro: "erro",
  interrompido: "interrompido",
  limite: "limite de uso",
  "sem-desfecho": "sem desfecho registrado",
}

function plural(n: number, um: string, varios: string): string | null {
  if (n <= 0) return null
  return `${n} ${n === 1 ? um : varios}`
}

/** A linha de fatos, na ordem do mock. Puro, para teste. */
export function fatosDoPedido(p: PedidoDoFio): string[] {
  return [
    p.duracaoMs != null && p.duracaoMs >= 1000 ? fmtDuration(p.duracaoMs) : null,
    // Motor sem custo: o modelo ocupa o lugar, como no fio.
    p.custoUsd != null ? fmtCost(p.custoUsd, p.custoFonte ?? undefined) : p.modelo,
    plural(p.acoes, "ação", "ações"),
    plural(p.arquivos, "arquivo", "arquivos"),
    plural(p.commits, "commit", "commits"),
    plural(p.imagens, "imagem", "imagens"),
    plural(p.processos, "processo", "processos"),
  ].filter((f): f is string => !!f)
}

function Estado({ estado }: { estado: EstadoDoPedido }) {
  if (estado === "concluido") {
    return (
      <span className="inline-flex items-center text-muted-foreground/70">
        <Check className="size-3" aria-hidden />
        <span className="sr-only">concluído</span>
      </span>
    )
  }
  if (estado === "rodando") {
    return (
      <span className="inline-flex items-center gap-1 text-foreground/80">
        <span className="size-1.5 animate-pulse rounded-full bg-st-running" aria-hidden />
        {PALAVRA.rodando}
      </span>
    )
  }
  const tom =
    estado === "erro"
      ? "text-st-error"
      : estado === "sem-desfecho"
        ? "text-muted-foreground"
        : "text-st-warning"
  return (
    <span className={cn("inline-flex items-center gap-1", tom)}>
      {estado === "erro" && <AlertCircle className="size-3" aria-hidden />}
      {PALAVRA[estado]}
    </span>
  )
}

function PlanoDoPedido({ pedido, aberto }: { pedido: PedidoDoFio; aberto: boolean }) {
  const [ver, setVer] = useState(aberto)
  const plano = pedido.plano
  if (!plano || plano.tasks.length === 0) return null
  const feitas = plano.tasks.filter((t) => t.status === "completed").length
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setVer((v) => !v)}
        className="text-[11px] text-muted-foreground hover:text-foreground"
      >
        Plano {feitas}/{plano.tasks.length}
        {!ver && " · ver etapas"}
      </button>
      {ver && (
        <div className="mt-1">
          <TaskChecklist tasks={plano.tasks} live={pedido.estado === "rodando"} />
        </div>
      )}
    </div>
  )
}

function LinhaDoPedido({
  pedido,
  cabeca,
  now,
  onReveal,
}: {
  pedido: PedidoDoFio
  cabeca: boolean
  now: number
  onReveal: (itemId: string) => void
}) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    if (await copyText(pedido.texto)) {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    }
  }
  return (
    // Três trilhos: hora, conteúdo e as ações. As ações moram numa coluna
    // própria à direita e só acendem no hover/foco: antes eram uma linha
    // invisível que ainda ocupava altura e abria um vão entre os pedidos.
    <li className="group/pedido grid grid-cols-[3.25rem_minmax(0,1fr)_1.5rem] gap-x-2 py-2">
      <div className="pt-px text-[11px] leading-snug text-muted-foreground tabular-nums">
        <div>{fmtTime(pedido.ts)}</div>
        {pedido.ts != null && <div className="text-muted-foreground/70">{fmtAgo(now - pedido.ts)}</div>}
      </div>
      <div className="min-w-0">
        <p
          data-selectable
          className={cn(
            "select-text text-[12px] leading-relaxed break-words text-foreground/85",
            cabeca ? "line-clamp-4" : "line-clamp-2",
          )}
        >
          {pedido.texto}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
          <Estado estado={pedido.estado} />
          {fatosDoPedido(pedido).map((fato) => (
            <span key={fato}>{fato}</span>
          ))}
        </div>
        {cabeca && pedido.resposta && (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {pedido.resposta}
          </p>
        )}
        <PlanoDoPedido pedido={pedido} aberto={cabeca} />
      </div>
      <div className="flex flex-col items-center opacity-0 transition-opacity group-hover/pedido:opacity-100 focus-within:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icone-chip"
          onClick={() => void copiar()}
          title={copiado ? "Copiado" : "Copiar o pedido"}
          aria-label="Copiar o pedido"
        >
          {copiado ? <Check /> : <Copy />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icone-chip"
          onClick={() => onReveal(pedido.id)}
          title="Ver no fio"
          aria-label="Ver no fio"
        >
          <LocateFixed />
        </Button>
      </div>
    </li>
  )
}

export function HistoricoDePedidos({
  pedidos,
  now,
  onReveal,
}: {
  pedidos: PedidoDoFio[]
  now: number
  onReveal: (itemId: string) => void
}) {
  const [todos, setTodos] = useState(false)
  const visiveis = todos ? pedidos : pedidos.slice(0, VISIVEIS)
  const escondidos = pedidos.length - visiveis.length
  return (
    <div className="px-5">
      <ol className="divide-y divide-border/40">
        {visiveis.map((pedido, i) => (
          <LinhaDoPedido key={pedido.id} pedido={pedido} cabeca={i === 0} now={now} onReveal={onReveal} />
        ))}
      </ol>
      {escondidos > 0 && (
        <Button type="button" variant="ghost" size="chip" className="mt-1" onClick={() => setTodos(true)}>
          … mais {escondidos} {escondidos === 1 ? "pedido" : "pedidos"} · mostrar todos
        </Button>
      )}
    </div>
  )
}
