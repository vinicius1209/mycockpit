// O rastro de um parecer levado ao executor (ADR-267): os dois lados se
// apontam, com o mesmo gesto da citação que o fio já tem (↳ autor · hora
// «trecho», que leva à original). Nada de idioma novo para "isto veio dali".

import { CornerDownRight } from "lucide-react"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import { agentDef } from "@/lib/agents"
import { avisar } from "@/lib/avisos"
import { fmtTime } from "@/lib/format"
import { parecerLevado, pedidoQueLevou, trechoDoParecer } from "@/lib/rastroDoParecer"
import { useApp } from "@/store/app"
import { useChat, type ParecerLevado } from "@/store/chat"
import { usePresets } from "@/store/presets"

const LINHA =
  "flex max-w-[520px] items-center gap-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:text-foreground"

function revelar(itemId: string | null, falta: string) {
  const convId = useChat.getState().activeId
  if (convId && itemId) useApp.getState().revealTranscriptItem(convId, itemId)
  else avisar.nota(falta)
}

/** Na sua mensagem: "↳ parecer da Íris · 19:50 «…»", que leva ao parecer. */
export function LinhaDoParecerLevado({ levado }: { levado: ParecerLevado }) {
  const parecer = useChat((s) => {
    const c = s.activeId ? s.byId[s.activeId] : undefined
    return c ? parecerLevado(c.items, levado.itemId) : null
  })
  const persona = usePresets((s) => s.list.find((p) => p.id === levado.personaId))
  const hora = fmtTime(parecer?.ts)
  return (
    <button
      type="button"
      title={`Ir para o parecer de ${levado.personaNome} que esta mensagem levou`}
      onClick={() => revelar(parecer?.id ?? null, "O parecer não está mais nesta conversa.")}
      className={LINHA}
    >
      <CornerDownRight className="size-3 shrink-0" />
      <AgentAvatar def={persona} seed={persona ? undefined : levado.personaId} size={14} rounded />
      <span className="shrink-0 font-mono text-[11px]">
        parecer de {levado.personaNome}
        {hora && ` · ${hora}`}
      </span>
      {parecer && <span className="min-w-0 truncate italic">«{trechoDoParecer(parecer.text)}»</span>}
    </button>
  )
}

/** No parecer: "↪ levado ao Claude Code no seu pedido das 19:52". */
export function LevadoNoPedido({ adviceId }: { adviceId: string }) {
  const pedido = useChat((s) => {
    const c = s.activeId ? s.byId[s.activeId] : undefined
    return c ? pedidoQueLevou(c.items, adviceId) : null
  })
  const executor = useChat((s) => {
    const c = s.activeId ? s.byId[s.activeId] : undefined
    return c ? (agentDef(c.agent)?.shortLabel ?? "executor") : "executor"
  })
  if (!pedido) return null
  const hora = fmtTime(pedido.ts)
  return (
    <button
      type="button"
      title="Ir para o pedido que levou este parecer"
      onClick={() => revelar(pedido.id, "O pedido não está mais nesta conversa.")}
      className={LINHA}
    >
      <CornerDownRight className="size-3 shrink-0" />
      <span>
        levado ao {executor} no seu pedido{hora && ` das ${hora}`}
      </span>
    </button>
  )
}
