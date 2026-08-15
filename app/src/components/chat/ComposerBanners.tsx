// Banners que aparecem ACIMA do composer (auto-resume agendado, gate de
// diretório). Extraídos do ChatPanel: são superfícies fechadas, sem estado do
// painel, e o arquivo de lá é o maior do app (a catraca de tamanho do
// STYLEGUIDE §10 manda dividir, nunca subir o teto).
//
// Os dois falam a MESMA língua de aviso (st-warning em E0, saída em ghost):
// pedem uma decisão sua, sem afirmar que o app já agiu.

import { useEffect, useState } from "react"
import { FolderGit2, Timer, X } from "lucide-react"
import { resumeBannerLabel } from "@/lib/autoResume"

/** Banner (acima do composer) quando um auto-resume está agendado: countdown ao
 *  vivo até o próximo reenvio, quantas tentativas restam, e as saídas (Cancelar /
 *  Retomar agora). Reusa o estilo st-warning do BlockedDirBanner. Um envio manual
 *  (ou o Stop) cancela o agendamento por fora deste componente. */
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
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, Math.ceil((nextAt - now) / 1000))
  const remaining = Math.max(0, maxTries - tries)
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-st-warning/40 bg-st-warning/10 px-3 py-2">
      <Timer className="size-4 shrink-0 animate-pulse text-st-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground">
          {resumeBannerLabel(reason)}, retomando automaticamente em{" "}
          <span className="font-mono tabular-nums">{secs}s</span>{" "}
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
 *  clique libera a pasta (--add-dir) e reenvia o pedido. Heurístico → dispensável. */
export function BlockedDirBanner({
  dir,
  onAllow,
  onDismiss,
}: {
  dir: string
  onAllow: () => void
  onDismiss: () => void
}) {
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-st-warning/40 bg-st-warning/10 px-3 py-2">
      <FolderGit2 className="size-4 shrink-0 text-st-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground">
          O agente parece ter sido barrado ao acessar uma pasta fora do projeto.
        </p>
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={dir}>
          {dir}
        </p>
      </div>
      <button
        onClick={onAllow}
        className="shrink-0 rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
      >
        Liberar e reenviar
      </button>
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
