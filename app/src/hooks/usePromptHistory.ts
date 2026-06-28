import { useEffect, useState } from "react"
import type { ConvState } from "@/store/chat"

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

  /** Zera a navegação do histórico (chamado no submit / submitFusion). */
  function resetHistory() {
    setHistIdx(null)
    setDraft("")
  }

  return { histIdx, setHistIdx, resetHistory, userPrompts, recallPrev, recallNext }
}
