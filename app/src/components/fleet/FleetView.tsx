// Rollup "Frota": o que a frota está fazendo, em QUALQUER projeto — view
// global via useApp.fleetOpen (estado próprio, não persiste), cobre o
// conteúdo principal, fecha ao navegar.
//
// A tabela densa (mock `docs/mocks/frota-densa.html`, revisão de 26/09): uma
// linha por trabalho, com a mesma gramática da sidebar — glifo de estado à
// esquerda, metadado mono à direita, precedência fechada `pede > rodando >
// falhou > quando` (o MESMO `slotEstado` de conversationWhen, não uma cópia).
// Seções: "Agora" (o que pede você ∪ o que roda) e "Mais cedo" (o que terminou
// sem você ver — `finishedUnseen`, efêmero, some ao abrir a conversa).
//
// GEOMETRIA: UMA grade (`GRADE`) para o cabeçalho e as linhas. A primeira
// versão usava `flex` com gaps diferentes nos dois, e os rótulos caíam até
// 39px fora dos valores. A linha inteira é o alvo do clique (a `LinhaDeLista`
// esticada por baixo da grade) e a ação mora DENTRO da grade, sem botão
// aninhado em botão.
//
// HONESTIDADE, pela Primeira Lei (estado real, nunca teatro):
// 1. O dinheiro é o acumulado DA CONVERSA (`sessionCost`), e a coluna se chama
//    "Conversa": custo de turno em voo não existe, ele nasce no `result`.
// 2. A atividade é o que o fio sabe, com o MESMO verbo fixo do fio (ADR de
//    21/09: a frase não troca por ferramenta) e o número de ações do turno
//    andando ao lado. O app não inventa "lendo a página…".
// 3. A linha que pede diz o que o agente pediu (o mesmo resumo do sino).
//
// A lógica pura mora em `lib/fleet/linhas.ts`; `FleetRowItem` é por-props de
// propósito: o repo não tem jsdom, e useSyncExternalStore em SSR
// lê `getInitialState()` (zustand v5), não o estado atual — testar o
// container conectado via renderToStaticMarkup daria falso positivo.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { Check, CircleX, Rocket, TriangleAlert, X } from "lucide-react"
import { AgentMark } from "@/components/common/AgentMark"
import { agentLogoLabel } from "@/components/common/AgentLogo"
import { Button } from "@/components/ui/button"
import { CometaVivo } from "@/components/ui/cometa-vivo"
import { LinhaDeLista } from "@/components/ui/linha-de-lista"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cancelConversationTurn } from "@/lib/cancelConversationTurn"
import { fmtCost } from "@/lib/format"
import {
  acoesDoTurno,
  buildFleetLines,
  parseFleetKey,
  parseUnseenKey,
  resumoDoPedido,
  rowSubtitle,
  tempoDaLinha,
  type LinhaDaFrota,
} from "@/lib/fleet/linhas"
import { minuteNow, subscribeMinute } from "@/lib/minuteTick"
import { sessionCost } from "@/lib/sessionCost"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { deferredLiveLine, deferredStopWarning } from "@/store/chat/deferredLive"
import type { DeferredWork } from "@/lib/work"
import { pendingDeferred } from "@/store/chat/terminalTools"
import { useAwaiting, useInteractions, ownerByRunId } from "@/store/interactions"
import { useMission } from "@/store/mission"

// ---------------------------------------------------------------------------
// A linha — PRESENTACIONAL (só props), testável via SSR (ver topo).
// ---------------------------------------------------------------------------

/** A grade da tabela: UMA só, para o cabeçalho e as linhas. Estreita
 *  (container abaixo de 720px), saem Projeto e Motor, e o projeto vira o
 *  ponto de cor ao lado do título. */
const GRADE =
  "grid grid-cols-[16px_minmax(0,1fr)_128px_116px_64px_84px_72px] items-center gap-x-3 px-2 @max-[720px]:grid-cols-[16px_minmax(0,1fr)_56px_76px_72px]"
const SO_LARGA = "@max-[720px]:hidden"
const SO_ESTREITA = "hidden @max-[720px]:inline-block"
const NUMERO = "text-right font-mono text-[11px] tabular-nums text-muted-foreground whitespace-nowrap"

export function FleetRowItem({
  linha,
  subtitulo,
  tempo,
  custo,
  custoEstimado,
  avisoParar,
  onOpen,
  onParar,
}: {
  linha: LinhaDaFrota
  subtitulo: string
  tempo: { texto: string; dica: string }
  /** Custo acumulado da conversa; null = nenhum turno terminou ainda. */
  custo: number | null
  custoEstimado: boolean
  /** Aviso do composer quando há trabalho em background junto. */
  avisoParar: string | null
  onOpen: () => void
  onParar: () => void
}) {
  const atenuada = linha.estado === "falhou" || linha.estado === "quando"
  const pede = linha.estado === "pede"
  const ponto = linha.cor ? (
    <span
      className="size-1.5 shrink-0 rounded-full"
      style={{ background: linha.cor }}
      aria-hidden
    />
  ) : null
  return (
    <div className={cn(GRADE, "group relative min-h-10 py-1.5")}>
      {/* O alvo do clique: a linha inteira, por baixo das células. As células
          não pegam ponteiro; só a ação (Responder/Parar) fica por cima. */}
      <LinhaDeLista
        onClick={onOpen}
        aria-label={`Abrir ${linha.titulo}`}
        className={cn(
          "absolute inset-0 py-0",
          pede && "bg-st-warning/[0.07] hover:bg-st-warning/[0.12]",
        )}
      />
      <span className="pointer-events-none relative flex items-center justify-center">
        {pede && (
          <TriangleAlert className="size-3.5 text-st-warning" aria-label="aguardando você" />
        )}
        {linha.estado === "rodando" && (
          <CometaVivo cor={linha.cor ?? "var(--st-running)"} rotulo="turno rodando" />
        )}
        {linha.estado === "falhou" && (
          <CircleX className="size-3.5 text-st-error" aria-label="turno falhou" />
        )}
        {linha.estado === "quando" && (
          <Check className="size-3.5 text-faint" aria-label="turno concluído" />
        )}
      </span>

      <span className="pointer-events-none relative min-w-0">
        <span
          className={cn(
            "flex items-center gap-1.5 text-[13px]",
            atenuada ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {ponto && <span className={SO_ESTREITA}>{ponto}</span>}
          <span className="truncate">{linha.titulo}</span>
        </span>
        <span
          className={cn(
            "block truncate text-[11px]",
            pede ? "text-st-warning" : linha.estado === "falhou" ? "text-st-error" : "text-faint",
          )}
        >
          {subtitulo}
        </span>
      </span>

      <span
        className={cn(
          SO_LARGA,
          "pointer-events-none relative flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground",
        )}
      >
        {ponto}
        <span className="truncate">{linha.projectName}</span>
      </span>

      <span
        className={cn(
          SO_LARGA,
          "pointer-events-none relative flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground",
        )}
      >
        {linha.agent && <AgentMark agent={linha.agent} tamanho={12} />}
        <span className="truncate">{linha.agent ? agentLogoLabel(linha.agent) : ""}</span>
      </span>

      <span className={cn(NUMERO, "pointer-events-none relative")} title={tempo.dica}>
        {tempo.texto}
      </span>

      <span
        className={cn(NUMERO, "pointer-events-none relative")}
        title="Gasto da conversa inteira, até o último turno terminado"
      >
        {custo != null && custo > 0 ? fmtCost(custo, custoEstimado ? "estimated" : undefined) : ""}
      </span>

      <span className="pointer-events-none relative flex justify-end [&>button]:pointer-events-auto">
        {pede ? (
          <Button
            variant="ghost"
            size="chip"
            onClick={onOpen}
            className="font-medium text-st-warning hover:bg-st-warning/10 hover:text-st-warning"
          >
            Responder
          </Button>
        ) : linha.rodando ? (
          <Button
            variant="ghost"
            size="chip"
            onClick={onParar}
            title={avisoParar ?? "Interromper o turno"}
            aria-label={`Parar ${linha.titulo}`}
            className="text-st-error opacity-0 transition-opacity hover:bg-st-error/10 hover:text-st-error group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
          >
            Parar
          </Button>
        ) : null}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Conectados: a store entra aqui, e só aqui.
// ---------------------------------------------------------------------------

function useRunningKey(): string {
  return useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.running)
      .map(([id, c]) => `${id}:${c.projectId}:${c.agent}:${c.startedAt ?? ""}`)
      .sort()
      .join("|"),
  )
}

function useUnseenKey(): string {
  return useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.finishedUnseen)
      .map(([id, c]) => `${id}:${c.projectId}:${c.finishedUnseen}`)
      .sort()
      .join("|"),
  )
}

/** Ticker de 1s da view inteira (NÃO um por linha — padrão minuteTick): liga
 *  só enquanto há cronômetro visível, morre com ele. */
function useSegundoTick(ativo: boolean): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (!ativo) return
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ativo])
  return agora
}

function openFleetRow(linha: Pick<LinhaDaFrota, "id" | "projectId">) {
  useApp.getState().setActiveProject(linha.projectId)
  useApp.getState().setViewMode("linear")
  void useChat.getState().switchConversation(linha.id)
}

/** O resumo do pedido pendente DESTA conversa (o mesmo do sino), como string
 *  estável: só muda quando a fila muda. */
function usePedidoDaConversa(convId: string, ativo: boolean): string | null {
  return useInteractions((s) => {
    if (!ativo) return null
    const chat = useChat.getState()
    const missions = useMission.getState()
    const req = s.queue.find((r) => ownerByRunId(r, chat, missions)?.convId === convId)
    return req ? resumoDoPedido(req) : null
  })
}

/** A ponte: lê o ConvState da conversa (custo, ações e background vivem nos
 *  itens) e passa tudo já derivado para a linha pura. Re-render por delta é
 *  aceitável aqui: são poucas linhas vivas, e é onde o dado muda. */
function FleetRowConectada({
  linha,
  agora,
  agoraMinuto,
}: {
  linha: LinhaDaFrota
  agora: number
  agoraMinuto: number
}) {
  const items = useChat((s) => s.byId[linha.id]?.items)
  const finalizando = useChat((s) => s.byId[linha.id]?.finalizing ?? false)
  const pedido = usePedidoDaConversa(linha.id, linha.estado === "pede")

  const works: DeferredWork[] = useMemo(
    () => (items ? pendingDeferred(items) : []),
    [items],
  )
  const custo = useMemo(() => (items ? sessionCost(items) : null), [items])
  const fundo = useMemo(() => deferredLiveLine(works), [works])
  const acoes = useMemo(() => (items ? acoesDoTurno(items) : 0), [items])

  return (
    <FleetRowItem
      linha={linha}
      subtitulo={rowSubtitle({
        estado: linha.estado,
        finalizando,
        fundo: fundo?.text ?? null,
        pedido,
        acoes,
      })}
      // O relógio pertence ao que está ESCRITO: com background vivo é o
      // trabalho nomeado, senão o turno (a mesma regra do WorkingIndicator).
      tempo={tempoDaLinha({
        estado: linha.estado,
        inicio: fundo?.since ?? linha.startedAt,
        updatedAt: linha.updatedAt,
        agora,
        agoraMinuto,
      })}
      custo={custo && custo.turns > 0 ? custo.total : null}
      custoEstimado={custo?.estimated ?? false}
      avisoParar={deferredStopWarning(works) ?? null}
      onOpen={() => openFleetRow(linha)}
      onParar={() => void cancelConversationTurn(linha.id, "parada")}
    />
  )
}

export function CabecalhoDeColunas() {
  return (
    <div className={cn(GRADE, "h-7 pt-3")}>
      <span />
      <span className="etiqueta">Trabalho</span>
      <span className={cn(SO_LARGA, "etiqueta")}>Projeto</span>
      <span className={cn(SO_LARGA, "etiqueta")}>Motor</span>
      <span className="etiqueta text-right">Tempo</span>
      <span
        className="etiqueta text-right"
        title="Gasto da conversa inteira, até o último turno terminado"
      >
        Conversa
      </span>
      <span />
    </div>
  )
}

export function FleetView() {
  const setFleetOpen = useApp((s) => s.setFleetOpen)
  const runningKey = useRunningKey()
  const unseenKey = useUnseenKey()
  const awaiting = useAwaiting()
  const metas = useChat((s) => s.conversationsByProject)
  const projetos = useApp((s) => s.projects)
  const agoraMinuto = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow)

  const { agora: linhasAgora, maisCedo } = useMemo(
    () =>
      buildFleetLines({
        vivas: parseFleetKey(runningKey),
        terminadas: parseUnseenKey(unseenKey),
        aguardando: awaiting.convIds,
        metas,
        projetos,
      }),
    [runningKey, unseenKey, awaiting, metas, projetos],
  )

  const temViva = linhasAgora.some((l) => l.estado === "rodando")
  const agora = useSegundoTick(temViva)

  const nRodando = linhasAgora.filter((l) => l.rodando).length
  const nPede = linhasAgora.filter((l) => l.estado === "pede").length
  const vazia = linhasAgora.length === 0 && maisCedo.length === 0

  return (
    <ScrollArea className="h-full w-full bg-background">
      <div className="@container mx-auto flex w-full max-w-[960px] flex-col px-8 pt-8 pb-14">
        <header className="flex items-center gap-2 border-b pb-3">
          <Rocket className="size-3.5 text-muted-foreground" />
          <h1 className="etiqueta">Frota</h1>
          <span className="ml-auto flex items-center gap-2 font-mono text-[11px] tabular-nums text-faint">
            {nRodando > 0 && <span>{nRodando} rodando</span>}
            {nRodando > 0 && nPede > 0 && <span aria-hidden>·</span>}
            {nPede > 0 && (
              <span className="text-st-warning">
                {nPede} {nPede === 1 ? "precisa" : "precisam"} de você
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setFleetOpen(false)}
            title="Fechar"
            aria-label="Fechar Frota"
            className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        {vazia ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <p className="text-[13px] text-muted-foreground">Nada rodando na frota.</p>
            <p className="text-[12px] text-faint">
              Mande uma tarefa em qualquer conversa e ela aparece aqui.
            </p>
          </div>
        ) : (
          <>
            <CabecalhoDeColunas />
            {linhasAgora.length > 0 && (
              <section aria-label="Agora">
                <div className="etiqueta px-2 pt-3.5 pb-1">
                  Agora · <span className="font-mono">{linhasAgora.length}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {linhasAgora.map((linha) => (
                    <FleetRowConectada
                      key={linha.id}
                      linha={linha}
                      agora={agora}
                      agoraMinuto={agoraMinuto}
                    />
                  ))}
                </div>
              </section>
            )}
            {maisCedo.length > 0 && (
              <section aria-label="Mais cedo">
                <div className="etiqueta px-2 pt-3.5 pb-1">Mais cedo</div>
                <div className="flex flex-col gap-0.5">
                  {maisCedo.map((linha) => (
                    <FleetRowConectada
                      key={linha.id}
                      linha={linha}
                      agora={agora}
                      agoraMinuto={agoraMinuto}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  )
}
