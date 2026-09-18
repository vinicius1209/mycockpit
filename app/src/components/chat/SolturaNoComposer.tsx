// Soltar no composer, pelos dois caminhos que existem.
//
// De FORA (capricho PRD R6): o arquivo chega pelo evento do Tauri, com caminho
// real (o `drop` do HTML5 não recebe arquivo com `dragDropEnabled`, e ele não
// se desliga). Sobre o composer aparece "Solte para anexar · N itens".
//
// De DENTRO (R8): arquivo da árvore e texto selecionado no fio, no diff ou nos
// Bastidores. Aí não existe caminho de disco nem `dataTransfer` confiável
// (ADR-212): a carga mora em `lib/arrastoInterno.ts` e o alvo se decide pela
// posição do ponteiro, igual ao de fora.
//
// Soltar fora do composer não faz nada, nos dois casos. E todo gesto tem
// equivalente sem arrastar: "Anexar" e colar imagem, `@` para mencionar
// arquivo, "Citar trecho" para a seleção.

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
  planoDoArrasto,
  rotuloDaSoltura,
  rotuloDoArrasto,
  type CaminhoSolto,
} from "@/lib/soltura"
import {
  cancelarArrasto,
  cargaArrastada,
  comecarArrasto,
  concluirArrasto,
  pairarSobre,
} from "@/lib/arrastoInterno"
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

/** Aplica no rascunho o que foi solto de dentro do app. */
function soltarDeDentro(carga: NonNullable<ReturnType<typeof cargaArrastada>>): void {
  const convId = useChat.getState().activeId
  if (!convId) {
    toast.error("Abra uma conversa para soltar aqui.")
    return
  }
  const plano = planoDoArrasto(carga)
  const drafts = useComposerDrafts.getState()
  if (plano.acao === "colagem") {
    drafts.addColagem(convId, plano.texto)
    return
  }
  if (plano.acao === "mencao" || plano.acao === "texto") {
    drafts.appendText(convId, plano.texto)
  }
}

export function SolturaNoComposer() {
  const [pairando, setPairando] = useState<Pairando | null>(null)
  const [rotulo, setRotulo] = useState<string | null>(null)

  // R8: arrasto que nasceu DENTRO da janela. O alvo é o mesmo cartão; o que
  // muda é a origem da carga e o rótulo do que vai acontecer.
  useEffect(() => {
    function sobreOComposer(ev: DragEvent): DOMRect | null {
      const r = cartaoDoComposer()?.getBoundingClientRect()
      if (!r) return null
      const dentro =
        ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
      return dentro ? r : null
    }
    function aoComecar(ev: DragEvent) {
      // Fonte explícita (linha da árvore, linha da barra lateral) já registrou
      // a carga no `dragstart` dela.
      if (cargaArrastada()) return
      const alvo = ev.target instanceof Element ? ev.target : null
      // Só superfície de leitura: o fio, o diff e os Bastidores são marcados
      // com `data-selectable`. Arrastar dentro do próprio composer é mover
      // texto no editor, e isso é dele.
      if (!alvo?.closest("[data-selectable]") || alvo.closest("[data-composer-card]")) return
      const selecao = window.getSelection()?.toString() ?? ""
      if (!selecao.trim()) return
      comecarArrasto({ tipo: "texto", id: `texto:${Date.now()}`, texto: selecao })
    }
    function aoArrastar(ev: DragEvent) {
      const carga = cargaArrastada()
      if (!carga) return
      const r = sobreOComposer(ev)
      const texto = r ? rotuloDoArrasto(carga) : null
      if (!r || !texto) {
        pairarSobre(null)
        setPairando(null)
        setRotulo(null)
        return
      }
      ev.preventDefault()
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy"
      pairarSobre({ tipo: "composer" })
      setRotulo(texto)
      setPairando({ quantos: 1, ret: { left: r.left, top: r.top, width: r.width, height: r.height } })
    }
    function aoSoltar(ev: DragEvent) {
      if (!cargaArrastada()) return
      ev.preventDefault()
      const feito = concluirArrasto("composer", { tipo: "composer" })
      setPairando(null)
      setRotulo(null)
      if (feito) soltarDeDentro(feito.carga)
    }
    function aoTerminar() {
      // Fim do gesto sem `drop` entregue: o alvo pairado ainda vale.
      const feito = concluirArrasto("composer")
      setPairando(null)
      setRotulo(null)
      if (feito) soltarDeDentro(feito.carga)
      else cancelarArrasto()
    }
    document.addEventListener("dragstart", aoComecar)
    document.addEventListener("dragover", aoArrastar)
    document.addEventListener("drop", aoSoltar)
    document.addEventListener("dragend", aoTerminar)
    return () => {
      document.removeEventListener("dragstart", aoComecar)
      document.removeEventListener("dragover", aoArrastar)
      document.removeEventListener("drop", aoSoltar)
      document.removeEventListener("dragend", aoTerminar)
    }
  }, [])

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
        {rotulo ?? rotuloDaSoltura(pairando.quantos)}
      </div>
    </div>,
    document.body,
  )
}
