// A seção "Resposta" e a linha de estado da paleta ⌘K (F10, ADR-289). No
// idioma da paleta: manchete sem cartão e linhas iguais aos outros itens, com
// a fonte do dado no cabeçalho. A regra mora em `lib/paletaResponde.ts`; aqui
// só se juntam os dados que a Frota, a faixa e a cota já têm.

import { useEffect, useMemo, useState } from "react"
import { Rocket } from "lucide-react"
import { AgentLogo } from "@/components/common/AgentLogo"
import { abrirConversa } from "@/components/layout/sino/navegar"
import { CommandGroup, CommandItem } from "@/components/ui/command"
import { controle } from "@/components/ui/controle"
import { loadLedger } from "@/lib/db"
import { buildFleetLines, parseFleetKey, parseUnseenKey, resumoDoPedido } from "@/lib/fleet/linhas"
import { METER_FILL } from "@/lib/meter"
import type { LedgerRow } from "@/lib/panel"
import {
  intencaoDaPergunta,
  linhaDeEstado,
  respostaDaCota,
  respostaDaFrota,
  respostaDoGasto,
  type EstadoDaFrota,
  type Pedaco,
  type Resposta,
} from "@/lib/paletaResponde"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { ownerByRunId, useAwaiting, useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import { useUsage } from "@/store/usage"

const SEMANA_MS = 7 * 24 * 60 * 60 * 1000
const ITEM = "mx-2 rounded-lg py-2.5"

const TOM: Record<NonNullable<Pedaco["tom"]>, string> = {
  forte: "text-foreground",
  am: "text-st-warning",
  erro: "text-st-error",
}

function useEstadoDaFrota(): EstadoDaFrota {
  const vivas = useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.running)
      .map(([id, c]) => `${id}:${c.projectId}:${c.agent}:${c.startedAt ?? ""}`)
      .sort()
      .join("|"),
  )
  const terminadas = useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.finishedUnseen)
      .map(([id, c]) => `${id}:${c.projectId}:${c.finishedUnseen}`)
      .sort()
      .join("|"),
  )
  const awaiting = useAwaiting()
  const fila = useInteractions((s) => s.queue)
  const metas = useChat((s) => s.conversationsByProject)
  const projetos = useApp((s) => s.projects)
  return useMemo(() => {
    const { agora, maisCedo } = buildFleetLines({
      vivas: parseFleetKey(vivas),
      terminadas: parseUnseenKey(terminadas),
      aguardando: awaiting.convIds,
      metas,
      projetos,
    })
    const chat = useChat.getState()
    const missoes = useMission.getState()
    const pedidos = new Map<string, string>()
    for (const req of fila) {
      const dono = ownerByRunId(req, chat, missoes)?.convId
      const resumo = dono && !pedidos.has(dono) ? resumoDoPedido(req) : null
      if (dono && resumo) pedidos.set(dono, resumo)
    }
    return { agora, maisCedo, pedidos }
  }, [vivas, terminadas, awaiting, fila, metas, projetos])
}

/** O livro de custos, lido ao abrir a paleta (o mesmo da faixa). */
function useLivro(aberto: boolean): LedgerRow[] | null {
  const [rows, setRows] = useState<LedgerRow[] | null>(null)
  useEffect(() => {
    if (!aberto) return
    let vivo = true
    loadLedger(Date.now() - SEMANA_MS)
      .then((r) => vivo && setRows(r))
      .catch((e) => console.warn("[paleta] não li o livro de custos:", e))
    return () => {
      vivo = false
    }
  }, [aberto])
  return rows
}

function Pedacos({ pedacos, base }: { pedacos: Pedaco[]; base: string }) {
  return (
    <>
      {pedacos.map((p, i) => (
        <span key={i} className={cn(p.tom ? TOM[p.tom] : base, p.tom && p.tom !== "erro" && "font-semibold")}>
          {p.texto}
        </span>
      ))}
    </>
  )
}

export function RespostaDaPaleta({
  query,
  aberto,
  executar,
}: {
  query: string
  aberto: boolean
  /** Fecha a paleta e roda o gesto (o `run` do CommandMenu). */
  executar: (fn: () => void) => void
}) {
  const estado = useEstadoDaFrota()
  const livro = useLivro(aberto)
  const byAgent = useUsage((s) => s.byAgent)
  const failures = useUsage((s) => s.failures)
  const projetoAberto = useApp((s) => s.activeProjectId)
  const intencao = useMemo(() => intencaoDaPergunta(query), [query])

  const resposta: Resposta | null = useMemo(() => {
    if (!intencao) return null
    const now = Date.now()
    if (intencao.tipo === "gasto") return livro ? respostaDoGasto(intencao, livro, now, projetoAberto) : null
    if (intencao.tipo === "cota") return respostaDaCota(intencao, byAgent, failures, now)
    return respostaDaFrota(intencao, estado, now, projetoAberto)
  }, [intencao, livro, byAgent, failures, estado, projetoAberto])

  if (!query.trim()) {
    const hoje = livro
      ? livro
          .filter((r) => r.createdAt >= new Date().setHours(0, 0, 0, 0))
          .reduce((s, r) => s + (r.costUsd ?? 0), 0)
      : null
    const linha = linhaDeEstado(estado, hoje)
    if (!linha) return null
    // Fora da navegação por setas: com o campo vazio, o Enter continua sendo da
    // primeira ação (Nova tarefa), como antes. A linha é clique.
    return (
      <button
        type="button"
        onClick={() => executar(() => useApp.getState().setFleetOpen(true))}
        className={cn(
          controle("compacto"),
          "mx-2 mb-1 flex w-[calc(100%-1rem)] items-center justify-start font-mono text-muted-foreground tabular-nums transition-colors hover:bg-accent",
        )}
      >
        <Rocket aria-hidden className="size-3.5 shrink-0" />
        {linha.map((p, i) => (
          <span key={i} className={cn(p.tom === "am" && "text-st-warning")}>
            {i > 0 && <span className="mr-2 text-faint">·</span>}
            {p.texto}
          </span>
        ))}
        <span className="ml-auto font-sans text-[11px] text-faint">Abrir a Frota</span>
      </button>
    )
  }

  if (!resposta) return null
  const destino = (l?: { conversa?: { id: string; projectId: string } }) => () =>
    executar(() => {
      if (l?.conversa) void abrirConversa(l.conversa.projectId, l.conversa.id)
      else if (intencao?.tipo === "gasto" || intencao?.tipo === "cota") useApp.getState().setSettingsOpen(true, "ledger")
      else useApp.getState().setFleetOpen(true)
    })
  // Os itens levam o texto digitado no `value`, então sempre passam no filtro
  // do cmdk (e entram na seleção automática, que o `forceMount` perde). Sem
  // linhas, a própria manchete é o item.
  return (
    <CommandGroup
      forceMount
      heading={
        <span className="flex items-baseline">
          Resposta
          <span className="ml-auto pr-1 font-normal tracking-normal text-faint normal-case">{resposta.fonte}</span>
        </span>
      }
    >
      {resposta.linhas.length === 0 ? (
        <CommandItem value={`${query} resposta`} className={cn(ITEM, "text-[14px]")} onSelect={destino()}>
          {/* Um span só: o item é flex com gap, e os pedaços ganhariam espaço duplo. */}
          <span>
            <Pedacos pedacos={resposta.manchete} base="text-muted-foreground" />
          </span>
        </CommandItem>
      ) : (
        <div className="px-3 pt-0.5 pb-2 text-[14px] leading-snug">
          <Pedacos pedacos={resposta.manchete} base="text-muted-foreground" />
        </div>
      )}
      {resposta.linhas.map((l) => (
        <CommandItem
          key={l.chave}
          value={`${query} resposta ${l.chave} ${l.titulo}`}
          className={ITEM}
          onSelect={destino(l)}
        >
          {l.agent && (
            <span className="grid size-4 shrink-0 place-items-center">
              <AgentLogo agent={l.agent} />
            </span>
          )}
          <span className="min-w-0 truncate">{l.titulo}</span>
          {l.sub && <span className="shrink-0 text-[12px] text-faint">{l.sub}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-[12px] text-faint tabular-nums">
            {l.barra && (
              <span className="h-1 w-11 overflow-hidden rounded-full bg-foreground/10">
                <span className={cn("block h-full rounded-full", METER_FILL[l.barra.tom])} style={{ width: `${l.barra.pct}%` }} />
              </span>
            )}
            {l.meta.map((p, i) => (
              <span
                key={i}
                // Com barra, colunas fixas: as barras de cada motor se alinham.
                className={cn(p.tom && TOM[p.tom], l.barra && (i === 0 ? "w-9 text-right" : "w-32"))}
              >
                {p.texto}
              </span>
            ))}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
