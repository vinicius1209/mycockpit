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
//
// Contraste (mock `docs/mocks/aba-conversa-contraste.html`, 24/09/2026): o
// mais novo vira cartão sob "Agora" (ou "Último pedido"), o resto fica sob
// "Antes"; pedido em 13px pleno, duração e custo com peso, fatos em sans, e o
// plano do cartão aparece uma vez só.

import { useState } from "react"
import { AlertCircle, Check, Copy, ListChecks, LocateFixed } from "lucide-react"
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

/** Os fatos em duas vozes (mock `aba-conversa-contraste.html`): duração e
 *  custo com peso, porque são o que decide; contagens em cinza. Numa linha só
 *  em mono, com o mesmo peso, tudo virava um número só. Puro, para teste. */
export function fatosEmDuasVozes(p: PedidoDoFio, { semDuracao = false } = {}): { fortes: string[]; leves: string[] } {
  const [duracao, custo, ...resto] = [
    p.duracaoMs != null && p.duracaoMs >= 1000 ? fmtDuration(p.duracaoMs) : null,
    p.custoUsd != null ? fmtCost(p.custoUsd, p.custoFonte ?? undefined) : p.modelo,
    plural(p.acoes, "ação", "ações"),
    plural(p.arquivos, "arquivo", "arquivos"),
    plural(p.commits, "commit", "commits"),
    plural(p.imagens, "imagem", "imagens"),
    plural(p.processos, "processo", "processos"),
  ]
  return {
    fortes: [semDuracao ? null : duracao, custo].filter((f): f is string => !!f),
    leves: resto.filter((f): f is string => !!f),
  }
}

function Fatos({ pedido, semDuracao = false }: { pedido: PedidoDoFio; semDuracao?: boolean }) {
  const { fortes, leves } = fatosEmDuasVozes(pedido, { semDuracao })
  const todos = [
    ...fortes.map((f) => ({ f, forte: true })),
    ...leves.map((f) => ({ f, forte: false })),
  ]
  return (
    <>
      {todos.map(({ f, forte }, i) => (
        <span key={f} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-faint" aria-hidden>·</span>}
          <span className={forte ? "font-medium text-foreground/80" : undefined}>{f}</span>
        </span>
      ))}
    </>
  )
}

function Estado({ estado, destaque = false }: { estado: EstadoDoPedido; destaque?: boolean }) {
  if (estado === "concluido") {
    return (
      <span className="inline-flex items-center text-muted-foreground/70">
        <Check className="size-3" aria-hidden />
        <span className="sr-only">concluído</span>
      </span>
    )
  }
  if (estado === "rodando") {
    // A aba é chrome: aqui o vivo é COR (§2.2), e a do rodapé é a mesma.
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-st-running", destaque && "font-medium")}>
        <span className="size-1.5 animate-pulse rounded-full bg-st-running" aria-hidden />
        {destaque ? "Rodando" : PALAVRA.rodando}
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

function PlanoDoPedido({ pedido }: { pedido: PedidoDoFio }) {
  const [ver, setVer] = useState(false)
  const plano = pedido.plano
  if (!plano || plano.tasks.length === 0) return null
  const feitas = plano.tasks.filter((t) => t.status === "completed").length
  return (
    <div className="mt-1.5">
      <Button type="button" variant="ghost" size="chip" onClick={() => setVer((v) => !v)} className="bg-sel text-muted-foreground">
        <ListChecks />
        Plano {feitas} de {plano.tasks.length}
        {!ver && " · ver etapas"}
      </Button>
      {ver && (
        <div className="mt-1.5">
          <TaskChecklist tasks={plano.tasks} live={pedido.estado === "rodando"} />
        </div>
      )}
    </div>
  )
}

function AcoesDoPedido({ pedido, onReveal, className }: { pedido: PedidoDoFio; onReveal: (id: string) => void; className?: string }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    if (await copyText(pedido.texto)) {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    }
  }
  return (
    <div className={cn("flex opacity-0 transition-opacity group-hover/pedido:opacity-100 focus-within:opacity-100", className)}>
      <Button type="button" variant="ghost" size="icone-chip" onClick={() => void copiar()} title={copiado ? "Copiado" : "Copiar o pedido"} aria-label="Copiar o pedido">
        {copiado ? <Check /> : <Copy />}
      </Button>
      <Button type="button" variant="ghost" size="icone-chip" onClick={() => onReveal(pedido.id)} title="Ver no fio" aria-label="Ver no fio">
        <LocateFixed />
      </Button>
    </div>
  )
}

const Rotulo = ({ children }: { children: string }) => (
  <div className="px-5 pt-3.5 pb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">{children}</div>
)

/** O pedido mais novo, em cartão: é o "agora" quando roda, e o último pedido
 *  quando nada roda. Estado, tempo, fatos, a última resposta (com rótulo e
 *  filete, para não se confundir com o pedido) e o plano aberto, uma vez só. */
function CabecaDoHistorico({ pedido, now, onReveal }: { pedido: PedidoDoFio; now: number; onReveal: (id: string) => void }) {
  const plano = pedido.plano
  return (
    <div className="group/pedido mx-3 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-[12px]">
        <Estado estado={pedido.estado} destaque />
        {pedido.duracaoMs != null && pedido.duracaoMs >= 1000 && (
          <span className="text-foreground tabular-nums">{fmtDuration(pedido.duracaoMs)}</span>
        )}
        <span className="ml-auto text-faint tabular-nums">
          {fmtTime(pedido.ts)}
          {pedido.ts != null && ` · ${fmtAgo(now - pedido.ts)}`}
        </span>
        <AcoesDoPedido pedido={pedido} onReveal={onReveal} className="-my-1" />
      </div>
      <p data-selectable className="mt-2 line-clamp-4 select-text text-[13px] leading-relaxed break-words text-foreground">
        {pedido.texto}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground tabular-nums">
        <Fatos pedido={pedido} semDuracao />
      </div>
      {pedido.resposta && (
        <div className="mt-2.5 border-l border-border/40 pl-2.5">
          <div className="text-[11px] text-faint">Última resposta</div>
          <p className="line-clamp-3 text-[12px] leading-relaxed text-muted-foreground">{pedido.resposta}</p>
        </div>
      )}
      {plano && plano.tasks.length > 0 && (
        <div className="mt-3">
          <TaskChecklist tasks={plano.tasks} live={pedido.estado === "rodando"} />
        </div>
      )}
    </div>
  )
}

function LinhaDoPedido({ pedido, now, onReveal }: { pedido: PedidoDoFio; now: number; onReveal: (itemId: string) => void }) {
  return (
    // Três trilhos: hora, conteúdo e as ações, que só acendem no hover/foco.
    <li className="group/pedido grid grid-cols-[2.75rem_minmax(0,1fr)_1.5rem] gap-x-2.5 px-5 py-2.5">
      <div className="pt-px text-[12px] leading-snug text-foreground/70 tabular-nums">
        <div>{fmtTime(pedido.ts)}</div>
        {pedido.ts != null && <div className="text-[11px] text-faint">{fmtAgo(now - pedido.ts)}</div>}
      </div>
      <div className="min-w-0">
        <p data-selectable className="line-clamp-2 select-text text-[13px] leading-snug break-words text-foreground">
          {pedido.texto}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground tabular-nums">
          <Estado estado={pedido.estado} />
          <Fatos pedido={pedido} />
        </div>
        <PlanoDoPedido pedido={pedido} />
      </div>
      <AcoesDoPedido pedido={pedido} onReveal={onReveal} className="flex-col items-center" />
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
  const [cabeca, ...resto] = pedidos
  const visiveis = todos ? resto : resto.slice(0, VISIVEIS - 1)
  const escondidos = resto.length - visiveis.length
  if (!cabeca) return null
  return (
    <div>
      <Rotulo>{cabeca.estado === "rodando" ? "Agora" : "Último pedido"}</Rotulo>
      <CabecaDoHistorico pedido={cabeca} now={now} onReveal={onReveal} />
      {visiveis.length > 0 && <Rotulo>Antes</Rotulo>}
      <ol className="divide-y divide-border/40">
        {visiveis.map((pedido) => (
          <LinhaDoPedido key={pedido.id} pedido={pedido} now={now} onReveal={onReveal} />
        ))}
      </ol>
      {escondidos > 0 && (
        <Button type="button" variant="ghost" size="chip" className="mx-3 mt-1" onClick={() => setTodos(true)}>
          … mais {escondidos} {escondidos === 1 ? "pedido" : "pedidos"} · mostrar todos
        </Button>
      )}
    </div>
  )
}
