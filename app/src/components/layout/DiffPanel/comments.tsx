// Comentário inline no diff (Alterações): comenta uma linha ESPECÍFICA do
// diff, em vez de reagir à entrega inteira ("Pedir correção"/fixPrefill, que
// cita só a 1ª linha). Extraído de DiffPanel.tsx pelo mesmo motivo de
// store/chat/clone.ts — arquivo-mãe no teto, e "linha do diff + comentário"
// é um recorte de responsabilidade fechado, não um pedaço partido pra caber.
//
// Gate humano, mesmo espírito do "Pedir correção": os comentários se acumulam
// e só viram texto no composer quando o usuário clica "Enviar ao agente",
// nunca enviados sozinhos (composeDiffComments monta, não envia). Moram em
// `store/comentariosDoDiff.ts` (ADR-251), não no painel: trocar de aba não os
// apaga.

import { useState } from "react"
import { Check, Copy, MessageSquarePlus, X } from "lucide-react"
import type { DiffLine } from "@/lib/git"
import { copyText } from "@/lib/clipboard"
import {
  diffLineKey,
  sideOfLine,
  type DiffSide,
} from "@/lib/deliveryDiff"
import { highlightDiffLine } from "@/lib/syntaxHighlight"
import { comentariosDa, useComentariosDoDiff } from "@/store/comentariosDoDiff"
import { cn } from "@/lib/utils"

/** Âncora da linha: chave de identidade + o lado/número que ela representa.
 *  Tudo que a UI precisa saber pra achar (ou não achar) um comentário. */
export function anchorOf(
  path: string,
  ln: DiffLine,
): { key: string; side: DiffSide; lineNo: number | null } {
  const side = sideOfLine(ln.type)
  const lineNo = side === "old" ? ln.oldNo : ln.newNo
  return { key: diffLineKey(path, side, lineNo), side, lineNo }
}

/** Estado dos comentários soltos no diff: um slot por linha (não uma lista —
 *  comentar de novo na mesma linha EDITA o existente, não empilha). Os salvos
 *  moram no store, sob `chave` (`chaveDosComentarios`); a linha em edição e o
 *  texto ainda não salvo são da tela. */
export function useDiffComments(chave: string) {
  const comments = useComentariosDoDiff((s) => comentariosDa(s, chave))
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [draftNote, setDraftNote] = useState("")

  function open(key: string, existingNote?: string) {
    setActiveKey(key)
    setDraftNote(existingNote ?? "")
  }
  function cancel() {
    setActiveKey(null)
    setDraftNote("")
  }
  function submit(path: string, ln: DiffLine) {
    const note = draftNote.trim()
    const { key, side, lineNo } = anchorOf(path, ln)
    if (note) {
      useComentariosDoDiff.getState().guardar(chave, { id: key, path, side, lineNo, codeText: ln.text, note })
    }
    cancel()
  }
  function remove(key: string) {
    useComentariosDoDiff.getState().tirar(chave, key)
  }
  function clear() {
    useComentariosDoDiff.getState().limpar(chave)
  }

  return { comments, activeKey, draftNote, setDraftNote, open, cancel, submit, remove, clear }
}

export type DiffCommentApi = ReturnType<typeof useDiffComments>

/** Uma linha do hunk (números + sinal + texto) com o gatilho de comentário no
 *  fim da linha (aparece no hover) e, abaixo, o badge salvo OU a textarea
 *  ativa — as 3 fases do mesmo slot, nunca duas ao mesmo tempo. */
export function DiffLineRow({
  ln,
  path,
  lang,
  api,
}: {
  ln: DiffLine
  path: string
  lang?: string | null
  api: DiffCommentApi
}) {
  const { key, lineNo } = anchorOf(path, ln)
  const candidato = api.comments[key]
  // Casamento por CONTEÚDO, não só por chave: a linha pode manter o número e
  // ter mudado de texto. Sem isso o badge desenharia sobre outra linha — que
  // era o bug. Quem não casa vira órfão na tira do rodapé (ver DiffPanel).
  const existing = candidato?.codeText === ln.text ? candidato : undefined
  const active = api.activeKey === key
  const html = highlightDiffLine(ln.text, lang ?? null)

  return (
    <div>
      <div
        className={cn(
          "group flex items-center whitespace-pre",
          ln.type === "add" && "bg-st-success/[0.10]",
          ln.type === "del" && "bg-st-error/[0.10]",
        )}
      >
        <span className="w-9 shrink-0 border-r border-border/40 px-1 text-right text-muted-foreground/35 tabular-nums select-none">
          {ln.oldNo ?? ""}
        </span>
        <span className="w-9 shrink-0 border-r border-border/40 px-1 text-right text-muted-foreground/35 tabular-nums select-none">
          {ln.newNo ?? ""}
        </span>
        <span
          className={cn(
            "w-4 shrink-0 text-center select-none",
            ln.type === "add"
              ? "text-st-success"
              : ln.type === "del"
                ? "text-st-error"
                : "text-transparent",
          )}
        >
          {ln.type === "add" ? "+" : ln.type === "del" ? "−" : " "}
        </span>
        <span
          data-selectable
          className="flex-1 pr-1 pl-1 text-foreground/85 select-text hljs"
          dangerouslySetInnerHTML={{ __html: html || " " }}
        />
        <button
          type="button"
          onClick={() => void copyText(ln.text, "Linha copiada")}
          title="Copiar linha"
          className="mr-0.5 shrink-0 select-none rounded p-0.5 text-transparent transition-colors group-hover:text-muted-foreground/60 hover:!text-foreground focus-visible:text-muted-foreground/60"
        >
          <Copy className="size-3" />
          <span className="sr-only">Copiar linha</span>
        </button>
        <button
          type="button"
          onClick={() => api.open(key, existing?.note)}
          title="Comentar esta linha"
          className="mr-1 shrink-0 select-none rounded p-0.5 text-transparent transition-colors group-hover:text-muted-foreground/60 hover:!text-foreground focus-visible:text-muted-foreground/60"
        >
          <MessageSquarePlus className="size-3" />
          <span className="sr-only">
            Comentar {path}:{lineNo ?? ""}
          </span>
        </button>
      </div>
      {existing && !active && (
        <div className="flex items-start gap-2 border-l-2 border-brass/40 bg-brass/[0.05] py-1 pr-2 pl-3 text-[12px]">
          <p className="min-w-0 flex-1 text-foreground/85">{existing.note}</p>
          <button
            type="button"
            onClick={() => api.remove(key)}
            title="Remover comentário"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      {active && (
        <div className="flex items-start gap-1.5 border-l-2 border-brass/60 bg-brass/[0.06] py-1.5 pr-2 pl-3">
          <textarea
            autoFocus
            value={api.draftNote}
            onChange={(e) => api.setDraftNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                api.submit(path, ln)
              }
              if (e.key === "Escape") api.cancel()
            }}
            rows={2}
            placeholder="Comentário para o agente…"
            className="w-full flex-1 resize-none rounded-md border bg-secondary/30 p-1.5 text-[12px] text-foreground outline-none focus:border-brass/40"
          />
          <div className="flex shrink-0 flex-col gap-1">
            <button
              type="button"
              onClick={() => api.submit(path, ln)}
              title="Salvar (⌘⏎)"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Check className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={api.cancel}
              title="Cancelar (Esc)"
              className="rounded p-1 text-muted-foreground hover:bg-accent"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
