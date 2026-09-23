// A aba Conversa: o HISTÓRICO DE PEDIDOS desta conversa (mock
// `docs/mocks/aba-conversa.html` rev. 2, aprovado em 23/09/2026).
//
// Antes a aba girava em torno de um resumo automático que quase nunca saía
// ("leitura indisponível"), e sobravam o primeiro pedido fixo para sempre, um
// "Turno concluído" sem conteúdo e as etapas do último plano soltas. Agora o
// esqueleto é fato do fio (lib/conversationMap/historico.ts) e o resumo é um
// enfeite em cima, que diz a verdade quando falha. "Ajustar leitura" saiu:
// anotação é a gaveta de Notas.

import { useEffect, useMemo, useState } from "react"
import {
  ConversationMapSourceDialog,
  type ConversationMapSource,
} from "@/components/layout/ConversationMapSourceDialog"
import { HistoricoDePedidos } from "@/components/layout/HistoricoDePedidos"
import { ResumoDaConversa } from "@/components/layout/ResumoDaConversa"
import { Section } from "@/components/layout/contextPanelChrome"
import { ScrollArea } from "@/components/ui/scroll-area"
import { composeConversationMapView, deterministicConversationFacts } from "@/lib/conversationMap"
import { historicoDePedidos } from "@/lib/conversationMap/historico"
import { fmtCost, fmtDuration } from "@/lib/format"
import { currentOriginAnyKind, useInteractions } from "@/store/interactions"
import type { ChatItem } from "@/store/chat"
import { useConversationMaps } from "@/store/conversationMaps"
import { useApp } from "@/store/app"

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

export function ConversationMapPanel({
  conversationId,
  projectId,
  title,
  items,
  running,
  finalizing,
}: {
  conversationId: string | null
  projectId: string
  title: string | null
  items: ChatItem[] | undefined
  running: boolean
  finalizing: boolean
}) {
  const safeItems = items ?? []
  const entry = useConversationMaps((state) =>
    conversationId ? state.byConversation[conversationId] : undefined,
  )
  const hydrate = useConversationMaps((state) => state.hydrate)
  const refreshNow = useConversationMaps((state) => state.refreshNow)
  const queue = useInteractions((state) => state.queue)
  const utility = useApp((state) => state.settings.utilityInference)
  const [source, setSource] = useState<ConversationMapSource | null>(null)
  const [tentando, setTentando] = useState(false)
  const agora = useAgora(running || finalizing)

  useEffect(() => {
    if (!conversationId) return
    void hydrate(conversationId)
  }, [conversationId, hydrate])

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
  const pins = entry?.pins ?? { schemaVersion: 1 as const, revision: 0, constraints: [] }
  const view = composeConversationMapView({
    facts,
    semantic: entry?.stored?.payload ?? null,
    pins,
    semanticStatus: entry?.semanticStatus ?? "absent",
    generatedAt: entry?.stored?.generatedAt ?? null,
    staleSettledTurns: entry?.staleSettledTurns ?? 0,
  })
  const desligado = !!conversationId && !!utility.conversationMapsOff?.includes(conversationId)

  function setDesligado(off: boolean) {
    if (!conversationId) return
    const atual = utility.conversationMapsOff ?? []
    useApp.getState().setSettings({
      utilityInference: {
        ...utility,
        conversationMapsOff: off
          ? [...new Set([...atual, conversationId])]
          : atual.filter((id) => id !== conversationId),
      },
    })
  }

  async function tentarDeNovo() {
    if (!conversationId) return
    setTentando(true)
    try {
      await refreshNow({ conversationId, projectId, items: safeItems, running, finalizing, force: true })
    } finally {
      setTentando(false)
    }
  }

  function reveal(itemId: string) {
    if (!conversationId) return
    useApp.getState().revealTranscriptItem(conversationId, itemId)
    setSource(null)
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
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-11 items-center px-5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground tabular-nums">
            {cabecalhoDoHistorico(historico)}
          </span>
        </div>
        {/* `min-h-0` na fronteira flexível (ADR-162): sem ele a área cresce até
            o conteúdo, nunca rola, e o fim da lista é cortado sem aviso. */}
        <ScrollArea className="min-h-0 flex-1">
          {utility.automaticConversationMaps && (
            <ResumoDaConversa
              view={view}
              status={entry?.semanticStatus ?? "absent"}
              issue={entry?.lastIssue ?? null}
              desligado={desligado}
              tentando={tentando}
              onSource={setSource}
              onTentar={() => void tentarDeNovo()}
              onDesligar={() => setDesligado(true)}
              onLigar={() => setDesligado(false)}
            />
          )}
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
      <ConversationMapSourceDialog
        source={source}
        items={safeItems}
        onClose={() => setSource(null)}
        onReveal={reveal}
      />
    </>
  )
}
