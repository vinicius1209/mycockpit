// A PILHA DE AVISOS acima do composer, num lugar só.
//
// Os avisos (auto-resume, revezamento, motor ausente, preflight e pasta
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

import { useMemo } from "react"
import { toast } from "sonner"

import {
  AutoResumeBanner,
  BlockedDirBanner,
  MotorAusenteBanner,
  PreflightGateBanner,
} from "@/components/chat/ComposerBanners"
import { ContinuityBanner, type ContinuityMode } from "@/components/chat/ContinuityBanner"
import { agentDef } from "@/lib/agents"
import { estimativaDoHandoff, rotuloDaEstimativa } from "@/lib/handoff"
import { resumeBannerLabel } from "@/lib/autoResume"
import { deriveComposerContinuity } from "@/lib/composerContinuity"
import type { AvisoDeMotorAusente } from "@/lib/detect"
import { fmtTime } from "@/lib/format"
import { latestCompletedTurnId } from "@/lib/mainTabs"
import { checkAgentQuota, eligibleHandoffTargets } from "@/lib/quotaExhausted"
import { useApp } from "@/store/app"
import { useChat, type ConvState } from "@/store/chat"
import { useUsage } from "@/store/usage"

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
  onContinueNow,
  onReenviar,
  onLiberarPasta,
  onLigarNavegador,
  ligarNavegadorEnvia,
  onRevisarMcp,
  onContinuarSemMcp,
  onContinuarSoLendo,
}: {
  conv: ConvState | undefined
  activeId: string | null | undefined
  temProjeto: boolean
  /** Turno em voo: alguns GESTOS somem, os AVISOS ficam. */
  busy: boolean
  /** `null` enquanto a detecção não rodou (§5 camada 3). */
  motorAusente: AvisoDeMotorAusente | null
  /** Retoma imediatamente o pedido pendente em outro agente. */
  onContinueNow: (agent: string) => void
  onReenviar: (prompt: string) => void
  onLiberarPasta: (dir: string) => void
  onLigarNavegador: () => void
  ligarNavegadorEnvia?: boolean
  onRevisarMcp: () => void
  onContinuarSemMcp?: () => void
  onContinuarSoLendo?: () => void
}) {
  const limitedAgents = useApp((s) => s.limitedAgents)
  const detectados = useApp((s) => s.settings.detected)
  const usageByAgent = useUsage((s) => s.byAgent)
  // Turno concluído desmente leitura velha de "100%" (ver checkAgentQuota).
  const lastSuccessByAgent = useUsage((s) => s.lastSuccessAt)
  const quota = conv
    ? checkAgentQuota(
        conv.agent,
        limitedAgents,
        usageByAgent[conv.agent],
        undefined,
        lastSuccessByAgent[conv.agent],
      )
    : { exhausted: false, resetHint: null }
  const continuity = conv
    ? deriveComposerContinuity(conv.items, busy, quota.exhausted)
    : null
  const continuityMode: ContinuityMode | null = continuity?.mode ?? null
  const alternatives =
    conv && continuityMode && !conv.stagedAgent
      ? eligibleHandoffTargets({
          currentAgent: conv.agent,
          detected: detectados ?? {},
          limitedAgents,
          byAgentSnapshots: usageByAgent,
          lastSuccessByAgent,
          attachments:
            continuity?.mode === "continue-now"
              ? continuity.pending.attachments
              : [],
        })
      : []
  const sourceLabel = conv ? (agentDef(conv.agent)?.label ?? conv.agent) : ""
  // Revezamento R2: quanto a sessão nova leva do fio, pela montagem real do
  // envelope. Só recalcula quando muda o destino ou o fio.
  const stagedAgent = conv?.stagedAgent ?? null
  const itens = conv?.items
  const estimativa = useMemo(
    () => (stagedAgent && itens ? rotuloDaEstimativa(estimativaDoHandoff(itens, stagedAgent)) : undefined),
    [stagedAgent, itens],
  )
  // Turno concluído mais recente: o ponto de corte do ramo.
  const ramoAPartirDe = conv && !busy ? latestCompletedTurnId(conv.items) : null
  const targetLabel = conv?.stagedAgent
    ? (agentDef(conv.stagedAgent)?.label ?? conv.stagedAgent)
    : ""

  return (
    <>
      {conv?.autoResume && continuityMode !== "continue-now" && (
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

      {conv?.stagedAgent && activeId ? (
        <ContinuityBanner
          state="staged"
          sourceLabel={sourceLabel}
          targetLabel={targetLabel}
          estimativa={estimativa}
          busy={busy}
          onUndo={() => useChat.getState().stageAgent(activeId, null)}
          onRamo={
            // Só há ramo a partir de um turno CONCLUÍDO: é o mesmo alvo do
            // "Bifurcar do último turno" (revezamento R3).
            ramoAPartirDe && conv.stagedAgent
              ? () => {
                  void useChat
                    .getState()
                    .forkConversationAt(activeId, ramoAPartirDe, stagedAgent ?? undefined)
                }
              : undefined
          }
        />
      ) : conv && activeId && continuityMode && continuity ? (
        <ContinuityBanner
          key={`${activeId}:${continuity.terminalId}:${continuityMode}`}
          state="choose"
          mode={continuityMode}
          sourceLabel={sourceLabel}
          resetHint={quota.resetHint}
          alternatives={alternatives}
          scheduledResume={
            continuityMode === "continue-now" && conv.autoResume
              ? {
                  detail: `Retomada no ${sourceLabel} às ${fmtTime(conv.autoResume.nextAt)} · ${resumeBannerLabel(conv.autoResume.reason)} · tentativa ${conv.autoResume.tries} de ${conv.autoResume.maxTries}`,
                  onCancel: () =>
                    useChat.getState().cancelAutoResume(activeId),
                }
              : undefined
          }
          onSelect={
            continuityMode === "continue-now"
              ? onContinueNow
              : (agent) => useChat.getState().stageAgent(activeId, agent)
          }
        />
      ) : null}

      {conv?.preflightGate && (
        <PreflightGateBanner
          gate={conv.preflightGate.gate}
          onStartBrowser={onLigarNavegador}
          startBrowserSends={ligarNavegadorEnvia}
          onOpenSettings={onRevisarMcp}
          onContinueWithout={onContinuarSemMcp}
          onRetryReadonly={onContinuarSoLendo}
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
