// GATE humano da missão ("precisa de você"): a fase anterior terminou deixando
// perguntas e o pipeline PAUSOU. Extraído da MissionTimeline sem mudança de
// comportamento (a catraca de tamanho cobrou a divisão do arquivo).

import { GateAnswerForm } from "@/components/mission/GateAnswerForm"
import { MicButton } from "@/components/chat/MicButton"
import { agentCaps, agentDef } from "@/lib/agents"
import type { GateAnswer } from "@/lib/missionTypes"

/** GATE — precisa de você: a missão pausou com as perguntas da fase anterior.
 *  Card RICO inline (a coluna do Trabalho é larga): textarea auto-grow + ditado
 *  (MicButton/stt) + anexos por resposta, via GateAnswerForm compartilhado com
 *  o dock do Escritório. "Continuar" retoma o pipeline injetando as respostas
 *  (texto → diretriz; anexos → runPhase da próxima fase). */
export function GateCard({
  convId,
  questions,
  nextAgent,
  onContinue,
}: {
  convId: string
  questions: string[]
  /** Agent da PRÓXIMA fase — destino dos anexos (aviso visual de capacidade). */
  nextAgent: string | null
  onContinue: (answers: GateAnswer[]) => void
}) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border-[1.5px] border-brass/45 bg-brass/[0.04] shadow-[0_0_0_3px_var(--brass-soft)]">
      <div className="flex items-center gap-2.5 border-b border-brass/20 px-4 py-3">
        <span className="animate-cockpit-pulse size-2 shrink-0 rounded-full bg-brass" />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">
            {questions.length === 1
              ? "O agente tem 1 pergunta"
              : `O agente tem ${questions.length} perguntas`}
          </div>
          <div className="text-[12px] text-muted-foreground">
            A missão está pausada, responda pra continuar (em branco = o
            agente decide)
          </div>
        </div>
      </div>
      <GateAnswerForm
        convId={convId}
        questions={questions}
        caps={agentCaps(nextAgent ?? "")}
        destLabel={
          nextAgent
            ? (agentDef(nextAgent)?.label ?? nextAgent)
            : "o próximo agent"
        }
        submitLabel="Continuar missão →"
        renderMic={(insert) => <MicButton onText={insert} />}
        onSubmit={onContinue}
      />
    </div>
  )
}
