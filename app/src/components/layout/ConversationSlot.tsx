import { useSyncExternalStore } from "react"
import { fmtAgo } from "@/lib/format"
import { useEpocaDaJanela } from "@/lib/janelaViva"
import { minuteNow, subscribeMinute } from "@/lib/minuteTick"
import { useTrocou } from "@/lib/nascimento"
import { cn } from "@/lib/utils"
import { CometaVivo } from "@/components/ui/cometa-vivo"
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
 * "rodando" é o `CometaVivo`, presa à presença do elemento (o relógio único
 * só pinta quem existe). Isso é o que garante que ela PARA quando o turno acaba, inclusive quando ele morre
 * por erro, por cancelamento ou porque o app foi fechado: `rodando` é derivado
 * do store, que nunca persiste turno vivo, e sem `rodando` o elemento
 * simplesmente não existe. Não existe caminho de desmonte pra alguém esquecer.
 */
export function ConversationSlot({
  pede,
  rodando,
  falhou,
  updatedAt,
  cor,
  quem = null,
  motivoRodando = null,
}: {
  pede: boolean
  rodando: boolean
  falhou: boolean
  updatedAt: number | null | undefined
  /** Cor do "rodando": a da conversa, senão a do projeto (ADR-256). Sem
   *  nenhuma, o azul de rodando. */
  cor?: string | null
  /** Quando é um especialista dando parecer, o nome dele (ADR-267). */
  quem?: string | null
  /** Quando há um motivo específico para estar rodando (especialista ou bastidores). */
  motivoRodando?: string | null
}) {
  const agora = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow)
  // Época da janela: muda SÓ quando a janela volta a ser vista. Ver
  // `lib/janelaViva.ts` pro que foi descartado com medida antes de chegar aqui.
  const epoca = useEpocaDaJanela()
  const estado = slotEstado({ pede, rodando, falhou })
  // Montar a linha não anima; TROCAR de estado sim, e a `key` no estado remonta
  // o slot para a entrada tocar a cada troca (ADR-179). O relógio de minuto não
  // muda o estado, então "9m" virando "10m" não re-entra.
  const trocou = useTrocou(estado)
  const slot = cn(SLOT, trocou && "fio-nasce")

  if (estado === "rodando") {
    const titulo = motivoRodando ?? (quem ? `${quem} está dando um parecer` : TITULO.rodando)
    const rotulo = motivoRodando ?? (quem ? `${quem} dando parecer` : "turno rodando")
    return (
      <span key={estado} className={slot} title={titulo}>
        {/* O cometa (ADR-259): o giro vem do relógio único, não de
            `@keyframes`, então a oclusão da janela no macOS não tem animação
            para congelar (era o "trava e só volta ao clicar", ADR-256). */}
        <CometaVivo cor={cor ?? "var(--st-running)"} rotulo={rotulo} />
      </span>
    )
  }
  if (estado === "pede") {
    return (
      <span key={estado} className={slot} title={TITULO.pede}>
        <span
          key={epoca}
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
      <span key={estado} className={slot} title={TITULO.falhou}>
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
      key={estado}
      className={slot}
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
