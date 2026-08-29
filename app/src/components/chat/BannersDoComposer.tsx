// A PILHA DE AVISOS acima do composer, num lugar só.
//
// Os três banners (auto-resume agendado, motor ausente na máquina, pasta
// barrada) moravam soltos no meio do `ChatPanel`, cada um com o seu bloco de
// condição e o seu punhado de handlers inline. Saíram daqui por causa da
// catraca de tamanho, mas o motivo real é melhor que o número: **eles disputam
// o mesmo espaço**, e quem escreve o quarto precisa ver os três juntos pra
// saber onde ele entra na ordem.
//
// A ordem é deliberada, do mais AGENDADO pro mais IMEDIATO:
//   1. auto-resume — vai acontecer, e você pode cancelar
//   2. motor ausente — vai falhar quando você mandar
//   3. pasta barrada — está falhando agora
//
// Nenhum deles interrompe. Aviso acima do composer é ambiente; decisão que
// precisa parar o app é dialog (§12).

import { toast } from "sonner"

import {
  AutoResumeBanner,
  BlockedDirBanner,
  MotorAusenteBanner,
} from "@/components/chat/ComposerBanners"
import { agentDef } from "@/lib/agents"
import type { AvisoDeMotorAusente } from "@/lib/detect"
import { useChat, type ConvState } from "@/store/chat"

/** O prompt do "retomar agora": o mesmo do agendamento automático, porque
 *  antecipar o gesto não pode mudar o que é pedido ao agente. */
const PROMPT_DE_RETOMADA =
  "O turno anterior parou num limite de uso/espera. Continue a tarefa pendente de onde parou (não repita o que já foi feito)."

export function BannersDoComposer({
  conv,
  activeId,
  temProjeto,
  busy,
  motorAusente,
  onReenviar,
  onLiberarPasta,
}: {
  conv: ConvState | undefined
  activeId: string | null | undefined
  temProjeto: boolean
  /** Turno em voo: alguns GESTOS somem, os AVISOS ficam. */
  busy: boolean
  /** `null` enquanto a detecção não rodou (§5 camada 3). */
  motorAusente: AvisoDeMotorAusente | null
  onReenviar: (prompt: string) => void
  onLiberarPasta: (dir: string) => void
}) {
  return (
    <>
      {conv?.autoResume && (
        <AutoResumeBanner
          nextAt={conv.autoResume.nextAt}
          tries={conv.autoResume.tries}
          maxTries={conv.autoResume.maxTries}
          reason={conv.autoResume.reason}
          onCancel={() => activeId && useChat.getState().cancelAutoResume(activeId)}
          onResumeNow={() => {
            if (!activeId) return
            const c = useChat.getState().byId[activeId]
            if (!c?.autoResume) return
            clearTimeout(c.autoResume.timer)
            // Dispara imediatamente reprogramando pra agora (0ms), em vez de
            // chamar o envio por fora: o agendamento continua sendo o dono do
            // gesto, e o "agora" é só um horário diferente.
            useChat.getState().setAutoResume(activeId, {
              ...c.autoResume,
              nextAt: Date.now(),
            })
            onReenviar(PROMPT_DE_RETOMADA)
          }}
        />
      )}

      {conv && motorAusente && (
        <MotorAusenteBanner
          label={agentDef(conv.agent)?.label ?? conv.agent}
          aviso={motorAusente}
          onCopiar={(cmd) => {
            void navigator.clipboard?.writeText(cmd)
            toast.success("Comando copiado")
          }}
        />
      )}

      {/* `busy` alinha este banner ao vizinho PlanPendingCard: com turno em voo
          o GESTO não é oferecido, porque o --add-dir é fixo no spawn e não vale
          pro processo vivo. O AVISO fica (a pasta está barrando o agente agora,
          isso é fato), e ele volta a ser acionável no fim do turno, sem clique
          perdido no meio. Incidente 2026-08-16. */}
      {conv?.blockedDir && temProjeto && (
        <BlockedDirBanner
          dir={conv.blockedDir}
          busy={busy}
          onAllow={() => onLiberarPasta(conv.blockedDir!)}
          onDismiss={() => activeId && useChat.getState().clearBlockedDir(activeId)}
        />
      )}
    </>
  )
}
