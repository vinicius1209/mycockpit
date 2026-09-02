import type { ReactNode } from "react"
import { usePresets } from "@/store/presets"
import { useApp } from "@/store/app"
import { UserAvatar } from "@/components/user/UserAvatar"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import { resolveExecutorIdentity } from "@/components/chat/executorIdentity"
import { fmtTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { GroupAuthor } from "@/components/chat/messageGroups"

/** Uma linha de grupo estilo Slack: avatar no gutter + cabeçalho (nome) UMA vez,
 *  e os corpos dos nós contíguos daquele autor indentados sob o mesmo gutter
 *  (largura fixa 28px, o fio fica coeso pra todos os tipos). O autor sistema
 *  (interrupção/aviso) é voz sem dono: sem gutter nem cabeçalho.
 *
 *  `workingTail`: quando o turno está ativo e este grupo pertence ao executor,
 *  recebe a linha viva (WorkingIndicator inline) no final dos corpos, evitando
 *  duplicar gutter e nome (Defeito B4 de fio-poluicao-2.md, ADR-150). */
export function GroupRow({
  groupKey,
  author,
  agent,
  presetId,
  ts,
  children,
  workingTail,
}: {
  groupKey: string
  author: GroupAuthor
  agent: string
  presetId: string | null
  /** Hora (epoch ms) do 1º item do grupo — vira "HH:MM" ao lado do nome, estilo
   *  Slack. undefined (itens antigos sem carimbo) omite a hora. */
  ts?: number
  children: ReactNode
  workingTail?: ReactNode
}) {
  const presets = usePresets((s) => s.list)
  const { userProfile, userPreferences } = useApp((s) => s.settings)
  const time = fmtTime(ts)

  if (author.kind === "system") {
    return <div className="flex flex-col gap-1.5">{children}</div>
  }

  let gutter: ReactNode
  let name: string
  let nameClass = "text-foreground"
  // Selo do motor no CABEÇALHO (B2.3): só no grupo do executor, e só quando o
  // nome exibido é de uma persona (senão o nome já é o motor).
  let engine: string | null = null
  if (author.kind === "you") {
    gutter = <UserAvatar size={28} profile={userProfile} alt="" />
    name =
      (userPreferences?.chatAuthorDisplay === "name" &&
        userProfile?.name.trim()) ||
      "Você"
  } else if (author.kind === "especialista") {
    const persona = presets.find((p) => p.id === author.personaId)
    gutter = (
      <AgentAvatar
        def={persona}
        seed={persona ? undefined : author.personaId || author.personaName}
        size={28}
        rounded
      />
    )
    name = author.personaName
    nameClass = "text-brass"
  } else {
    // executor: identidade compartilhada com o indicador de "trabalhando…".
    const id = resolveExecutorIdentity(presets, agent, presetId)
    gutter = id.gutter
    name = id.name
    engine = id.engine
  }

  return (
    <div id={`msg-group-${groupKey}`} data-turn-key={groupKey} className="flex scroll-mt-6 gap-3">
      <div className="w-7 shrink-0 pt-0.5">{gutter}</div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className={cn("text-[13px] font-medium", nameClass)}>{name}</span>
          {engine && (
            <span className="rounded border px-1 py-px text-[11px] text-muted-foreground">
              {engine}
            </span>
          )}
          {time && (
            <span className="text-[11px] tabular-nums text-muted-foreground/60">
              {time}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          {children}
          {workingTail}
        </div>
      </div>
    </div>
  )
}
