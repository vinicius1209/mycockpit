// <PresenceBar> — faixa fina de presença no topo da conversa (Especialistas E3,
// S3.3). Mostra os avatares dos PARTICIPANTES (piloto + convidados) e a linha
// "N na conversa · <piloto> pilota". Tudo DERIVADO (conversationPresence): o
// piloto é o preset-executor carimbado, os convidados são as personas que já
// opinaram (itens `advice`). Sem estado persistente novo. Referência visual:
// docs/mocks/marketplace.html (.presence).
//
// Também carrega o CUSTO da sessão à direita (derivado de sessionCost) — antes
// vivia colado no composer, no fim do fio. É sobre o EXECUTOR, então a faixa
// existe mesmo sem especialista (só custo à direita, sem avatares à esquerda).

import { useMemo } from "react"
import { toast } from "sonner"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import {
  conversationPresence,
  sessionCost,
  useActiveConv,
  useChat,
} from "@/store/chat"
import { usePresets } from "@/store/presets"
import { confirm } from "@/lib/confirm"
import { fmtCost } from "@/lib/format"
import type { AgentDef } from "@/lib/agentDefs"

export function PresenceBar() {
  const conv = useActiveConv()
  const activeId = useChat((s) => s.activeId)
  const returnWheel = useChat((s) => s.returnWheel)
  const removeAdvice = useChat((s) => s.removeAdvice)
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

  // Custo da sessão vive no TOPO agora (consciência de gasto perto de quem
  // pilota), não colado no composer. Derivado dos items (fonte única sessionCost);
  // a UI só o mostra com ≥2 turnos e gasto real — é sobre o EXECUTOR, então
  // aparece mesmo sem especialista na conversa.
  const cost = useMemo(() => sessionCost(conv.items), [conv.items])
  const showCost = cost.turns >= 2 && cost.total > 0

  // conversa crua (sem piloto, sem convidados) E sem custo a mostrar não desenha
  // barra nenhuma. Com um dos dois, a faixa existe (presença à esquerda quando há,
  // custo à direita quando há).
  if (participants.length === 0 && !showCost) return null

  const pilotName = presence.pilotId
    ? (byId.get(presence.pilotId)?.name ?? conv.presetName ?? null)
    : null

  // Retomar o volante: gesto de consequência (troca quem pilota o próximo turno)
  // → confirma antes. Fail-soft: sem conversa ativa ou sem piloto, não faz nada.
  async function onReturnWheel() {
    if (!activeId || !presence.pilotId) return
    const ok = await confirm({
      title: "Retomar o volante?",
      description: `Os próximos turnos voltam ao executor base (o code agent), sem ${pilotName ?? "o piloto"} pilotando.`,
      confirmLabel: "Retomar",
    })
    if (!ok) return
    if (await returnWheel(activeId)) toast("Volante retomado")
  }

  // Tirar um convidado da conversa: remove os pareceres dele do fio (a presença é
  // derivada, some da barra). Confirma antes (gesto destrutivo).
  async function onRemoveGuest(id: string, name: string) {
    if (!activeId) return
    const ok = await confirm({
      title: `Tirar ${name} da conversa?`,
      description: "Os pareceres dele saem do fio.",
      confirmLabel: "Tirar",
    })
    if (!ok) return
    removeAdvice(activeId, id)
    toast(`${name} saiu da conversa`)
  }

  return (
    <div className="group flex items-center gap-2 border-b border-border/60 bg-background/80 px-4 py-1.5 backdrop-blur">
      {participants.length > 0 && (
        <>
          <div className="flex items-center">
            {participants.map((p, i) => {
              const isPilot = presence.pilotId === p.id
              return (
                <span
                  key={p.id}
                  className="group/participant relative rounded-full ring-2 ring-background"
                  style={{ marginLeft: i === 0 ? 0 : -6 }}
                  title={isPilot ? `${p.name} · pilota` : `${p.name} · convidado`}
                >
                  <AgentAvatar
                    def={p.def}
                    seed={p.def ? undefined : p.id || p.name}
                    size={22}
                    rounded
                  />
                  {!isPilot && (
                    <button
                      type="button"
                      aria-label={`Tirar ${p.name} da conversa`}
                      title="Tirar da conversa"
                      onClick={() => void onRemoveGuest(p.id, p.name)}
                      className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background text-[11px] leading-none text-muted-foreground opacity-0 ring-1 ring-border transition hover:text-foreground group-hover/participant:opacity-100"
                    >
                      ✕
                    </button>
                  )}
                </span>
              )
            })}
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
          {presence.pilotId && (
            <button
              type="button"
              onClick={() => void onReturnWheel()}
              title="Voltar ao executor base (o code agent)"
              className="text-[11px] text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
            >
              ↩ Retomar volante
            </button>
          )}
        </>
      )}
      {showCost && (
        <span
          className="ml-auto flex items-center gap-1.5"
          title="Custo acumulado desta sessão (soma dos turnos)"
        >
          <span className="label-mono">Sessão</span>
          <span className="font-mono text-[11px] font-semibold tabular-nums text-brass">
            {fmtCost(cost.total, cost.estimated ? "estimated" : "reported")}
          </span>
        </span>
      )}
    </div>
  )
}
