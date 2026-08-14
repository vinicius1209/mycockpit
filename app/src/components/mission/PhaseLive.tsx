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
        "mt-2.5 rounded-[9px] border px-3 py-2.5",
        v.stalled ? "border-st-warning/45 bg-st-warning/[0.06]" : "border-border",
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
          <div className="label-mono mb-1">última linha que ele escreveu</div>
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
  interactions,
  stalled,
}: {
  phase: MissionPhaseRun
  /** Injetado pelo cronômetro do pai: um relógio vivo só na tela (B2.2). */
  now: number
  interactions?: InteractionRequest[]
  /** A fase está sob aviso de repetição: o azul sai e o pulse para (quando
   *  "está repetindo" vira a informação, "está rodando" deixa de ser). */
  stalled?: boolean
}) {
  const narrates = narratesActions(phase.def.agent)
  const feed = narrates ? buildPhaseFeed(phase.items, { live: true }) : []
  return (
    <div className="mt-2 pl-1">
      {narrates ? (
        feed.length > 0 ? (
          <div className="flex flex-col border-l border-border pl-3">
            {feed.map((row) => (
              <FeedLine key={row.id} row={row} stalled={stalled} />
            ))}
          </div>
        ) : (
          // slot reservado e VAZIO: o motor narra, mas ainda não narrou nada.
          // Antes daqui saía "preparando…", que anunciava ignorância como fato.
          <div className="border-l border-border pl-3 text-[12px] text-faint">
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
    </div>
  )
}
