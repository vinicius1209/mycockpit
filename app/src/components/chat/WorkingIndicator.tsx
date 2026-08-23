// Extraído do MessageList (catraca de tamanho, STYLEGUIDE §10: divide o
// arquivo, não sobe o teto) — o indicador "trabalhando…" não tem estado
// próprio do painel, é uma superfície fechada como os banners do composer.
import { ActivityAge, Elapsed } from "@/components/chat/LiveTime"
import { resolveExecutorIdentity } from "@/components/chat/executorIdentity"
import type { DeferredWork } from "@/lib/work"
import { cn } from "@/lib/utils"
import { deferredLiveLine } from "@/store/chat"
import { usePresets } from "@/store/presets"

/** Indicador "trabalhando…" estilo Slack/typing: o avatar do executor no mesmo
 *  gutter das mensagens + "está trabalhando…" com dots escalonados + cronômetro.
 *  `finalizando…` mantém o formato (só troca o verbo). Com trabalho DIFERIDO
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
}: {
  agent: string
  presetId: string | null
  finalizing: boolean
  running: boolean
  startedAt: number | null
  /** Trabalhos em background vivos (derivado de items, replay-safe). */
  deferred?: DeferredWork[]
  /** O vigia (lib/watchdog.checkStalledTurns) já marcou este turno como mudo
   *  (> `settings.stalledAfterMin`, default 10min) — o toast dele dura só
   *  15s, então sem isto a linha viva ficava dizendo "está trabalhando…"
   *  genérico pro resto do silêncio inteiro, sem nenhum jeito de saber
   *  depois que o toast passou (achado real do usuário, 18/08/2026: 22min
   *  de silêncio sem sinal nenhum na linha). */
  stalledSince?: number
}) {
  const presets = usePresets((s) => s.list)
  const { gutter, name, engine } = resolveExecutorIdentity(presets, agent, presetId)
  const live = deferredLiveLine(deferred)
  const stalled = !live && stalledSince != null
  const label = live
    ? live.text
    : finalizing
      ? "finalizando…"
      : "está trabalhando…"
  // O relógio pertence ao que está ESCRITO na linha: com background vivo é o
  // trabalho nomeado (o turno zera o startedAt no `result`, e era justo aí que
  // o cronômetro sumia); sem background, é o turno.
  const since = live ? live.since : running ? startedAt : null
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
        <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
          {stalled ? (
            <ActivityAge at={stalledSince} stalled />
          ) : (
            <span className="min-w-0 truncate" title={live ? live.detail : undefined}>
              {label}
            </span>
          )}
          <span className="flex shrink-0 items-center gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  "size-1.5 rounded-full",
                  stalled
                    ? "bg-st-warning/70"
                    // §2.2: a linha "trabalhando" mora DENTRO do fio, então o
                    // vivo dela é o pulso, não a tinta. O âmbar do `stalled` fica:
                    // travado não é "vivo", é aviso, e isso é outro eixo.
                    : "animate-cockpit-pulse bg-foreground/45",
                )}
                style={stalled ? undefined : { animationDelay: `${i * 0.18}s` }}
              />
            ))}
          </span>
          {since != null && (
            <Elapsed
              since={since}
              className="ml-1 min-w-[4.5rem] shrink-0 font-mono text-foreground/70"
            />
          )}
        </div>
      </div>
    </div>
  )
}
