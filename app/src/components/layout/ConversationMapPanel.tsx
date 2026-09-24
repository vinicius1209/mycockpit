// A aba Conversa: o HISTÓRICO DE PEDIDOS desta conversa (mock
// `docs/mocks/aba-conversa.html` rev. 2, aprovado em 23/09/2026).
//
// Antes a aba girava em torno de um resumo automático que quase nunca saía
// ("leitura indisponível"), e sobravam o primeiro pedido fixo para sempre, um
// "Turno concluído" sem conteúdo e as etapas do último plano soltas. Agora é
// só fato do fio (lib/conversationMap/historico.ts). O resumo saiu de vez no
// ADR-233: em 20 dias, 1.165 chamadas ao modelo local e nenhum salvo.

import { useEffect, useMemo, useState } from "react"
import { HistoricoDePedidos } from "@/components/layout/HistoricoDePedidos"
import { Section } from "@/components/layout/contextPanelChrome"
import { ScrollArea } from "@/components/ui/scroll-area"
import { deterministicConversationFacts } from "@/lib/conversationMap"
import { historicoDePedidos } from "@/lib/conversationMap/historico"
import { fmtCost, fmtDuration } from "@/lib/format"
import { currentOriginAnyKind, useInteractions } from "@/store/interactions"
import type { ChatItem } from "@/store/chat"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

/** Relógio da aba: 1 s com pedido rodando (a duração anda), 30 s no resto
 *  (o "há X min"). */
function useAgora(rodando: boolean): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), rodando ? 1_000 : 30_000)
    return () => clearInterval(id)
  }, [rodando])
  return agora
}

/** Anda a duração do pedido rodando até `agora`, sem refazer a derivação. */
export function comRelogio(
  h: ReturnType<typeof historicoDePedidos>,
  agora: number,
): ReturnType<typeof historicoDePedidos> {
  if (!h.rodando) return h
  let extra = 0
  const pedidos = h.pedidos.map((p) => {
    if (p.estado !== "rodando" || p.ts == null) return p
    const duracaoMs = Math.max(0, agora - p.ts)
    extra += duracaoMs - (p.duracaoMs ?? 0)
    return { ...p, duracaoMs }
  })
  return { ...h, pedidos, duracaoTotalMs: h.duracaoTotalMs + extra }
}

/** "12 pedidos · US$ 19,36 · 46min", com "1 rodando" quando há. Puro. */
export function cabecalhoDoHistorico(h: ReturnType<typeof historicoDePedidos>): string {
  const n = h.pedidos.length
  return [
    `${n} ${n === 1 ? "pedido" : "pedidos"}`,
    h.rodando > 0 ? `${h.rodando} rodando` : null,
    h.custoTotalUsd != null ? fmtCost(h.custoTotalUsd, h.custoTotalEstimado ? "estimated" : undefined) : null,
    h.duracaoTotalMs >= 1000 ? fmtDuration(h.duracaoTotalMs) : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** O cabeçalho como MÉTRICAS (mock `aba-conversa-contraste.html`, 24/09/2026):
 *  o número com peso, o rótulo em cinza. Numa linha só em mono, os quatro
 *  números se confundiam. "Rodando" leva a cor do vivo: a aba é chrome (§2.2).
 *  A frase inteira fica no `aria-label` para quem não vê a grade. */
function MetricasDoHistorico({ historico }: { historico: ReturnType<typeof historicoDePedidos> }) {
  const n = historico.pedidos.length
  const metricas: { valor: string; rotulo: string; vivo?: boolean }[] = [
    { valor: String(n), rotulo: n === 1 ? "pedido" : "pedidos" },
  ]
  if (historico.rodando > 0) metricas.push({ valor: String(historico.rodando), rotulo: "rodando", vivo: true })
  if (historico.custoTotalUsd != null)
    metricas.push({
      valor: fmtCost(historico.custoTotalUsd, historico.custoTotalEstimado ? "estimated" : undefined),
      rotulo: "gasto",
    })
  if (historico.duracaoTotalMs >= 1000) metricas.push({ valor: fmtDuration(historico.duracaoTotalMs), rotulo: "de trabalho" })
  return (
    <div
      role="group"
      aria-label={cabecalhoDoHistorico(historico)}
      className="flex items-start justify-between gap-3 border-b border-border/40 px-5 pt-3.5 pb-3"
    >
      {metricas.map((m) => (
        <div key={m.rotulo} className="min-w-0">
          <div
            className={cn(
              "truncate text-[14px] font-medium tabular-nums",
              m.vivo ? "text-st-running" : "text-foreground",
            )}
          >
            {m.valor}
          </div>
          <div className="text-[11px] text-muted-foreground">{m.rotulo}</div>
        </div>
      ))}
    </div>
  )
}

export function ConversationMapPanel({
  conversationId,
  title,
  items,
  running,
  finalizing,
}: {
  conversationId: string | null
  title: string | null
  items: ChatItem[] | undefined
  running: boolean
  finalizing: boolean
}) {
  const safeItems = items ?? []
  const queue = useInteractions((state) => state.queue)
  const agora = useAgora(running || finalizing)

  const pendingInteractions = useMemo(
    () =>
      conversationId
        ? queue.filter((request) => currentOriginAnyKind(request)?.convId === conversationId)
        : [],
    [conversationId, queue],
  )
  const facts = useMemo(
    () =>
      deterministicConversationFacts({
        conversationId: conversationId ?? "",
        title,
        items: safeItems,
        runtime: { running, finalizing },
        pendingInteractions,
      }),
    [conversationId, finalizing, items, pendingInteractions, running, title],
  )
  // O histórico só se recalcula quando o FIO muda; o tique do relógio só
  // anda a duração do pedido que está rodando (antes o tique de 1 s refazia
  // tudo: ~8 ms por vez na maior conversa real).
  const derivado = useMemo(
    () => historicoDePedidos(safeItems, { running, finalizing }),
    [items, running, finalizing],
  )
  const historico = useMemo(() => comRelogio(derivado, agora), [derivado, agora])

  function reveal(itemId: string) {
    if (!conversationId) return
    useApp.getState().revealTranscriptItem(conversationId, itemId)
  }

  if (!conversationId || historico.pedidos.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-8 text-center">
        <p className="text-[12px] text-foreground/85">A conversa ainda não começou.</p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Cada pedido seu aparece aqui com o desfecho, o tempo, o custo e o que mudou. É o histórico desta conversa.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MetricasDoHistorico historico={historico} />
      {/* `min-h-0` na fronteira flexível (ADR-162): sem ele a área cresce até
          o conteúdo, nunca rola, e o fim da lista é cortado sem aviso. */}
      <ScrollArea className="min-h-0 flex-1">
        {facts.pendingInteractions.length > 0 && (
          <Section title="Decisões pendentes">
            <p className="px-1 text-[12px] leading-relaxed text-foreground/85">
              {facts.pendingInteractions.length === 1
                ? "Uma decisão espera por você nesta conversa."
                : `${facts.pendingInteractions.length} decisões esperam por você nesta conversa.`}
            </p>
          </Section>
        )}
        {facts.background.length > 0 && (
          <Section title="Trabalho em segundo plano">
            <ul className="flex flex-col gap-1">
              {facts.background.map((work) => (
                <li key={work.id} className="px-1 py-1.5 text-[12px]">
                  <span className="block truncate text-foreground/85">
                    {work.name ?? work.kind ?? "Tarefa em segundo plano"}
                  </span>
                  {work.summary && (
                    <span className="mt-0.5 block line-clamp-2 text-[11px] text-muted-foreground">
                      {work.summary}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}
        <HistoricoDePedidos pedidos={historico.pedidos} now={agora} onReveal={reveal} />
        <div className="h-5" aria-hidden="true" />
      </ScrollArea>
    </div>
  )
}
