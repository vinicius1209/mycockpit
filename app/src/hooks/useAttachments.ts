import { useEffect, useState } from "react"
import { toast } from "sonner"
import { open } from "@tauri-apps/plugin-dialog"
import { isTauri } from "@/lib/db"
import type { Attachment } from "@/lib/attachments"
import {
  MAX_ATTACH_BYTES,
  MAX_ATTACH_MB,
  MAX_ATTACH_COUNT,
  pastedTextToInsert,
  saveAttachment,
  deleteAttachment,
  revokeAttachmentUrl,
} from "@/lib/attachments"

/** O que um paste rende: os anexos E o texto que deve entrar no composer.
 *  Entrada ÚNICA (os dois donos chamam esta, não as peças) — a regra do texto
 *  que acompanha anexo (`pastedTextToInsert`: o endereço `blob:` do recurso
 *  anexado não é prompt) não pode ficar a cargo de cada superfície lembrar.
 *  A leitura é SÍNCRONA, antes de qualquer await — depois o clipboard esvazia
 *  (F21). */
export function collectPaste(data: DataTransfer): { files: File[]; text: string } {
  const files = collectPastedFiles(data)
  return { files, text: pastedTextToInsert(data.getData("text/plain"), files.length) }
}

/** Filtra do clipboard os File anexáveis: imagem, PDF ou sem mime declarado.
 *  Compartilhado pelos dois donos (PASTE_COMMAND do Lexical no console e
 *  onPaste do textarea do MissionLauncher). */
function collectPastedFiles(data: DataTransfer): File[] {
  return [...data.items]
    .filter((it) => it.kind === "file")
    .map((it) => it.getAsFile())
    .filter(
      (f): f is File =>
        !!f &&
        (f.type.startsWith("image/") ||
          f.type === "application/pdf" ||
          f.type === ""),
    )
}

/** Evento "paste-like": o React.ClipboardEvent do textarea satisfaz este shape
 *  — o hook não depende do dono. */
type PasteLikeEvent = {
  clipboardData: DataTransfer | null
  preventDefault: () => void
}

/**
 * Anexos pendentes do composer: paste (captura síncrona dos File antes do await,
 * F21), file-picker do Tauri (insere @path) e remoção (libera o object URL junto
 * do blob). Reseta na troca de conversa. Dois donos: o console (editor Lexical,
 * que roteia o paste via addFiles e foca via `focus`) e o MissionLauncher
 * (textarea próprio, via `textareaRef` + onPaste).
 */
export function useAttachments({
  activeId,
  setValue,
  textareaRef,
  focus,
}: {
  activeId: string | null
  setValue: React.Dispatch<React.SetStateAction<string>>
  /** Textarea dono (MissionLauncher): cursor do paste + foco do clipe. */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  /** Foco programático sem textarea (o editor Lexical do console). */
  focus?: () => void
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])

  // trocar de conversa zera os anexos pendentes (F19)
  useEffect(() => {
    setAttachments([])
  }, [activeId])

  function removeAttachment(path: string) {
    setAttachments((a) => a.filter((x) => x.path !== path))
    revokeAttachmentUrl(path) // libera o object URL junto do blob (ciclo de vida)
    void deleteAttachment(path)
  }

  function insertAtCursor(insert: string) {
    const ta = textareaRef?.current
    if (!ta) {
      setValue((v) => v + insert)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    setValue((v) => v.slice(0, start) + insert + v.slice(end))
  }

  // Núcleo do paste→anexo: valida tamanho/contagem (F8/F22) e salva cada File.
  // O editor Lexical chama direto (PASTE_COMMAND → onPasteFiles); o textarea do
  // MissionLauncher chega via onPaste — a REGRA é uma só.
  async function addFiles(files: File[]) {
    if (!isTauri() || !activeId) return
    let count = attachments.length
    for (const f of files) {
      if (f.size > MAX_ATTACH_BYTES) {
        toast.error(`"${f.name || "anexo"}" excede ${MAX_ATTACH_MB} MB`)
        continue
      }
      if (count >= MAX_ATTACH_COUNT) {
        toast.error(`máx. ${MAX_ATTACH_COUNT} anexos por mensagem`)
        break
      }
      try {
        const buf = new Uint8Array(await f.arrayBuffer())
        const att = await saveAttachment(activeId, f.name || "colado", f.type, buf)
        setAttachments((a) => [...a, att])
        count++
      } catch (err) {
        toast.error(typeof err === "string" ? err : "falha ao anexar")
      }
    }
  }

  // Colar imagem/PDF: captura os File SÍNCRONO antes de qualquer await (F21),
  // preserva o texto colado junto (F20), valida tamanho/contagem e salva.
  async function onPaste(e: PasteLikeEvent) {
    if (!isTauri() || !activeId) return
    const data = e.clipboardData
    if (!data) return
    const { files, text } = collectPaste(data)
    if (!files.length) return // paste de texto puro → comportamento default
    e.preventDefault()
    if (text) insertAtCursor(text)
    await addFiles(files)
  }

  // Anexo real (B3, inspirado no ai-04): file picker do Tauri → insere @path.
  async function attach() {
    if (!isTauri()) return
    const sel = await open({ multiple: true, title: "Anexar arquivo(s)" })
    if (!sel) return
    const paths = (Array.isArray(sel) ? sel : [sel]).filter(Boolean) as string[]
    if (!paths.length) return
    const refs = paths.map((p) => `@${p}`).join(" ")
    setValue((v) => (v.trim() ? `${v} ${refs}` : refs))
    if (textareaRef?.current) textareaRef.current.focus()
    else focus?.()
  }

  return { attachments, setAttachments, removeAttachment, onPaste, addFiles, attach }
}
