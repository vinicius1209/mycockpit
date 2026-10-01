// Extraído do MessageList (catraca de tamanho, STYLEGUIDE §10: divide o
// arquivo, não sobe o teto) — o indicador "trabalhando…" não tem estado
// próprio do painel, é uma superfície fechada como os banners do composer.
import { abrirBastidores } from "@/components/bastidores/abrirBastidores"
import { ActivityAge, Elapsed } from "@/components/chat/LiveTime"
import { resolveExecutorIdentity } from "@/components/chat/executorIdentity"
import type { DeferredWork } from "@/lib/work"
import { cn } from "@/lib/utils"
import { TextoVivo } from "@/components/ui/texto-vivo"
import { useTrocou } from "@/lib/nascimento"
import { deferredLiveLine, useRunLiveness, type RunLiveness } from "@/store/chat"
import type { Node } from "@/components/chat/messageNodes"
import { usePresets } from "@/store/presets"

/** Extrai se há ferramentas pendentes ou se todas as ações concluíram no grupo. */
export function summarizeWorkingNodes(nodes?: Node[]): {
  hasUnfinishedTool: boolean
  completedToolsCount: number
} {
  if (!nodes || nodes.length === 0) {
    return { hasUnfinishedTool: false, completedToolsCount: 0 }
  }
  let hasUnfinishedTool = false
  let completedToolsCount = 0
  for (const n of nodes) {
    const tools = n.type === "tools" ? n.tools : n.type === "prose" ? n.tools : []
    for (const t of tools) {
      if (t.result == null) {
        hasUnfinishedTool = true
      } else {
        completedToolsCount++
      }
    }
  }
  return { hasUnfinishedTool, completedToolsCount }
}

/** Indicador "trabalhando…" estilo Slack/typing: o avatar do executor no mesmo
 *  gutter das mensagens + "está trabalhando…" com dots escalonados + cronômetro.
 *  `finalizando…` mantém o formato (só troca o verbo). As ações concluídas
 *  entram como CONTADOR ao lado do cronômetro, nunca como frase nova. Com trabalho DIFERIDO
 *  vivo (deferred-work-plan D1.3), o rótulo fica honesto: o CLI segura o turno
 *  aberto enquanto o background task roda — o spinner mudo virava mentira.
 *
 *  É a ÚNICA superfície do "agora" (background-status B2.2): o nó no fio é
 *  marco/resultado, não um segundo painel vivo. Regras do layout, do estudo do
 *  Warp (B1'): o cronômetro é irmão do que anima (nunca dentro), tem largura
 *  reservada + `tabular-nums` + `shrink-0`, e quem trunca é o NOME (B2.1). */
export function WorkingIndicator({
  agent,
  presetId,
  finalizing,
  running,
  startedAt,
  deferred = [],
  stalledSince,
  runLiveness: propRunLiveness,
  inline = false,
  nodes,
  convId,
}: {
  agent: string
  presetId: string | null
  finalizing: boolean
  running: boolean
  startedAt: number | null
  /** Trabalhos em background vivos (derivado de items, replay-safe). */
  deferred?: DeferredWork[]
  /** O vigia (lib/watchdog.checkStalledTurns) marcou este turno como mudo
   *  (> settings.stalledAfterMin, default 10min). Permite sinalizar o estado
   *  na linha viva mesmo após o toast expirar. */
  stalledSince?: number
  /** Sonda factual da árvore do processo. Não move o relógio de atividade. */
  runLiveness?: RunLiveness
  /** Quando true, renderiza apenas a linha viva (sem duplicar gutter, avatar e nome do autor anterior). */
  inline?: boolean
  /** Nós do grupo do TURNO VIVO, para contextualizar a atividade (ação em curso
   *  ou síntese depois das ações). Só o indicador INLINE passa isto, e a
   *  omissão no indicador solto é deliberada: lá o último grupo NÃO é o do
   *  executor, então as ações dele não descrevem o que está acontecendo agora.
   *  Passá-las é inerte no caso comum (grupo de usuário não tem tool) e, com
   *  parecer em voo sobre um grupo de executor, viraria "sintetizando resposta
   *  após N ações…" contando ações do turno ANTERIOR — atividade inventada.
   *  Ausente = rótulo genérico, que é a degradação honesta. */
  nodes?: Node[]
  /** Identificador opcional da conversa p/ seletor granular de liveness (ADR-183). */
  convId?: string | null
}) {
  const storeLiveness = useRunLiveness(convId)
  const runLiveness = propRunLiveness ?? storeLiveness
  const presets = usePresets((s) => s.list)
  const { gutter, name, engine } = resolveExecutorIdentity(presets, agent, presetId)
  const live = deferredLiveLine(deferred)
  const stalled = !live && stalledSince != null
  const { completedToolsCount } = summarizeWorkingNodes(nodes)
  // O VERBO não muda por causa de ferramenta. Até 21/09/2026 a linha dizia
  // "sintetizando resposta após N ações…" sempre que não havia tool aberta, e
  // voltava para "está trabalhando…" na tool seguinte: num turno de 30 ações
  // eram 60 trocas com crossfade, e a frase era inferência, não fato (entre
  // duas tools o modelo está decidindo a próxima, não escrevendo a resposta).
  // A frase só troca por evento REAL: trabalho em segundo plano, `finalizando`
  // e turno mudo. O que anda no lugar é o número, ao lado do cronômetro.
  const label = live ? live.text : finalizing ? "finalizando…" : "está trabalhando…"
  const fase = live ? "fundo" : finalizing ? "finalizando" : "trabalhando"
  const trocouFase = useTrocou(fase)
  // O relógio pertence ao que está ESCRITO na linha: com background vivo é o
  // trabalho nomeado (o turno zera o startedAt no `result`, e era justo aí que
  // o cronômetro sumia); sem background, é o turno.
  const since = live ? live.since : running ? startedAt : null
  const livenessTitle = runLiveness
    ? [
        runLiveness.descendants == null
          ? null
          : `${runLiveness.descendants} descendente${runLiveness.descendants === 1 ? "" : "s"}`,
        runLiveness.rssMb == null ? null : `${runLiveness.rssMb} MB no grupo`,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined

  const liveLine = (
    <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
      {stalled ? (
        <span className="flex min-w-0 items-center gap-1 truncate" title={livenessTitle}>
          {runLiveness?.mainAlive === false ? (
            <span>Processo encerrou sem concluir o turno</span>
          ) : (
            <>
              <span>
                {runLiveness?.mainAlive === true
                  ? "Processo ativo,"
                  : "Não foi possível confirmar o estado do processo,"}
              </span>
              <ActivityAge at={stalledSince} stalled />
            </>
          )}
        </span>
      ) : (
        live ? (
          // ADR-200: a linha de trabalho em segundo plano abre os Bastidores.
          <button
            type="button"
            key={fase}
            onClick={() => abrirBastidores(convId)}
            className={cn(
              "min-w-0 truncate rounded text-left underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              trocouFase && "fio-nasce",
            )}
            title={live.detail}
          >
            <TextoVivo>{label}</TextoVivo>
            <span className="sr-only"> (acompanhar nos bastidores)</span>
          </button>
        ) : (
          <span
            key={fase}
            className={cn("min-w-0 truncate", trocouFase && "fio-nasce")}
          >
            {/* §2.2: dentro do fio o vivo é movimento, não tinta. A luz que
                atravessa a frase é o sinal, movida pelo relógio único. */}
            <TextoVivo>{label}</TextoVivo>
          </span>
        )
      )}
      {/* Travado não é "vivo", é aviso: pontos âmbar parados, outro eixo.
          Vivo não tem ícone: a própria frase brilha (ADR-259). */}
      {stalled && (
        <span className="flex shrink-0 items-center gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 rounded-full bg-st-warning/70" />
          ))}
        </span>
      )}
      {/* Fato que anda no lugar: dígitos de largura fixa, sem crossfade. Some
          com trabalho em segundo plano, onde a linha fala de OUTRO relógio. */}
      {!live && !stalled && completedToolsCount > 0 && (
        <span className="shrink-0 font-mono text-foreground/70 tabular-nums">
          {completedToolsCount} {completedToolsCount === 1 ? "ação" : "ações"} ·
        </span>
      )}
      {since != null && (
        <Elapsed
          since={since}
          className="min-w-[4.5rem] shrink-0 font-mono text-foreground/70"
        />
      )}
    </div>
  )

  if (inline) {
    return liveLine
  }

  return (
    <div className="flex gap-3">
      <div className="w-7 shrink-0 pt-0.5">{gutter}</div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-foreground">{name}</span>
          {engine && (
            <span className="rounded border px-1 py-px text-[11px] text-muted-foreground">
              {engine}
            </span>
          )}
        </div>
        {liveLine}
      </div>
    </div>
  )
}
