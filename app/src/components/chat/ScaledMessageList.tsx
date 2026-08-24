import type { ComponentProps } from "react"
import { MessageList } from "@/components/chat/MessageList"
import {
  CONVERSATION_COLUMN_WIDTH,
  conversationColumnStyle,
} from "@/lib/conversationScale"
import { useApp } from "@/store/app"

/** Zoom SÓ no transcript: o texto cresce, o chrome e o composer não.
 *
 *  Duas caixas, e cada uma tem um trabalho:
 *   - a de FORA guarda a coluna física de 760px e NÃO tem zoom;
 *   - a de DENTRO tem o zoom, e `width: 100%` — sem compensar pela escala.
 *
 *  A largura não se compensa porque, em Chrome moderno, porcentagem já resolve
 *  contra o contentor ajustado pelo zoom. Compensar seria compensar duas vezes,
 *  e foi medido quebrando nos dois sentidos (ver `conversationColumnStyle`).
 *  Se alguém voltar a escrever `100 / scale` aqui, o teste da coluna quebra. */
export function ScaledMessageList(props: ComponentProps<typeof MessageList>) {
  // O selector devolve PRIMITIVO estável; objeto novo aqui faria o Zustand
  // notificar a cada leitura e poderia criar loop de render.
  const persistedScale = useApp((s) => s.settings.conversationScale)
  const estilo = conversationColumnStyle(persistedScale)
  return (
    <div
      className="mx-auto w-full min-w-0"
      style={{ maxWidth: `${CONVERSATION_COLUMN_WIDTH}px` }}
    >
      <div
        data-conversation-scale={estilo.zoom}
        style={estilo}
      >
        <MessageList {...props} />
      </div>
    </div>
  )
}
