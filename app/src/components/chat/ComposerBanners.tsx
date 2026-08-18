// Banners que aparecem ACIMA do composer (auto-resume agendado, gate de
// diretório). Extraídos do ChatPanel: são superfícies fechadas, sem estado do
// painel, e o arquivo de lá é o maior do app (a catraca de tamanho do
// STYLEGUIDE §10 manda dividir, nunca subir o teto).
//
// Os dois falam a MESMA língua de aviso (st-warning em E0, saída em ghost):
// pedem uma decisão sua, sem afirmar que o app já agiu.

import { FolderGit2, Timer, X } from "lucide-react"
import { PENDING_DECISION } from "@/lib/attention"
import { resumeBannerLabel } from "@/lib/autoResume"
import { fmtTime } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Banner (acima do composer) quando um auto-resume está agendado: horário do
 *  próximo reenvio (relógio via fmtTime, não contagem — mesmo formato HH:MM
 *  do "Disponível novamente" do cartão de limite em MessageList, pra não
 *  parecer que os dois relógios se contradizem), quantas tentativas restam, e
 *  as saídas (Cancelar / Retomar agora). Reusa o estilo st-warning do
 *  BlockedDirBanner. Um envio manual (ou o Stop) cancela o agendamento por
 *  fora deste componente. */
export function AutoResumeBanner({
  nextAt,
  tries,
  maxTries,
  reason,
  onCancel,
  onResumeNow,
}: {
  nextAt: number
  tries: number
  maxTries: number
  /** Gatilho REAL do agendamento — o banner dizia sempre "aguardando reset do
   *  limite", inclusive quando ninguém bateu limite nenhum. */
  reason: string
  onCancel: () => void
  onResumeNow: () => void
}) {
  const remaining = Math.max(0, maxTries - tries)
  return (
    <div
      className={cn(
        "mb-2 flex items-center gap-2.5 rounded-lg border px-3 py-2",
        PENDING_DECISION,
      )}
    >
      <Timer className="size-4 shrink-0 animate-pulse text-st-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground">
          {resumeBannerLabel(reason)}, retomando automaticamente às{" "}
          <span className="font-mono tabular-nums">{fmtTime(nextAt)}</span>{" "}
          <span className="text-muted-foreground">
            (tentativa {tries}/{maxTries}
            {remaining > 0 ? `, ${remaining} restante${remaining > 1 ? "s" : ""}` : ""})
          </span>
        </p>
      </div>
      <button
        onClick={onResumeNow}
        className="shrink-0 rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
      >
        Retomar agora
      </button>
      <button
        onClick={onCancel}
        title="Cancelar auto-resume"
        aria-label="Cancelar auto-resume"
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

/** Banner (acima do composer) quando o agent bateu no gate de diretório: um
 *  clique libera a pasta (--add-dir) e reenvia o pedido. Heurístico → dispensável.
 *
 *  `busy` = turno em voo. O botão SOME nesse estado, e não por capricho visual:
 *  o gate de diretório é fixo no spawn, então liberar agora não alcança o
 *  processo que já está rodando. Oferecer o gesto ali era prometer um conserto
 *  que só existiria num turno novo, e no incidente 2026-08-16 o clique virou um
 *  segundo turno completo (mesmo prompt, ~2,4M de tokens a mais). O aviso fica,
 *  porque o bloqueio É real e está acontecendo; o que sai é a promessa. */
export function BlockedDirBanner({
  dir,
  busy = false,
  onAllow,
  onDismiss,
}: {
  dir: string
  busy?: boolean
  onAllow: () => void
  onDismiss: () => void
}) {
  return (
    <div
      className={cn(
        "mb-2 flex items-center gap-2.5 rounded-lg border px-3 py-2",
        PENDING_DECISION,
      )}
    >
      <FolderGit2 className="size-4 shrink-0 text-st-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground">
          O agente parece ter sido barrado ao acessar uma pasta fora do projeto.
        </p>
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={dir}>
          {dir}
        </p>
        {busy && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            O acesso às pastas é definido quando o turno começa, então liberar
            agora não alcança este. Dá pra liberar assim que ele terminar.
          </p>
        )}
      </div>
      {!busy && (
        <button
          onClick={onAllow}
          className="shrink-0 rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
        >
          Liberar e reenviar
        </button>
      )}
      <button
        onClick={onDismiss}
        title="Dispensar"
        aria-label="Dispensar aviso"
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
