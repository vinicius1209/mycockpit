// Banners que aparecem ACIMA do composer (auto-resume agendado, gate de
// diretório). Extraídos do ChatPanel: são superfícies fechadas, sem estado do
// painel, e o arquivo de lá é o maior do app (a catraca de tamanho do
// STYLEGUIDE §10 manda dividir, nunca subir o teto).
//
// Gate de diretório e motor ausente pedem decisão em âmbar. Auto-resume é
// estado automático e fica neutro: compartilhar posição não iguala semântica.

import {
  Copy,
  FolderGit2,
  Monitor,
  PackageX,
  Timer,
  X,
} from "lucide-react"
import { PENDING_DECISION } from "@/lib/attention"
import { resumeBannerLabel } from "@/lib/autoResume"
import { fmtTime } from "@/lib/format"
import { controle } from "@/components/ui/controle"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AvisoDeMotorAusente } from "@/lib/detect"
import type { McpPreflightGate } from "@/lib/tooling"

function gateCopy(gate: McpPreflightGate): { title: string; detail: string } {
  const issue = gate.issues[0]
  if (!issue) {
    return {
      title: "Capacidade necessária indisponível",
      detail: "O turno ainda não começou. Revise as integrações deste projeto.",
    }
  }
  if (
    issue.code === "browser-offline" ||
    issue.code === "browser-unavailable" ||
    issue.code === "browser-busy"
  ) {
    return {
      title: "Navegador necessário",
      detail: `${issue.sourceLabel} usa o navegador deste projeto, que não está disponível. O turno ainda não começou.`,
    }
  }
  return {
    title: `${issue.sourceLabel} é necessário`,
    detail: "Esta capacidade não está disponível. O turno ainda não começou.",
  }
}

export function PreflightGateBanner({
  gate,
  onStartBrowser,
  startBrowserSends = false,
  onOpenSettings,
  onContinueWithout,
  onRetryReadonly,
}: {
  gate: McpPreflightGate
  onStartBrowser?: () => void
  startBrowserSends?: boolean
  onOpenSettings: () => void
  onContinueWithout?: () => void
  onRetryReadonly?: () => void
}) {
  const copy = gateCopy(gate)
  const canStartBrowser = gate.allowedRecoveries.some(
    (recovery) => recovery.kind === "start-project-browser",
  )
  const canOmit = gate.allowedRecoveries.some(
    (recovery) => recovery.kind === "omit-for-this-run",
  )
  const canRetryReadonly = gate.allowedRecoveries.some(
    (recovery) => recovery.kind === "retry-readonly",
  )
  return (
    <div className={cn("mb-2 flex items-center gap-2.5 rounded-lg border px-3 py-2", PENDING_DECISION)}>
      <Monitor className="size-4 shrink-0 text-st-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{copy.title}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {copy.detail}
        </p>
      </div>
      {canStartBrowser && onStartBrowser && (
        <Button type="button" size="compacto" onClick={onStartBrowser}>
          {startBrowserSends ? "Ligar e enviar" : "Ligar navegador"}
        </Button>
      )}
      {canRetryReadonly && onRetryReadonly && (
        <Button
          type="button"
          size="compacto"
          variant={canStartBrowser ? "ghost" : "default"}
          onClick={onRetryReadonly}
        >
          Continuar só lendo
        </Button>
      )}
      {canOmit && onContinueWithout && (
        <Button
          type="button"
          size="compacto"
          variant={canStartBrowser ? "ghost" : "default"}
          onClick={onContinueWithout}
        >
          Continuar sem {gate.issues[0]?.sourceLabel ?? "esta capacidade"}
        </Button>
      )}
      <Button
        type="button"
        size="compacto"
        variant={canStartBrowser || canOmit || canRetryReadonly ? "ghost" : "default"}
        onClick={onOpenSettings}
      >
        Revisar vínculo
      </Button>
    </div>
  )
}

/** Faixa (acima do composer) quando um auto-resume está agendado: horário do
 *  próximo reenvio (relógio via fmtTime, não contagem; o incidente mantém
 *  separada a informação de retorno recebida do agente), próxima tentativa e
 *  saídas.
 *  Não é decisão pendente: o sistema prossegue sem gesto humano, portanto a
 *  superfície é neutra e a única tinta fica na ação primária. */
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
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
      <Timer className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground">
          <span className="font-medium">Retoma às </span>
          <span className="font-mono font-medium tabular-nums">{fmtTime(nextAt)}</span>
          <span className="text-muted-foreground">
            {" "}· {resumeBannerLabel(reason)} · próxima tentativa {tries} de {maxTries}
          </span>
        </p>
      </div>
      <Button
        type="button"
        size="compacto"
        onClick={onResumeNow}
      >
        Retomar agora
      </Button>
      <Button
        type="button"
        size="icone-compacto"
        variant="ghost"
        onClick={onCancel}
        title="Cancelar auto-resume"
        aria-label="Cancelar auto-resume"
        className="text-muted-foreground"
      >
        <X className="size-3.5" />
      </Button>
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

/**
 * Banner: o motor escolhido não está NESTA máquina.
 *
 * Ele diz antes, não depois. O Rust já falhava honesto ("não consegui executar
 * o agent X. Ele está instalado e no PATH?"), mas só depois de você escrever o
 * prompt inteiro e mandar. O app tinha as duas metades da resposta desde o boot
 * (a detecção e a receita de instalação) e não as juntava.
 *
 * NÃO bloqueia o envio, e isso é decisão: o probe é um retrato do boot, e o
 * spawn é a verdade. Se você acabou de instalar o motor, um app que se recusa a
 * tentar estaria mentindo com mais confiança que o probe tem. Ele avisa e sai
 * da frente.
 *
 * Sem `onDismiss`: dispensar um aviso que descreve o estado ATUAL da máquina
 * só o traria de volta no próximo render. Quem o dispensa de verdade é instalar
 * o motor, ou escolher outro.
 */
export function MotorAusenteBanner({
  label,
  aviso,
  onCopiar,
}: {
  label: string
  aviso: AvisoDeMotorAusente
  onCopiar?: (comando: string) => void
}) {
  return (
    <div className={cn("mb-2 flex items-center gap-2.5 rounded-lg border px-3 py-2", PENDING_DECISION)}>
      <PackageX className="size-4 shrink-0 text-st-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground">
          O {label} não foi encontrado nesta máquina.
        </p>
        {aviso.comando ? (
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={aviso.comando}>
            {aviso.comando}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Não conheço a receita de instalação dele, então não vou chutar uma.
          </p>
        )}
      </div>
      {aviso.comando && !aviso.ehLink && (
        <button
          type="button"
          onClick={() => onCopiar?.(aviso.comando as string)}
          title="Copiar o comando de instalação"
          className={cn(
            controle("chip"),
            "bg-secondary font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          )}
        >
          <Copy className="size-3" />
          Copiar
        </button>
      )}
      {aviso.comando && aviso.ehLink && (
        <a
          href={aviso.comando}
          target="_blank"
          rel="noreferrer"
          className={cn(
            controle("chip"),
            "bg-secondary font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          )}
        >
          Abrir
        </a>
      )}
    </div>
  )
}
