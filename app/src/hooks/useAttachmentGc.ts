// O GC do cache de blobs, no boot.
//
// Saiu do `ChatPanel.tsx` pela catraca do §10, e o recorte é fechado: é uma
// tarefa de manutenção que não tem nada a ver com a conversa na tela — só
// precisava de um lugar que monta uma vez.
//
// Duas guardas que não podem sumir daqui:
//
//  · **refs `null` NÃO roda** (F1). `null` é falha de leitura do banco, e
//    varrer órfãs com lista vazia apagaria o cache inteiro.
//  · **as notas entram na MESMA passada.** Elas moram dentro da raiz de anexos
//    e têm régua própria (só órfã); sem a lista, o GC não distingue "nota
//    apagada" de "front que ainda não montou".

import { useEffect } from "react"
import { avisar } from "@/lib/avisos"
import { gcAttachments } from "@/lib/attachments"
import { listConvRefs, isTauri } from "@/lib/db"
import { BYTES_PER_MB } from "@/lib/format"
import { useStickyNotes } from "@/store/stickyNotes"

export function useAttachmentGc() {
  useEffect(() => {
    if (!isTauri()) return
    void (async () => {
      const refs = await listConvRefs()
      if (!refs) return
      try {
        const notasVivas = useStickyNotes.getState().notes.map((n) => n.id)
        const r = await gcAttachments(refs, notasVivas)
        if (r.freed_bytes > 0) {
          avisar.evento(
            `Cache de anexos: ${(r.freed_bytes / BYTES_PER_MB).toFixed(1)} MB liberados`,
          )
        }
      } catch {
        // GC é best-effort: falhar aqui não pode atrapalhar o boot.
      }
    })()
  }, [])
}
