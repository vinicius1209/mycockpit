// O corpo da fase VIVA. Dois componentes possíveis no mesmo slot, e quem
// escolhe é a capability do motor (lib/missionQuiet), nunca o nome dele:
//
//   motor falante → o feed de ações (escada do rótulo + regra de ruído)
//   motor calado  → o bloco que DIZ o que se sabe (as duas idades, a última
//                   linha que ele escreveu), em vez de "preparando…"
//
// Identidade (motor e modelo) NÃO aparece aqui: ela já está no cabeçalho da
// fase, e repeti-la era metade do "Claude · Claude · Opus 5" do build 193
// (ADR-037: o cabeçalho diz o quê, o filho mostra o delta).

import { InteractionCard } from "@/components/chat/InteractionHost"
import type { InteractionRequest } from "@/lib/interaction"
import { fmtDuration } from "@/lib/format"
import {
  buildPhaseFeed,
  type ActionState,
  type FeedRow,
} from "@/lib/missionAction"
import { narratesActions, quietPhaseView } from "@/lib/missionQuiet"
import { interruptPrice, MISSION_GESTURES } from "@/lib/missionGestures"
import { RepeatWarningCard } from "@/components/mission/RepeatWarning"
import { useRepeatWarning } from "@/hooks/useRepeatWarning"
import type { MissionPhaseRun } from "@/lib/missionTypes"
import { cn } from "@/lib/utils"

/** Marcador de estado de UMA ação. Cinza é sucesso (o caso comum não ganha
 *  tinta); vermelho é falha consumada; o vivo pulsa em azul, ou fica âmbar
 *  parado quando a fase está sob suspeita de repetição. */
function ActionMark({
  state,
  stalled,
}: {
  state: ActionState
  stalled?: boolean
}) {
  if (state === "erro") {
    return <span className="w-3 text-center text-[11px] text-st-error">✗</span>
  }
  if (state === "viva") {
    return (
      <span className="grid w-3 place-items-center">
        <span
          className={cn(
            "size-1.5 rounded-full",
            stalled ? "bg-st-warning" : "animate-cockpit-pulse bg-st-running",
          )}
        />
      </span>
    )
  }
  return (
    <span className="w-3 text-center text-[11px] text-muted-foreground">✓</span>
  )
}

function FeedLine({ row, stalled }: { row: FeedRow; stalled?: boolean }) {
  if (row.kind === "stub") {
    return (
      <div className="flex items-center gap-2 py-[3px] text-[13px]">
        <span className="w-3 text-center text-[11px] text-muted-foreground">✓</span>
        <span className="min-w-0 truncate text-faint">{row.label}</span>
      </div>
    )
  }
  if (row.kind === "sem-rotulo") {
    return (
      <div className="flex items-center gap-2 py-[3px] text-[13px]">
        <span className="w-3 text-center text-[11px] text-muted-foreground">✓</span>
        {/* a culpa dita, e o buraco mensurável: se aparecer "9 ações sem
            rótulo", o adapter tem bug e o usuário vê */}
        <span className="min-w-0 truncate text-faint">{row.label}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 py-[3px] text-[13px]">
      <ActionMark state={row.state} stalled={stalled} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          row.state === "viva" ? "text-foreground" : "text-muted-foreground",
          // degrau 2 e 3 são payload cru: o mono declara que aquilo é
          // identificador, não prosa.
          row.rung > 1 && "font-mono text-[12px]",
        )}
      >
        {row.label}
      </span>
      {/* o número é IRMÃO do que anima, nunca filho (Warp R2) */}
      {row.durationMs != null && row.durationMs >= 1000 && (
        <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-faint">
          {fmtDuration(row.durationMs)}
        </span>
      )}
    </div>
  )
}

/** O bloco do motor calado: ignorância declarada com o que se sabe. */
function QuietEngine({ phase, now }: { phase: MissionPhaseRun; now: number }) {
  const v = quietPhaseView(phase, now)
  return (
    <div
      className={cn(
        "mt-3 rounded-lg bg-background/45 px-3 py-2.5",
        v.stalled && "bg-st-warning/[0.06] ring-1 ring-st-warning/45",
      )}
    >
      <div
        className={cn(
          "text-[13px]",
          v.stalled ? "text-st-warning" : "text-foreground",
        )}
      >
        {v.headline}
      </div>
      <div className="mt-1 font-mono text-[11px] tabular-nums text-faint">
        {v.ages}
      </div>
      <div className="font-mono text-[11px] tabular-nums text-faint">
        {v.reported}
      </div>
      {v.lastLine && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="etiqueta mb-1">última linha que ele escreveu</div>
          <div className="truncate font-mono text-[12px] text-muted-foreground">
            {v.lastLine}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Corpo da fase em execução.
 *
 * `interactions` = pedidos pendentes DESTA conversa (permissão ou pergunta): o
 * card entra aqui, junto da cena que ele interrompeu.
 *
 * NÃO existe uma linha "Agora: …" separada, e essa ausência é a correção
 * estrutural do defeito 1: no build 193 a linha viva era um ECO do marco acima
 * ("Agora: Criar landing-plan.md" logo abaixo de "Criar landing-plan.md").
 * Aqui a ação sem desfecho É a última linha do feed, viva; as de cima já estão
 * no pretérito. Duplicar virou impossível por construção, não por cuidado.
 */
export function PhaseLive({
  phase,
  now,
  cwd,
  interactions,
  holdRequested,
  onToggleHold,
  onInterrupt,
}: {
  phase: MissionPhaseRun
  /** Injetado pelo cronômetro do pai: um relógio vivo só na tela (B2.2). */
  now: number
  /** Raiz do worktree da missão: é o que o aviso de repetição precisa pra
   *  perguntar "mudou alguma coisa desde a primeira?" (R11). */
  cwd: string
  interactions?: InteractionRequest[]
  /** Você já pediu pra segurar no fim desta fase (reversível enquanto roda). */
  holdRequested?: boolean
  onToggleHold?: (on: boolean) => void
  onInterrupt?: () => void
}) {
  const narrates = narratesActions(phase.def.agent)
  const feed = narrates ? buildPhaseFeed(phase.items, { live: true }) : []
  // R11 — o aviso só nasce com os DOIS fatores, e a amostragem do worktree só
  // liga depois que o primeiro disparou (em missão saudável, nenhum git roda).
  const repeticao = useRepeatWarning(phase, cwd, now)
  const stalled = repeticao != null
  const preco = interruptPrice(phase.def.agent)
  return (
    <div className="mt-3">
      {repeticao && (
        <RepeatWarningCard
          warning={repeticao}
          onInterrupt={onInterrupt}
          interruptPrice={preco}
        />
      )}
      {narrates ? (
        feed.length > 0 ? (
          <div className="flex flex-col rounded-lg bg-background/45 px-3 py-2">
            {feed.map((row) => (
              <FeedLine key={row.id} row={row} stalled={stalled} />
            ))}
          </div>
        ) : (
          // slot reservado e VAZIO: o motor narra, mas ainda não narrou nada.
          // Antes daqui saía "preparando…", que anunciava ignorância como fato.
          <div className="rounded-lg bg-background/45 px-3 py-2 text-[12px] text-faint">
            nenhuma ação reportada ainda
          </div>
        )
      ) : (
        <QuietEngine phase={phase} now={now} />
      )}
      {interactions && interactions.length > 0 && (
        <div className="mt-2.5">
          <InteractionCard
            key={interactions[0].id}
            req={interactions[0]}
            extra={interactions.length - 1}
          />
        </div>
      )}
      {/* Os gestos ficam COLADOS na fase corrente, não num painel próprio: em
          missão curta a infraestrutura de controle some junto com a fase.
          "Pausar" não aparece porque não existe (R7); o preço de interromper é
          por motor e está escrito ao lado, antes do clique. */}
      {(onToggleHold || onInterrupt) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1">
          {onToggleHold && (
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted-foreground">
              <input
                type="checkbox"
                checked={Boolean(holdRequested)}
                onChange={(e) => onToggleHold(e.target.checked)}
                className="size-3.5 accent-[var(--brass)]"
              />
              {MISSION_GESTURES.segurar.label}
            </label>
          )}
          {onInterrupt && !repeticao && (
            <button
              type="button"
              onClick={onInterrupt}
              className="text-[12px] text-muted-foreground underline decoration-border-strong underline-offset-2 transition-colors hover:text-foreground"
              title={`${MISSION_GESTURES.interromper.effect}. ${preco}`}
            >
              {MISSION_GESTURES.interromper.label}
            </button>
          )}
          {holdRequested && (
            <span className="text-[11px] text-faint">
              {MISSION_GESTURES.segurar.effect}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
