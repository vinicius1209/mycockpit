// O CONSELHEIRO no fio (Especialistas E1): a linha de chegada enquanto ele lê,
// e o cartão do parecer quando ele responde.
//
// Saiu do MessageList.tsx, que estava exatamente no teto da catraca. O recorte
// é fechado — as duas peças só existem uma pela outra (a linha some quando o
// cartão chega) e nada mais no fio depende delas.

import { CornerDownRight, MessageSquareQuote } from "lucide-react"
import { toast } from "sonner"
import { Markdown } from "@/components/common/Markdown"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import { buildAdviceHandoffBlock } from "@/lib/advisor"
import { shortDigest } from "@/lib/presets"
import { usePresets } from "@/store/presets"
import { useChat, type ChatItem } from "@/store/chat"

/** Linha de CHEGADA do conselheiro (Especialistas E1): enquanto o parecer não
 *  resolve (`conv.advising` setado), a persona "entra no fio" estilo Slack —
 *  avatar + nome + "está lendo o contexto…" com dots pulsando; some quando o
 *  item `advice` chega. Fail-soft: sem persona resolvida, avatar genérico. */
export function AdviceArrivalRow({
  advising,
}: {
  advising: { id: string; name: string }
}) {
  const persona = usePresets((s) =>
    s.list.find((p) => p.id === advising.id || p.name === advising.name),
  )
  return (
    <div className="flex gap-3 animate-cockpit-rise">
      <div className="w-7 shrink-0 pt-0.5">
        <AgentAvatar
          def={persona}
          seed={persona ? undefined : advising.id || advising.name}
          size={28}
          rounded
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-brass">
            {persona?.name ?? advising.name}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <span>está lendo o contexto</span>
          <span className="flex items-center gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="animate-cockpit-pulse size-1.5 rounded-full bg-brass/70"
                style={{ animationDelay: `${i * 0.18}s` }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Parecer de um CONSELHEIRO (Especialistas E1): item atribuído à persona,
 *  visualmente distinto de uma ação do executor (borda brass, cabeçalho com o
 *  nome + selo "parecer · só leitura"). Carimba persona@version + digest curto
 *  (auditoria/drift). Ações: "Trazer pro Executor" (injeta o parecer no próximo
 *  turno) e "Dispensar" (remove o item). Sem volante/piloto (isso é Sprint 3). */
export function AdviceCard({ item }: { item: Extract<ChatItem, { kind: "advice" }> }) {
  // Avatar com a identidade REAL da persona (estilo/seed do arquivo) quando ela
  // ainda existe na lista; senão, a seed cai no id/nome carimbados no parecer
  // (a persona pode ter sido apagada — o parecer histórico não perde a cara).
  const persona = usePresets((s) =>
    s.list.find((p) => p.id === item.personaId),
  )
  // S3.2 — "passar o volante": só oferecido quando a persona ainda existe, NÃO
  // é já quem pilota (um piloto por vez) e não há turno em voo (senão passWheel
  // no-opa e o gesto ficaria sem efeito). Gesto humano e explícito.
  const isPilot = useChat((s) =>
    s.activeId ? s.byId[s.activeId]?.presetId === item.personaId : false,
  )
  const turnBusy = useChat((s) => {
    const c = s.activeId ? s.byId[s.activeId] : undefined
    return !!c?.running || !!c?.finalizing
  })
  const canPassWheel = !!persona && !isPilot && !turnBusy
  return (
    <div className="group/msg rounded-lg border border-brass/40 bg-brass/[0.05] px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {/* avatar + nome da persona vivem no cabeçalho do grupo (gutter Slack);
            aqui fica só a natureza do bloco (selo) + o carimbo de versão. */}
        <MessageSquareQuote className="size-4 shrink-0 text-brass" />
        <span className="rounded-full border border-brass/40 bg-brass/10 px-2 py-0.5 text-[11px] font-medium text-brass">
          parecer · só leitura
        </span>
        <span
          className="ml-auto font-mono text-[11px] text-muted-foreground/70"
          title="Persona e versão que opinaram (carimbo de auditoria/drift)"
        >
          v{item.personaVersion} · {shortDigest(item.digest)}
        </span>
      </div>
      <div data-selectable className="text-[14px]">
        <Markdown text={item.text} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        {canPassWheel && (
          <button
            onClick={() => {
              const convId = useChat.getState().activeId
              if (!convId) return
              // só anuncia quando a troca efetivou (passWheel no-opa em turno em
              // voo / já piloto) — sem gesto sem efeito passando por concluído.
              void useChat
                .getState()
                .passWheel(convId, item.personaId, persona!.name)
                .then((ok) => {
                  if (ok)
                    toast(
                      `${item.personaName} vai pilotar o próximo turno (a doutrina viaja no envio).`,
                    )
                })
            }}
            title="Trocar o piloto: a próxima ação da conversa passa a ser desta persona"
            className="mr-auto inline-flex items-center gap-1.5 rounded-md border border-brass/40 px-2.5 py-1 text-[12px] text-brass transition-colors hover:bg-brass/10"
          >
            <CornerDownRight className="size-3.5" /> Passar o volante
          </button>
        )}
        <button
          onClick={() => {
            const convId = useChat.getState().activeId
            if (!convId) return
            useChat.getState().removeThreadItem(convId, item.id)
          }}
          className="rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
        >
          Dispensar
        </button>
        <button
          onClick={() => {
            const convId = useChat.getState().activeId
            if (!convId) return
            useChat
              .getState()
              .bringAdviceToExecutor(convId, buildAdviceHandoffBlock(item))
            toast(
              `Parecer de ${item.personaName} vai como contexto no próximo turno.`,
            )
          }}
          className="rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
        >
          Trazer pro Executor
        </button>
      </div>
    </div>
  )
}
