// O card de Pull Request no rodapé da aba Alterações (D1 do docs/pull-requests-git-prd.md).
//
// Substitui o botão estático por um card contextual:
// - Sem PR: mantém o botão "Abrir pull request";
// - PR Aberto: status de CI, revisões e link rápido pro GitHub;
// - PR Mergeado: aviso roxo com gesto de um clique para voltar para a base.

import { useState } from "react"
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  RotateCcw,
  XCircle,
} from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { copyText } from "@/lib/clipboard"
import { avisar, mensagemDe } from "@/lib/avisos"
import { controle } from "@/components/ui/controle"
import { haTurnoNaPasta, avisarGravacao } from "@/lib/sinaisDoDisco"
import { trocarBranch } from "@/lib/gitSync"
import type { PrStatusInfo } from "@/lib/github"
import { cn } from "@/lib/utils"

export function CartaoDePr({
  cwd,
  branch: _branch,
  pr,
  prUrl,
  onAbrirComposer,
  onLimparPrUrl,
  onBranchTrocada,
}: {
  cwd: string
  branch?: string | null
  pr: PrStatusInfo | null
  prUrl: string | null
  onAbrirComposer: () => void
  onLimparPrUrl: () => void
  onBranchTrocada: () => void
}) {
  const [trocando, setTrocando] = useState(false)

  async function handleVoltarParaBase(base: string) {
    if (haTurnoNaPasta(cwd)) {
      avisar.erro("Há um turno rodando nesta pasta.", {
        detalhe: "Trocar de branch mudaria os arquivos debaixo do agente. Espere o turno terminar.",
      })
      return
    }
    setTrocando(true)
    try {
      await trocarBranch(cwd, base, { criar: false, guardar: false })
      avisar.feito(`Na branch ${base}`)
      avisarGravacao(cwd)
      onBranchTrocada()
    } catch (e) {
      avisar.erro("Não consegui trocar para a branch base.", { detalhe: mensagemDe(e) })
    } finally {
      setTrocando(false)
    }
  }

  async function handleCopiarLink(url: string) {
    try {
      await copyText(url)
      avisar.feito("Link do PR copiado")
    } catch {
      avisar.erro("Não foi possível copiar o link")
    }
  }

  // Estado 1: PR recém-aberto nesta sessão pela janela de diálogo (sem status remoto completo)
  if (!pr && prUrl) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-t border-border/40 px-3 py-2 text-[12px]">
        <button
          type="button"
          onClick={() => void openUrl(prUrl)}
          className={cn(controle("chip"), "text-git-open hover:bg-accent")}
        >
          <GitPullRequest className="size-3.5" /> PR aberto, abrir no GitHub
        </button>
        <button
          type="button"
          onClick={onLimparPrUrl}
          aria-label="Fechar aviso do pull request"
          className={cn(
            controle("chip", { quadrado: true }),
            "ml-auto text-muted-foreground hover:text-foreground",
          )}
          title="Fechar aviso"
        >
          <Check className="size-3.5" />
        </button>
      </div>
    )
  }

  // Estado 2: Sem PR conhecido na branch atual
  if (!pr) {
    return (
      <div className="flex shrink-0 items-center justify-end border-t border-border/40 px-3 py-2">
        <button
          type="button"
          onClick={onAbrirComposer}
          className={cn(controle("chip"), "border text-foreground hover:bg-accent")}
        >
          <GitPullRequest className="size-3" /> Abrir pull request
        </button>
      </div>
    )
  }

  // Estado 3: PR MERGEADO
  if (pr.state === "MERGED") {
    return (
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-git-merged/30 bg-git-merged/5 p-3 text-[12px]">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium text-git-merged bg-git-merged/15">
            <GitMerge className="size-3" /> PR #{pr.number} · Mergeado
          </span>
          <button
            type="button"
            onClick={() => void openUrl(pr.url)}
            title="Abrir no navegador"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <span>Ver no GitHub</span>
            <ExternalLink className="size-3" />
          </button>
        </div>

        <p className="line-clamp-1 font-medium text-foreground text-[12px]" title={pr.title}>
          {pr.title}
        </p>

        <p className="text-[11px] text-muted-foreground">
          Esta branch foi incorporada em <span className="font-mono text-foreground">{pr.baseRefName}</span>.
        </p>

        <div className="mt-1 flex items-center justify-end gap-2 pt-1 border-t border-git-merged/20">
          <button
            type="button"
            disabled={trocando || !pr.baseRefName}
            onClick={() => void handleVoltarParaBase(pr.baseRefName)}
            className={cn(
              controle("chip"),
              "bg-git-merged/15 text-git-merged border border-git-merged/30 hover:bg-git-merged/25",
            )}
          >
            <RotateCcw className={cn("size-3", trocando && "animate-spin")} />
            Voltar para {pr.baseRefName}
          </button>
        </div>
      </div>
    )
  }

  // Estado 4: PR ABERTO (ou Rascunho)
  const temFalha = pr.checksFailing > 0
  const temSucesso = pr.checksPassing > 0 && !temFalha

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-1.5 border-t p-3 text-[12px]",
        temFalha
          ? "border-st-error/30 bg-st-error/5"
          : "border-border/40 bg-card",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium",
            pr.isDraft
              ? "bg-muted text-muted-foreground"
              : temFalha
                ? "bg-st-error/15 text-st-error"
                : "bg-git-open/15 text-git-open",
          )}
        >
          <GitPullRequest className="size-3" />
          PR #{pr.number} · {pr.isDraft ? "Rascunho" : "Aberto"}
        </span>

        <span className="text-[11px] text-muted-foreground font-mono">
          → {pr.baseRefName}
        </span>
      </div>

      <p className="line-clamp-1 font-medium text-foreground text-[12px]" title={pr.title}>
        {pr.title}
      </p>

      {/* Linha de status de CI e Revisão */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {temFalha && (
          <span className="flex items-center gap-1 text-st-error">
            <XCircle className="size-3" />
            {pr.checksFailing} check{pr.checksFailing > 1 ? "s" : ""} falhou
          </span>
        )}
        {temSucesso && (
          <span className="flex items-center gap-1 text-git-open">
            <CheckCircle2 className="size-3" />
            {pr.checksPassing} check{pr.checksPassing > 1 ? "s" : ""} ok
          </span>
        )}
        {pr.checksPending > 0 && (
          <span>{pr.checksPending} pendente{pr.checksPending > 1 ? "s" : ""}</span>
        )}
        {pr.reviewDecision === "APPROVED" && (
          <span className="text-git-open font-medium">· Aprovado</span>
        )}
        {pr.reviewDecision === "CHANGES_REQUESTED" && (
          <span className="text-st-error font-medium">· Alterações pedidas</span>
        )}
      </div>

      {/* Ações */}
      <div className="mt-1 flex items-center justify-between gap-2 pt-1 border-t border-border/40">
        <button
          type="button"
          onClick={() => void handleCopiarLink(pr.url)}
          title="Copiar URL do PR"
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Copy className="size-3" />
          <span>Copiar link</span>
        </button>

        <button
          type="button"
          onClick={() => void openUrl(pr.url)}
          className={cn(controle("chip"), "border text-foreground hover:bg-accent")}
        >
          <ExternalLink className="size-3" />
          <span>Abrir no GitHub</span>
        </button>
      </div>
    </div>
  )
}
