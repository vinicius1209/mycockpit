import { useEffect, useState } from "react"
import type { ConvState } from "@/store/chat"

/** Decisão PURA da borda do recall ↑/↓, compartilhada pelos dois motores do
 *  composer: o textarea deriva `before`/`after` de selectionStart/End; o
 *  Lexical, do texto ao redor do caret. A regra é uma só:
 *  - ↑ só recupera com o cursor na 1ª linha (nada de "\n" antes) e havendo
 *    prompts enviados;
 *  - ↓ só avança quando JÁ se navega o histórico e o cursor está na última
 *    linha (nada de "\n" depois).
 *  Fora das bordas devolve null — a seta segue navegando o texto normalmente. */
export function historyRecallIntent({
  key,
  before,
  after,
  canPrev,
  navigating,
}: {
  key: "ArrowUp" | "ArrowDown"
  /** Texto antes do cursor. */
  before: string
  /** Texto depois do cursor. */
  after: string
  /** Há prompts enviados pra recuperar (userPrompts.length > 0). */
  canPrev: boolean
  /** Já navegando o histórico (histIdx !== null). */
  navigating: boolean
}): "prev" | "next" | null {
  if (key === "ArrowUp") {
    return canPrev && !before.includes("\n") ? "prev" : null
  }
  return navigating && !after.includes("\n") ? "next" : null
}

/**
 * Histórico tipo shell: ↑/↓ recupera os prompts já enviados na conversa.
 * `histIdx === null` = editando (não navegando o histórico). `draft` guarda o
 * que estava sendo digitado antes do 1º ↑, pra restaurar ao voltar com ↓.
 */
export function usePromptHistory({
  conv,
  activeId,
  value,
  setValue,
  textareaRef,
}: {
  conv: ConvState
  activeId: string | null
  value: string
  setValue: React.Dispatch<React.SetStateAction<string>>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const [draft, setDraft] = useState("")

  // os prompts já enviados nesta conversa (mais novo = fim).
  const userPrompts = conv.items.flatMap((it) =>
    it.kind === "user" ? [it.text] : [],
  )

  function recallPrev() {
    if (userPrompts.length === 0) return
    if (histIdx === null) {
      setDraft(value)
      setHistIdx(userPrompts.length - 1)
      setValue(userPrompts[userPrompts.length - 1])
    } else if (histIdx > 0) {
      setHistIdx(histIdx - 1)
      setValue(userPrompts[histIdx - 1])
    }
  }

  function recallNext() {
    if (histIdx === null) return
    const idx = histIdx + 1
    if (idx >= userPrompts.length) {
      setHistIdx(null)
      setValue(draft)
    } else {
      setHistIdx(idx)
      setValue(userPrompts[idx])
    }
  }

  // depois de recuperar, leva o cursor pro fim p/ editar
  useEffect(() => {
    if (histIdx !== null && textareaRef.current) {
      const len = textareaRef.current.value.length
      textareaRef.current.setSelectionRange(len, len)
    }
  }, [histIdx])

  // trocar de conversa zera o histórico (F19). Os anexos pendentes saem no
  // useAttachments, num efeito irmão chaveado pelo mesmo activeId.
  useEffect(() => {
    setHistIdx(null)
    setDraft("")
  }, [activeId])

  /** Zera a navegação do histórico (submit e lançamento de disputa/missão). */
  function resetHistory() {
    setHistIdx(null)
    setDraft("")
  }

  return { histIdx, setHistIdx, resetHistory, userPrompts, recallPrev, recallNext }
}
