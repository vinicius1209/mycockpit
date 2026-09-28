// Soltar arquivos na conversa, pelos dois caminhos que existem.
//
// De FORA: o arquivo chega pelo evento do Tauri, com caminho real (o `drop` do
// HTML5 não recebe arquivo com `dragDropEnabled`, e ele não se desliga).
//
// De DENTRO: é outro mecanismo, por ponteiro, e mora em
// `components/common/CamadaDeArrasto.tsx` (ADR-214). Os dois acabam aqui, em
// `soltarCaminhos`, com o mesmo véu sobre a coluna da conversa (fio e
// composer) e o verbo do resultado (docs/explorador-de-arquivos-prd.md, D5).
//
// Todo gesto tem equivalente sem arrastar: "Anexar" e colar imagem, `@` para
// mencionar arquivo, "Citar trecho" para a seleção.

import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { avisar, mensagemDe } from "@/lib/avisos"
import { attachPath, type Attachment } from "@/lib/attachments"
import { blocosComArquivos } from "@/lib/arquivoCitado"
import { isTauri } from "@/lib/db"
import { dentroDoRetangulo, planoDaSoltura, rotuloDosCaminhos, type CaminhoSolto } from "@/lib/soltura"
import { alvoDoVeu, VeuDeSoltura, type RetanguloDoVeu } from "@/components/chat/VeuDeSoltura"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"

interface Pairando {
  rotulo: string
  ret: RetanguloDoVeu
}

/** Leva caminhos absolutos ao rascunho da conversa ativa: imagem e PDF viram
 *  anexo, o resto cartão. É a soltura do Finder E a da árvore. */
export async function soltarCaminhos(paths: string[]): Promise<void> {
  const convId = useChat.getState().activeId
  if (!convId || paths.length === 0) return
  const drafts = useComposerDrafts.getState()
  const atual = drafts.byConv[convId]
  const itens = await invoke<CaminhoSolto[]>("caminhos_soltos", { paths })
  const plano = planoDaSoltura(itens, { anexosAtuais: atual?.attachments.length ?? 0 })
  const novos: Attachment[] = []
  for (const path of plano.anexos) {
    try {
      novos.push(await attachPath(convId, path))
    } catch (err) {
      avisar.erro("Não consegui anexar o arquivo.", { detalhe: mensagemDe(err) })
    }
  }
  const agora = useComposerDrafts.getState().byConv[convId]
  if (novos.length > 0) {
    const vistos = new Set((agora?.attachments ?? []).map((a) => a.path))
    useComposerDrafts
      .getState()
      .setAttachments(convId, [...(agora?.attachments ?? []), ...novos.filter((a) => !vistos.has(a.path))])
  }
  if (plano.arquivos.length > 0) {
    // O resto vira cartão (ADR-252), não texto no meio do pedido.
    const blocos = useComposerDrafts.getState().byConv[convId]?.blocos ?? []
    useComposerDrafts.getState().setBlocos(convId, blocosComArquivos(blocos, plano.arquivos))
  }
  for (const aviso of plano.recusados) avisar.erro(aviso)
}

export function SolturaNoComposer() {
  const [pairando, setPairando] = useState<Pairando | null>(null)

  useEffect(() => {
    if (!isTauri()) return
    let caminhos: string[] = []
    let desfazer: (() => void) | null = null
    let cancelado = false
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload
        if (p.type === "leave") {
          setPairando(null)
          return
        }
        if (p.type === "enter") caminhos = p.paths
        const r = alvoDoVeu()?.getBoundingClientRect()
        const dentro = Boolean(r && dentroDoRetangulo(p.position, window.devicePixelRatio, r))
        if (p.type === "drop") {
          setPairando(null)
          if (dentro) void soltarCaminhos(p.paths).catch(() => avisar.erro("Não consegui usar os arquivos soltos."))
          return
        }
        setPairando(
          dentro && r && caminhos.length > 0
            ? {
                rotulo: rotuloDosCaminhos(caminhos.map((caminho) => ({ caminho }))),
                ret: { left: r.left, top: r.top, width: r.width, height: r.height },
              }
            : null,
        )
      })
      .then((fn) => {
        if (cancelado) fn()
        else desfazer = fn
      })
    return () => {
      cancelado = true
      desfazer?.()
    }
  }, [])

  if (!pairando) return null
  return <VeuDeSoltura ret={pairando.ret} rotulo={pairando.rotulo} />
}
