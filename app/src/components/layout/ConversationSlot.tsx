import { useSyncExternalStore } from "react"
import { fmtAgo } from "@/lib/format"
import { minuteNow, subscribeMinute } from "@/lib/minuteTick"
import {
  fmtQuando,
  slotEstado,
  type SlotEstado,
} from "@/components/layout/conversationWhen"

/** 36px reservados, sempre: o slot vazio é o que deixa o título truncar contra
 *  uma âncora e o que impede a coluna de dançar quando o estado muda. */
const SLOT = "flex h-4 w-9 shrink-0 items-center justify-end"

const TITULO: Record<SlotEstado, string> = {
  pede: "O turno parou esperando você (permissão ou pergunta)",
  rodando: "Turno rodando",
  falhou: "O turno terminou com erro, abra para ver",
  quando: "",
}

/**
 * O "quando?" da linha de conversa (STYLEGUIDE §6). Ordem fechada
 * `pede > rodando > falhou > tempo relativo`, decidida em `conversationWhen.ts`.
 *
 * Não há timer aqui dentro: o tempo vem do ticker único de minuto e o
 * "rodando" é uma animação de CSS presa à presença do elemento. Isso é o que
 * garante que a esteira PARA quando o turno acaba, inclusive quando ele morre
 * por erro, por cancelamento ou porque o app foi fechado: `rodando` é derivado
 * do store, que nunca persiste turno vivo, e sem `rodando` o elemento
 * simplesmente não existe. Não existe caminho de desmonte pra alguém esquecer.
 */
export function ConversationSlot({
  pede,
  rodando,
  falhou,
  updatedAt,
}: {
  pede: boolean
  rodando: boolean
  falhou: boolean
  updatedAt: number | null | undefined
}) {
  const agora = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow)
  const estado = slotEstado({ pede, rodando, falhou })

  if (estado === "rodando") {
    return (
      <span className={SLOT} title={TITULO.rodando}>
        <span className="conv-wire" aria-label="turno rodando" role="img" />
      </span>
    )
  }
  if (estado === "pede") {
    return (
      <span className={SLOT} title={TITULO.pede}>
        <span
          className="animate-cockpit-pulse size-1.5 rounded-full bg-st-warning"
          aria-label="esperando você"
          role="img"
        />
      </span>
    )
  }
  if (estado === "falhou") {
    // Falha não pulsa: já aconteceu, não está acontecendo (§6, pretérito no
    // marco). O que pulsa é o que ainda pede ou ainda corre.
    return (
      <span className={SLOT} title={TITULO.falhou}>
        <span
          className="size-1.5 rounded-full bg-st-error"
          aria-label="turno terminou com erro"
          role="img"
        />
      </span>
    )
  }

  const rotulo = fmtQuando(updatedAt, agora)
  return (
    <span
      className={SLOT}
      title={
        rotulo && updatedAt
          ? `Última atividade ${fmtAgo(agora - updatedAt)}`
          : undefined
      }
    >
      {rotulo && (
        <span className="font-mono text-[11px] tabular-nums text-faint">
          {rotulo}
        </span>
      )}
    </span>
  )
}
