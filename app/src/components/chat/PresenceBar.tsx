// <PresenceBar> — faixa fina de presença no topo da conversa (Especialistas E3,
// S3.3). Mostra os avatares dos PARTICIPANTES (piloto + convidados) e a linha
// "N na conversa · <piloto> pilota". Tudo DERIVADO (conversationPresence): o
// piloto é o preset-executor carimbado, os convidados são as personas que já
// opinaram (itens `advice`). Sem estado persistente novo. Referência visual:
// docs/mocks/marketplace.html (.presence).

import { useMemo } from "react"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import { conversationPresence, useActiveConv } from "@/store/chat"
import { usePresets } from "@/store/presets"
import type { AgentDef } from "@/lib/agentDefs"

export function PresenceBar() {
  const conv = useActiveConv()
  const list = usePresets((s) => s.list)
  const presence = useMemo(
    () => conversationPresence({ presetId: conv.presetId, items: conv.items }),
    [conv.presetId, conv.items],
  )

  // participantes na ordem "piloto primeiro, depois convidados" (dedupe já feito
  // no helper). Cada um vira {id, name, def?} — o def dá a cara real quando a
  // persona ainda existe; senão o avatar cai no id/nome (seed determinística).
  const byId = useMemo(() => {
    const m = new Map<string, AgentDef>()
    for (const p of list) m.set(p.id, p)
    return m
  }, [list])

  const participants: { id: string; name: string; def?: AgentDef }[] = []
  if (presence.pilotId) {
    const def = byId.get(presence.pilotId)
    participants.push({
      id: presence.pilotId,
      name: def?.name ?? conv.presetName ?? "Piloto",
      def,
    })
  }
  for (const g of presence.guests) {
    participants.push({ id: g.id, name: g.name, def: byId.get(g.id) })
  }

  // conversa crua (sem piloto e sem convidados) não desenha barra nenhuma.
  if (participants.length === 0) return null

  const pilotName = presence.pilotId
    ? (byId.get(presence.pilotId)?.name ?? conv.presetName ?? null)
    : null

  return (
    <div className="flex items-center gap-2 border-b border-border/60 bg-background/80 px-4 py-1.5 backdrop-blur">
      <div className="flex items-center">
        {participants.map((p, i) => (
          <span
            key={p.id}
            className="rounded-full ring-2 ring-background"
            style={{ marginLeft: i === 0 ? 0 : -6 }}
            title={
              presence.pilotId === p.id ? `${p.name} · pilota` : `${p.name} · convidado`
            }
          >
            <AgentAvatar
              def={p.def}
              seed={p.def ? undefined : p.id || p.name}
              size={22}
              rounded
            />
          </span>
        ))}
      </div>
      <span className="text-[11px] text-muted-foreground">
        {participants.length} na conversa
        {pilotName && (
          <>
            {" · "}
            <b className="font-medium text-brass">{pilotName}</b> pilota
          </>
        )}
      </span>
    </div>
  )
}
