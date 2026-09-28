// Balão de mensagem do usuário com suporte a menções e ações rápidas no hover.
// Permite editar e reenviar para o composer, bifurcar (fork) a conversa a partir deste
// ponto ou copiar o texto para a área de transferência.

import { useMemo, useState } from "react"
import { Check, Copy, CornerDownRight, GitFork, PenLine } from "lucide-react"
import { avisar } from "@/lib/avisos"
import { splitMentions } from "@/components/chat/mentions"
import { Button } from "@/components/ui/button"
import { usePresets } from "@/store/presets"
import { useEspecialistas } from "@/store/especialistas"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"
import { CartaoDeArquivo } from "@/components/chat/CartaoDeArquivo"
import { useContextoDoCartao } from "@/components/chat/useContextoDoCartao"
import { blocoDoArquivoNoTexto, separarArquivos } from "@/lib/arquivoCitado"
import { blocoDaCitacaoNoTexto, itemDaCitacao, separarCitacoes } from "@/lib/citacao"
import { rotuloDaColagem, separarColagens } from "@/lib/colagem"
import {
  blocoDaMarcacaoNoTexto,
  dadosDaMarcacaoNoTexto,
  rotuloDaMarcacao,
  separarMarcacoes,
} from "@/lib/marcacao"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"
import { FichaDeImagem, ImagensDoRascunho } from "@/components/chat/FichaDeImagem"
import type { Attachment } from "@/lib/attachments"
import { referencias } from "@/lib/imagemNoTexto"

export function MentionText({ text }: { text: string }) {
  const list = usePresets((s) => s.list)
  const segs = useMemo(
    () => splitMentions(text, list.map((p) => p.name)),
    [text, list],
  )
  // O chip do `@nome` ABRE a persona: quem lê o fio meses depois quer saber
  // quem é essa gente, e o detalhe já existe no marketplace. Persona que saiu
  // do disco continua legível, só não clicável (não se promete tela que não
  // vai abrir).
  const idPorNome = useMemo(
    () => new Map(list.map((p) => [p.name.toLowerCase(), p.id])),
    [list],
  )
  if (segs.length === 1 && segs[0].type === "text") return <>{text}</>
  return (
    <>
      {segs.map((seg, i) => {
        if (seg.type !== "mention") return <span key={i}>{seg.text}</span>
        const chip = "rounded bg-brass/[0.12] px-1 font-medium text-brass"
        const id = idPorNome.get(seg.name.toLowerCase())
        if (!id) return <span key={i} className={chip}>{seg.text}</span>
        return (
          <button
            key={i}
            type="button"
            title={`Ver ${seg.name}`}
            onClick={() => useEspecialistas.getState().abrir(id)}
            className={cn(chip, "transition-colors hover:bg-brass/20 hover:underline")}
          >
            {seg.text}
          </button>
        )
      })}
    </>
  )
}

/** "[imagem N]" da mensagem vira a mesma ficha do composer (G3). */
function TextoComImagens({ text, imagens }: { text: string; imagens: readonly Attachment[] }) {
  const refs = referencias(text, imagens.length)
  if (refs.length === 0) return <MentionText text={text} />
  const partes: React.ReactNode[] = []
  let desde = 0
  for (const r of refs) {
    if (r.inicio > desde) partes.push(<MentionText key={`t${desde}`} text={text.slice(desde, r.inicio)} />)
    partes.push(<FichaDeImagem key={`i${r.inicio}`} n={r.n} />)
    desde = r.fim
  }
  if (desde < text.length) partes.push(<MentionText key={`t${desde}`} text={text.slice(desde)} />)
  return <ImagensDoRascunho.Provider value={imagens}>{partes}</ImagensDoRascunho.Provider>
}

export function UserMessageBubble({
  itemId,
  text,
  aDireita,
  imagens = [],
}: {
  itemId: string
  text: string
  /** Pedido a um especialista (ADR-267): a bolha vai à direita, o bico também. */
  aDireita?: boolean
  /** As imagens enviadas com a mensagem, na ordem (as "[imagem N]" do texto). */
  imagens?: readonly Attachment[]
}) {
  const [copied, setCopied] = useState(false)
  const [forking, setForking] = useState(false)
  // Citação enviada (capricho R4) vira linha ↳ acima do texto, nunca o formato cru.
  const contexto = useContextoDoCartao(useChat((s) => s.activeId))
  const { citacoes, corpo, colagens, marcacoes, arquivos } = useMemo(() => {
    // Arquivos soltos (ADR-252) fecham a fila de envelopes: saem primeiro.
    const semArquivos = separarArquivos(text)
    const semCitacoes = separarCitacoes(semArquivos.corpo)
    // Colagem grande (capricho R7) e região marcada (navegador R4) moram no fim
    // do texto; viram bloco recolhido, nunca o formato cru.
    const semMarcacoes = separarMarcacoes(semCitacoes.corpo)
    const { corpo, colagens } = separarColagens(semMarcacoes.corpo)
    return {
      citacoes: semCitacoes.citacoes,
      corpo,
      colagens,
      marcacoes: semMarcacoes.marcacoes,
      arquivos: semArquivos.arquivos,
    }
  }, [text])

  function handleEdit() {
    const convId = useChat.getState().activeId
    if (!convId) return

    const drafts = useComposerDrafts.getState()
    drafts.setText(convId, corpo)
    if (citacoes.length > 0 || colagens.length > 0 || marcacoes.length > 0 || arquivos.length > 0) {
      drafts.setBlocos(convId, [
        ...citacoes.map((c) => blocoDaCitacaoNoTexto(c)),
        ...colagens.map((texto) => ({ tipo: "colagem" as const, id: crypto.randomUUID(), texto })),
        ...marcacoes.map((descricao) => blocoDaMarcacaoNoTexto(descricao)),
        ...arquivos.map((a) => blocoDoArquivoNoTexto(a)),
      ])
    }
    const inputEl = document.querySelector<HTMLElement>('[data-composer="console"]')
    if (inputEl) {
      inputEl.focus()
    }
    avisar.feito("Mensagem carregada no composer para edição.")
  }

  async function handleFork() {
    const convId = useChat.getState().activeId
    if (!convId || !itemId) return

    setForking(true)
    try {
      const created = await useChat.getState().forkConversationAt(convId, itemId)
      if (!created) {
        avisar.erro("Não foi possível bifurcar a conversa a partir desta mensagem.")
      }
    } catch (err) {
      avisar.erro("Não foi possível bifurcar a conversa.", {
        detalhe: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setForking(false)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      avisar.feito("Mensagem copiada para a área de transferência.")
    } catch {
      avisar.erro("Não foi possível copiar o texto.")
    }
  }

  return (
    <div className="group relative inline-block max-w-full">
      {citacoes.map((c, i) => (
        <button
          key={i}
          type="button"
          title={`Ir para a mensagem original: ${c.trecho}`}
          // C-Q3: a busca é feita no clique, não a cada render do fio.
          onClick={() => {
            const convId = useChat.getState().activeId
            const items = convId ? useChat.getState().byId[convId]?.items : undefined
            const original = items ? itemDaCitacao(items, c.trecho, itemId) : null
            if (convId && original) useApp.getState().revealTranscriptItem(convId, original)
            else avisar.nota("A mensagem citada não está mais nesta conversa.")
          }}
          className="mb-1 flex max-w-[520px] items-center gap-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <CornerDownRight className="size-3 shrink-0" />
          <span className="shrink-0 font-mono text-[11px]">
            {c.autor} · {c.hora}
          </span>
          <span className="min-w-0 truncate italic">«{c.trecho.replace(/\s+/g, " ")}»</span>
        </button>
      ))}
      {arquivos.length > 0 && (
        // O cartão do arquivo, nunca o caminho cru (ADR-252), como a citação.
        <div className="mb-1 flex max-w-full flex-wrap gap-1.5">
          {arquivos.map((a) => (
            <CartaoDeArquivo key={a.caminho} caminho={a.caminho} pasta={a.pasta} bytes={0} contexto={contexto} />
          ))}
        </div>
      )}
      <div
        data-selectable
        className={cn("max-w-full rounded-2xl bg-secondary px-4 py-2.5 text-[14px] break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground", aDireita ? "rounded-tr-md" : "rounded-tl-md")}
      >
        <TextoComImagens text={corpo} imagens={imagens} />
      </div>
      {marcacoes.map((descricao, i) => (
        <details key={`marcacao:${i}`} className="mt-1 max-w-full">
          <summary className="w-max cursor-pointer list-none text-[12px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            {rotuloDaMarcacao(dadosDaMarcacaoNoTexto(descricao))}
          </summary>
          <pre
            data-selectable
            className="mt-1 max-h-72 max-w-full overflow-auto rounded-md border bg-card p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85"
          >
            {descricao}
          </pre>
        </details>
      ))}
      {colagens.map((c, i) => (
        <details key={i} className="group/colado mt-1 max-w-full">
          <summary className="w-max cursor-pointer list-none text-[12px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="tabular-nums">{rotuloDaColagem(c)}</span>
          </summary>
          <pre
            data-selectable
            className="mt-1 max-h-72 max-w-full overflow-auto rounded-md border bg-card p-2 font-mono text-[11px] leading-relaxed whitespace-pre text-foreground/85"
          >
            {c}
          </pre>
        </details>
      ))}

      <div
        className={cn(
          "absolute -top-3.5 right-2 z-10 flex items-center gap-0.5 rounded-md border border-border/40 bg-card p-0.5 shadow-xs transition-opacity duration-150",
          "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icone-chip"
          onClick={handleEdit}
          title="Editar e reenviar"
          aria-label="Editar e reenviar"
          className="text-muted-foreground hover:text-foreground"
        >
          <PenLine className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icone-chip"
          onClick={() => void handleFork()}
          disabled={forking}
          title="Bifurcar conversa a partir daqui"
          aria-label="Bifurcar conversa a partir daqui"
          className="text-muted-foreground hover:text-foreground"
        >
          <GitFork className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icone-chip"
          onClick={() => void handleCopy()}
          title="Copiar mensagem"
          aria-label="Copiar mensagem"
          className="text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <Check className="size-3 text-foreground" />
          ) : (
            <Copy className="size-3" />
          )}
        </Button>
      </div>
    </div>
  )
}
