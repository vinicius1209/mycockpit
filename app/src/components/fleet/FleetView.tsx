// Rollup "Frota": o que a frota está fazendo, em QUALQUER projeto — view
// global via useApp.fleetOpen (estado próprio, não persiste), cobre o
// conteúdo principal, fecha ao navegar.
//
// A tabela densa (mock `docs/mocks/frota-densa.html`): uma linha por trabalho,
// com a mesma gramática da sidebar — glifo de estado à esquerda, metadado mono
// à direita, precedência fechada `pede > rodando > falhou > quando` (o MESMO
// `slotEstado` de conversationWhen, não uma cópia). Seções: "Agora" (o que
// pede você ∪ o que roda) e "Mais cedo" (o que terminou sem você ver —
// `finishedUnseen`, efêmero, some ao abrir a conversa).
//
// DUAS HONESTIDADES contra o mock, pela Primeira Lei (estado real, nunca
// teatro):
// 1. CUSTO é o acumulado DA CONVERSA (`sessionCost` dos itens): custo de
//    turno em voo não existe — ele só nasce no item `result`. Sem turno
//    terminado, a célula fica vazia.
// 2. ATIVIDADE é o que o fio realmente sabe: a linha de trabalho em
//    background (`deferredLiveLine`), `finalizando…` ou `está trabalhando…`
//    (as frases do WorkingIndicator). O app não inventa "lendo a página…".
//
// `parseFleetKey`/`buildFleetLines`/`rowSubtitle`/`FleetRowItem` são PUROS ou
// por-props de propósito: o repo não tem jsdom, e useSyncExternalStore em SSR
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
import type { ConversationMeta } from "@/lib/db/conversations"
import { cancelConversationTurn } from "@/lib/cancelConversationTurn"
import { fmtCost, fmtDuration } from "@/lib/format"
import { minuteNow, subscribeMinute } from "@/lib/minuteTick"
import { sessionCost } from "@/lib/sessionCost"
import { slotEstado, fmtQuando, type SlotEstado } from "@/components/layout/conversationWhen"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { deferredLiveLine, deferredStopWarning } from "@/store/chat/deferredLive"
import type { DeferredWork } from "@/lib/work"
import { pendingDeferred } from "@/store/chat/terminalTools"
import { useAwaiting } from "@/store/interactions"

// ---------------------------------------------------------------------------
// Chaves estáveis (uma string só muda em TRANSIÇÃO, nunca por delta de
// streaming — padrão de useRunningConvIds em ConversationList).
// ---------------------------------------------------------------------------

export interface FleetRow {
  id: string
  projectId: string
  agent: string
  startedAt: number | null
}

/** Desserializa a chave estável (id:projectId:agent:startedAt, uma por "|")
 *  de volta em linhas. Pura — sem isso, o hook não seria testável (ver topo). */
export function parseFleetKey(key: string): FleetRow[] {
  if (!key) return []
  return key.split("|").map((part): FleetRow => {
    const [id, projectId, agent, startedAt] = part.split(":")
    return { id, projectId, agent, startedAt: startedAt ? Number(startedAt) : null }
  })
}

export interface UnseenRow {
  id: string
  projectId: string
  resultado: "ok" | "error"
}

/** Espelho do parseFleetKey para `finishedUnseen` (id:projectId:ok|error). */
export function parseUnseenKey(key: string): UnseenRow[] {
  if (!key) return []
  return key.split("|").map((part): UnseenRow => {
    const [id, projectId, resultado] = part.split(":")
    return { id, projectId, resultado: resultado === "error" ? "error" : "ok" }
  })
}

// ---------------------------------------------------------------------------
// Derivação pura: quais linhas, em qual seção, em qual ordem.
// ---------------------------------------------------------------------------

type ProjetoMinimo = { id: string; name: string; color?: string | null }

export interface LinhaDaFrota {
  id: string
  projectId: string
  projectName: string
  agent: string | null
  titulo: string
  /** Cor da conversa, senão a do projeto (a regra do cometa na sidebar). */
  cor: string | null
  estado: SlotEstado
  /** O processo está no ar (uma linha que PEDE continua rodando: ela espera). */
  rodando: boolean
  /** Cronômetro do turno (só pinta na rodando; ver rowSubtitle pro porquê). */
  startedAt: number | null
  updatedAt: number | null
}

function metaDe(
  metas: Record<string, ConversationMeta[]>,
  projectId: string,
  id: string,
): ConversationMeta | undefined {
  return metas[projectId]?.find((m) => m.id === id)
}

function paraLinha(
  base: { id: string; projectId: string; agent: string | null },
  flags: { pede: boolean; rodando: boolean; falhou: boolean },
  startedAt: number | null,
  metas: Record<string, ConversationMeta[]>,
  projetos: readonly ProjetoMinimo[],
): LinhaDaFrota {
  const meta = metaDe(metas, base.projectId, base.id)
  const projeto = projetos.find((p) => p.id === base.projectId)
  return {
    id: base.id,
    projectId: base.projectId,
    projectName: projeto?.name ?? "?",
    agent: base.agent || meta?.agent || null,
    titulo: meta?.title ?? "Nova conversa",
    cor: meta?.color ?? projeto?.color ?? null,
    estado: slotEstado(flags),
    rodando: flags.rodando,
    startedAt,
    updatedAt: meta?.updatedAt ?? null,
  }
}

/** Monta as duas seções. Agora: pede primeiro (o mais recente a pedir em
 *  cima), depois o que roda (o mais ANTIGO em cima — é o que há mais tempo
 *  merece o olhar, e um travado não se esconde no fim). Mais cedo: falha
 *  antes de concluída; dentro, a mais recente primeiro. Pura. */
export function buildFleetLines(args: {
  vivas: FleetRow[]
  terminadas: UnseenRow[]
  aguardando: ReadonlySet<string>
  metas: Record<string, ConversationMeta[]>
  projetos: readonly ProjetoMinimo[]
}): { agora: LinhaDaFrota[]; maisCedo: LinhaDaFrota[] } {
  const { vivas, terminadas, aguardando, metas, projetos } = args
  const vivasPorId = new Map(vivas.map((r) => [r.id, r]))

  const pede: LinhaDaFrota[] = []
  const roda: LinhaDaFrota[] = []
  const ids = new Set<string>([...vivasPorId.keys(), ...aguardando])
  for (const id of ids) {
    const viva = vivasPorId.get(id)
    const projectId = viva?.projectId ?? projetoIdDaMeta(metas, id)
    if (!projectId) continue
    const linha = paraLinha(
      { id, projectId, agent: viva?.agent ?? null },
      { pede: aguardando.has(id), rodando: viva != null, falhou: false },
      viva?.startedAt ?? null,
      metas,
      projetos,
    )
    ;(linha.estado === "pede" ? pede : roda).push(linha)
  }
  pede.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  roda.sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity))

  const maisCedo = terminadas
    .filter((t) => !ids.has(t.id))
    .map((t) =>
      paraLinha(
        { id: t.id, projectId: t.projectId, agent: null },
        { pede: false, rodando: false, falhou: t.resultado === "error" },
        null,
        metas,
        projetos,
      ),
    )
    .sort((a, b) => {
      const fa = a.estado === "falhou" ? 0 : 1
      const fb = b.estado === "falhou" ? 0 : 1
      return fa - fb || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    })

  return { agora: [...pede, ...roda], maisCedo }
}

/** A conversa existe em alguma meta (pedido sem run vivo não está na chave
 *  de running; o projeto vem de onde der). */
function projetoIdDaMeta(
  metas: Record<string, ConversationMeta[]>,
  id: string,
): string | null {
  for (const [projectId, lista] of Object.entries(metas)) {
    if (lista.some((m) => m.id === id)) return projectId
  }
  return null
}

/** O subtítulo diz só o que é fato, no tempo verbal certo (§6/§7): gerúndio
 *  no vivo, pretérito no marco. `fundo` é o texto do deferredLiveLine. */
export function rowSubtitle(e: {
  estado: SlotEstado
  finalizando: boolean
  fundo: string | null
}): string {
  if (e.estado === "pede") return "aguardando sua resposta"
  if (e.estado === "falhou") return "o último turno falhou"
  if (e.estado === "quando") return "concluída"
  if (e.fundo) return e.fundo
  return e.finalizando ? "finalizando…" : "está trabalhando…"
}

// ---------------------------------------------------------------------------
// A linha — PRESENTACIONAL (só props), testável via SSR (ver topo).
// ---------------------------------------------------------------------------

const COL_PROJETO = "w-[112px]"
const COL_MOTOR = "w-[104px]"
const COL_TEMPO = "w-[76px]"
const COL_CUSTO = "w-[80px]"
const COL_ACOES = "w-[150px]"

export function FleetRowItem({
  linha,
  subtitulo,
  custo,
  custoEstimado,
  avisoParar,
  agora,
  agoraMinuto,
  onOpen,
  onParar,
}: {
  linha: LinhaDaFrota
  subtitulo: string
  /** Custo acumulado da conversa; null = nenhum turno terminou ainda. */
  custo: number | null
  custoEstimado: boolean
  /** Aviso do composer quando há trabalho em background junto. */
  avisoParar: string | null
  agora: number
  agoraMinuto: number
  onOpen: () => void
  onParar: () => void
}) {
  const atenuada = linha.estado === "falhou" || linha.estado === "quando"
  return (
    <div className="group flex items-center gap-1">
      <LinhaDeLista onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="flex w-4 shrink-0 items-center justify-center">
          {linha.estado === "pede" && (
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

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-[13px]",
              atenuada ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {linha.titulo}
          </span>
          <span
            className={cn(
              "block truncate text-[11px]",
              linha.estado === "pede"
                ? "text-st-warning"
                : linha.estado === "falhou"
                  ? "text-st-error"
                  : "text-faint",
            )}
          >
            {subtitulo}
          </span>
        </span>

        <span
          className={cn(
            COL_PROJETO,
            "flex shrink-0 items-center gap-1.5 truncate text-[12px] text-muted-foreground",
          )}
        >
          {linha.cor && (
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: linha.cor }}
              aria-hidden
            />
          )}
          <span className="truncate">{linha.projectName}</span>
        </span>

        <span
          className={cn(
            COL_MOTOR,
            "flex shrink-0 items-center gap-1.5 truncate text-[12px] text-muted-foreground",
          )}
        >
          {linha.agent && <AgentMark agent={linha.agent} tamanho={12} />}
          <span className="truncate">{linha.agent ? agentLogoLabel(linha.agent) : ""}</span>
        </span>

        <span
          className={cn(COL_TEMPO, "shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground")}
          title={linha.estado === "rodando" ? "Duração do turno" : "Última atividade"}
        >
          {linha.estado === "rodando" && linha.startedAt
            ? fmtDuration(agora - linha.startedAt)
            : fmtQuando(linha.updatedAt, agoraMinuto)}
        </span>

        <span
          className={cn(COL_CUSTO, "shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground")}
          title="Custo acumulado da conversa"
        >
          {custo != null && custo > 0 ? fmtCost(custo, custoEstimado ? "estimated" : undefined) : ""}
        </span>
      </LinhaDeLista>

      <span
        className={cn(
          COL_ACOES,
          "flex shrink-0 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {linha.estado === "pede" && (
          <Button
            variant="ghost"
            size="chip"
            onClick={onOpen}
            className="text-st-warning hover:bg-st-warning/10 hover:text-st-warning"
          >
            Responder
          </Button>
        )}
        {linha.estado !== "pede" && (
          <Button variant="ghost" size="chip" onClick={onOpen}>
            Abrir
          </Button>
        )}
        {linha.rodando && (
          <Button
            variant="ghost"
            size="chip"
            onClick={(e) => {
              e.stopPropagation()
              onParar()
            }}
            title={avisoParar ?? "Interromper o turno"}
            aria-label={`Parar ${linha.titulo}`}
            className="text-st-error hover:bg-st-error/10 hover:text-st-error"
          >
            Parar
          </Button>
        )}
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

/** A ponte: lê o ConvState da conversa (custo e background vivem nos itens)
 *  e passa tudo já derivado para a linha pura. Re-render por delta é
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

  const works: DeferredWork[] = useMemo(
    () => (items ? pendingDeferred(items) : []),
    [items],
  )
  const custo = useMemo(() => (items ? sessionCost(items) : null), [items])
  const fundo = useMemo(() => deferredLiveLine(works)?.text ?? null, [works])

  return (
    <FleetRowItem
      linha={linha}
      subtitulo={rowSubtitle({ estado: linha.estado, finalizando, fundo })}
      custo={custo && custo.turns > 0 ? custo.total : null}
      custoEstimado={custo?.estimated ?? false}
      avisoParar={deferredStopWarning(works) ?? null}
      agora={agora}
      agoraMinuto={agoraMinuto}
      onOpen={() => openFleetRow(linha)}
      onParar={() => void cancelConversationTurn(linha.id, "parada")}
    />
  )
}

function CabecalhoDeColunas() {
  return (
    <div className="flex items-center gap-1 px-2 pb-1">
      <span className="w-4 shrink-0" />
      <span className="etiqueta min-w-0 flex-1">Trabalho</span>
      <span className={cn(COL_PROJETO, "etiqueta shrink-0")}>Projeto</span>
      <span className={cn(COL_MOTOR, "etiqueta shrink-0")}>Motor</span>
      <span className={cn(COL_TEMPO, "etiqueta shrink-0 text-right")}>Tempo</span>
      <span className={cn(COL_CUSTO, "etiqueta shrink-0 text-right")}>Custo</span>
      <span className={cn(COL_ACOES, "shrink-0")} />
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
      <div className="mx-auto flex w-full max-w-[960px] flex-col px-8 pt-8 pb-14">
        <header className="flex items-center gap-2">
          <Rocket className="size-3.5 text-muted-foreground" />
          <h1 className="etiqueta">Frota</h1>
          {linhasAgora.length > 0 && (
            <span className="font-mono text-[12px] tabular-nums text-muted-foreground/70">
              {linhasAgora.length}
            </span>
          )}
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
              Despache uma tarefa em qualquer conversa e ela aparece aqui.
            </p>
          </div>
        ) : (
          <>
            {linhasAgora.length > 0 && (
              <section aria-label="Agora">
                <div className="etiqueta px-2 pt-6 pb-2">
                  Agora · {linhasAgora.length}
                </div>
                <CabecalhoDeColunas />
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
                <div className="etiqueta px-2 pt-6 pb-2">Mais cedo</div>
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
