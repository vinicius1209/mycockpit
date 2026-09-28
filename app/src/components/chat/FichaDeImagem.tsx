// A imagem no meio do texto do composer (G3, ADR-275): "[imagem N]" vira uma
// ficha com miniatura, no ponto em que foi colada. O TEXTO do nó continua sendo
// "[imagem N]": o rascunho segue string, e fila, nota, revezamento e busca
// leem a referência legível. Quem entrega a imagem a cada motor é o Rust.

import { createContext, useContext, useEffect, useRef, useState, type JSX } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $applyNodeReplacement,
  DecoratorNode,
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical"
import { attachmentUrl, type Attachment } from "@/lib/attachments"
import { referencia, referencias } from "@/lib/imagemNoTexto"
import { nomeCortadoNoMeio } from "@/lib/nomeNoMeio"
import { cn } from "@/lib/utils"
import { useLightbox } from "@/store/lightbox"

/** As imagens do rascunho, na ordem: a ficha N mostra a N-ésima. */
export const ImagensDoRascunho = createContext<readonly Attachment[]>([])

type SerializedImagemNoTexto = Spread<{ n: number }, SerializedLexicalNode>

export class ImagemNoTextoNode extends DecoratorNode<JSX.Element> {
  __n: number

  static getType(): string {
    return "imagem-no-texto"
  }

  static clone(node: ImagemNoTextoNode): ImagemNoTextoNode {
    return new ImagemNoTextoNode(node.__n, node.__key)
  }

  static importJSON(json: SerializedImagemNoTexto): ImagemNoTextoNode {
    return $createImagemNoTexto(json.n)
  }

  constructor(n: number, key?: NodeKey) {
    super(key)
    this.__n = n
  }

  exportJSON(): SerializedImagemNoTexto {
    return { ...super.exportJSON(), type: "imagem-no-texto", version: 1, n: this.__n }
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span")
    span.style.display = "inline-block"
    return span
  }

  updateDOM(): false {
    return false
  }

  getTextContent(): string {
    return referencia(this.__n)
  }

  isInline(): true {
    return true
  }

  decorate(): JSX.Element {
    return <FichaDeImagem n={this.__n} />
  }
}

export function $createImagemNoTexto(n: number): ImagemNoTextoNode {
  return $applyNodeReplacement(new ImagemNoTextoNode(n))
}

export function $isImagemNoTexto(node: LexicalNode | null | undefined): node is ImagemNoTextoNode {
  return node instanceof ImagemNoTextoNode
}

/** A ficha da imagem N, no composer e no balão do fio: a mesma peça. */
export function FichaDeImagem({ n }: { n: number }) {
  const imagens = useContext(ImagensDoRascunho)
  const anexo = imagens[n - 1]
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!anexo) return
    let vivo = true
    attachmentUrl(anexo)
      .then((u) => vivo && setUrl(u))
      .catch(() => vivo && setUrl(null))
    return () => {
      vivo = false
    }
  }, [anexo])

  if (!anexo) {
    // Só acontece enquanto a imagem colada ainda está sendo salva: a que não
    // entra tem a referência retirada do texto (useAttachments.addFiles).
    return (
      <span className="mx-0.5 inline-flex h-6 items-center rounded-md bg-secondary px-1.5 align-middle font-mono text-[11px] text-muted-foreground">
        {n} · anexando…
      </span>
    )
  }
  return (
    <button
      type="button"
      contentEditable={false}
      title={`${anexo.name} (clique para ampliar)`}
      onClick={() =>
        useLightbox.getState().open(
          imagens.map((a) => ({ path: a.path, name: a.name, source: "anexo" as const, mime: a.mime })),
          n - 1,
        )
      }
      className={cn(
        "mx-0.5 inline-flex h-6 items-center gap-1.5 rounded-md bg-secondary py-0 pr-2 pl-0.5 align-middle text-[12px] text-muted-foreground ring-1 ring-border ring-inset",
      )}
    >
      {url ? (
        <img src={url} alt="" className="size-5 rounded object-cover" />
      ) : (
        <span className="size-5 rounded bg-background" />
      )}
      <span className="font-mono text-[11px]">
        {n} · {nomeCortadoNoMeio(anexo.name, 22)}
      </span>
    </button>
  )
}

/** "[imagem N]" digitado ou colado como texto vira ficha quando N existe. */
export function ImagemNoTextoPlugin({ total }: { total: number }) {
  const [editor] = useLexicalComposerContext()
  const totalRef = useRef(total)
  totalRef.current = total
  useEffect(() => {
    return editor.registerNodeTransform(TextNode, (node) => {
      if (!node.isSimpleText()) return
      const texto = node.getTextContent()
      const [r] = referencias(texto, totalRef.current)
      if (!r) return
      // Parte o nó em [antes][ref][depois] e troca a ref pela ficha; a
      // transform roda de novo no pedaço de depois.
      const partes = node.splitText(r.inicio, r.fim)
      const alvo = r.inicio === 0 ? partes[0] : partes[1]
      alvo.replace($createImagemNoTexto(r.n))
    })
    // `total` por ref: revarrer só quando muda o número de imagens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, total])
  return null
}
