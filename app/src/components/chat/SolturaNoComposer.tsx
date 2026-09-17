// Soltar arquivos do sistema no composer (capricho PRD R6). O arquivo chega
// pelo evento do Tauri, com caminho real (o `drop` do HTML5 não recebe arquivo
// com `dragDropEnabled`, e ele não se desliga). Sobre o composer aparece
// "Solte para anexar · N itens"; soltar fora dele não faz nada.
//
// O equivalente sem arrastar já existe: colar imagem e "Anexar" no composer.

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { toast } from "sonner"
import { attachPath, type Attachment } from "@/lib/attachments"
import { isTauri } from "@/lib/db"
import {
  dentroDoRetangulo,
  planoDaSoltura,
  rotuloDaSoltura,
  type CaminhoSolto,
} from "@/lib/soltura"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"

interface Pairando {
  quantos: number
  ret: { left: number; top: number; width: number; height: number }
}

function cartaoDoComposer(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-composer-card]")
}

async function soltar(paths: string[]): Promise<void> {
  const convId = useChat.getState().activeId
  const app = useApp.getState()
  const projectPath = app.projects.find((p) => p.id === app.activeProjectId)?.path ?? null
  if (!convId || paths.length === 0) return
  const drafts = useComposerDrafts.getState()
  const atual = drafts.byConv[convId]
  const itens = await invoke<CaminhoSolto[]>("caminhos_soltos", { paths })
  const plano = planoDaSoltura(itens, {
    projectPath,
    anexosAtuais: atual?.attachments.length ?? 0,
  })
  const novos: Attachment[] = []
  for (const path of plano.anexos) {
    try {
      novos.push(await attachPath(convId, path))
    } catch (err) {
      toast.error(typeof err === "string" ? err : "Não consegui anexar o arquivo.")
    }
  }
  const agora = useComposerDrafts.getState().byConv[convId]
  if (novos.length > 0) {
    const vistos = new Set((agora?.attachments ?? []).map((a) => a.path))
    useComposerDrafts
      .getState()
      .setAttachments(convId, [...(agora?.attachments ?? []), ...novos.filter((a) => !vistos.has(a.path))])
  }
  if (plano.mencoes.length > 0) {
    const texto = useComposerDrafts.getState().byConv[convId]?.text ?? ""
    const refs = plano.mencoes.join(" ")
    useComposerDrafts.getState().setText(convId, texto.trim() ? `${texto.trimEnd()} ${refs}` : refs)
  }
  for (const aviso of plano.recusados) toast.error(aviso)
}

export function SolturaNoComposer() {
  const [pairando, setPairando] = useState<Pairando | null>(null)

  useEffect(() => {
    if (!isTauri()) return
    let quantos = 0
    let desfazer: (() => void) | null = null
    let cancelado = false
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload
        if (p.type === "leave") {
          setPairando(null)
          return
        }
        if (p.type === "enter") quantos = p.paths.length
        const cartao = cartaoDoComposer()
        const r = cartao?.getBoundingClientRect()
        const dentro = Boolean(r && dentroDoRetangulo(p.position, window.devicePixelRatio, r))
        if (p.type === "drop") {
          setPairando(null)
          if (dentro) void soltar(p.paths).catch(() => toast.error("Não consegui usar os arquivos soltos."))
          return
        }
        setPairando(
          dentro && r && quantos > 0
            ? { quantos, ret: { left: r.left, top: r.top, width: r.width, height: r.height } }
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
  return createPortal(
    // Cartão opaco por baixo (o rascunho não vaza pelo estado) e a superfície de
    // seleção por cima, com a aresta do cartão.
    <div
      aria-live="polite"
      style={pairando.ret}
      className="pointer-events-none fixed z-40 rounded-2xl border bg-card"
    >
      <div className="grid h-full place-items-center rounded-2xl bg-sel text-[13px] font-medium text-foreground">
        {rotuloDaSoltura(pairando.quantos)}
      </div>
    </div>,
    document.body,
  )
}
