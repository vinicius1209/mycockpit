// Os blocos do rascunho que moram FORA do editor: citação (capricho R4),
// colagem grande (R7) e região marcada no navegador (navegador R4). Chips na
// faixa acima do input, junto dos anexos.

import { ClipboardPaste, CornerDownRight, Crosshair, MessageSquareQuote, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { horaDaCitacao, type BlocoCitacao, type BlocoDoRascunho } from "@/lib/citacao"
import { rotuloDaColagem, type BlocoColagem } from "@/lib/colagem"
import { rotuloDaMarcacao, type BlocoMarcacao } from "@/lib/marcacao"
import { rotuloDoParecer, type BlocoParecer } from "@/lib/parecerTrazido"
import { useComposerDrafts } from "@/store/composerDrafts"

function Remover({ rotulo, onRemove }: { rotulo: string; onRemove: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onRemove()
      }}
      className="text-muted-foreground hover:text-foreground"
      aria-label={rotulo}
      title={rotulo}
    >
      <X className="size-3" />
    </button>
  )
}

/** Uma citação no rascunho: de quem e quando, e o trecho em até duas linhas. */
function CitacaoChip({ bloco, onRemove }: { bloco: BlocoCitacao; onRemove: () => void }) {
  return (
    <span className="flex w-full min-w-0 items-start gap-1.5 rounded-md border bg-secondary/50 py-1 pr-1 pl-2 text-[12px]">
      <CornerDownRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[11px] text-muted-foreground">
          {bloco.autor} · {horaDaCitacao(bloco.ts)}
        </span>
        <span className="line-clamp-2 text-foreground/80">{bloco.trecho}</span>
      </span>
      <Remover rotulo="Remover citação" onRemove={onRemove} />
    </span>
  )
}

/** Uma colagem grande: o rótulo abre a prévia, que também devolve o conteúdo
 *  ao editor como texto. */
function ColagemChip({
  bloco,
  onRemove,
  onInserir,
}: {
  bloco: BlocoColagem
  onRemove: () => void
  onInserir: () => void
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-md border bg-secondary/50 px-2 py-1 text-[12px]">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 text-foreground/80 hover:text-foreground"
            title="Ver o que foi colado"
          >
            <ClipboardPaste className="size-3 shrink-0" />
            <span className="tabular-nums">{rotuloDaColagem(bloco.texto)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[520px] max-w-[calc(100vw-2rem)] p-0">
          <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre text-foreground/85">
            {bloco.texto}
          </pre>
          <div className="flex justify-end border-t border-border/40 p-2">
            <Button size="compacto" variant="ghost" onClick={onInserir}>
              Inserir como texto
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Remover rotulo="Remover colagem" onRemove={onRemove} />
    </span>
  )
}

/** Uma região marcada no navegador: a pílula diz a página e o tamanho, e a
 *  prévia mostra a descrição que vai junto do pedido. */
function MarcacaoChip({
  bloco,
  onRemove,
  onInserir,
}: {
  bloco: BlocoMarcacao
  onRemove: () => void
  onInserir: () => void
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-md border bg-secondary/50 px-2 py-1 text-[12px]">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="flex min-w-0 items-center gap-1.5 text-foreground/80 hover:text-foreground"
            title="Ver a descrição da região marcada"
          >
            <Crosshair className="size-3 shrink-0" />
            <span className="max-w-56 truncate">{rotuloDaMarcacao(bloco)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[520px] max-w-[calc(100vw-2rem)] p-0">
          <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">
            {bloco.descricao}
          </pre>
          <div className="flex justify-end border-t border-border/40 p-2">
            <Button size="compacto" variant="ghost" onClick={onInserir}>
              Inserir como texto
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Remover rotulo="Remover marcação" onRemove={onRemove} />
    </span>
  )
}

/** Um parecer trazido para o próximo turno: quem opinou, prévia do que vai no
 *  prompt, e o "×" que desfaz sem precisar enviar. */
function ParecerChip({
  bloco,
  onRemove,
}: {
  bloco: BlocoParecer
  onRemove: () => void
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-brass/40 bg-brass/10 px-2 py-1 text-[12px] text-brass">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="flex min-w-0 items-center gap-1.5 hover:text-brass/80"
            title="Ver o que vai no prompt"
          >
            <MessageSquareQuote className="size-3 shrink-0" />
            <span className="max-w-56 truncate">{rotuloDoParecer(bloco)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[520px] max-w-[calc(100vw-2rem)] p-0">
          <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">
            {bloco.texto}
          </pre>
        </PopoverContent>
      </Popover>
      <Remover rotulo="Tirar do próximo turno" onRemove={onRemove} />
    </span>
  )
}

export function BlocosDoRascunho({ convId, blocos }: { convId: string; blocos: BlocoDoRascunho[] }) {
  const drafts = useComposerDrafts.getState
  return (
    <>
      {blocos.map((b, i) =>
        b.tipo === "citacao" ? (
          <CitacaoChip key={`${b.itemId}:${i}`} bloco={b} onRemove={() => drafts().removeBloco(convId, i)} />
        ) : b.tipo === "parecer" ? (
          <ParecerChip
            key={b.id}
            bloco={b}
            onRemove={() => drafts().removeBloco(convId, i)}
          />
        ) : b.tipo === "marcacao" ? (
          <MarcacaoChip
            key={b.id}
            bloco={b}
            onRemove={() => drafts().removeBloco(convId, i)}
            onInserir={() => {
              drafts().removeBloco(convId, i)
              drafts().appendText(convId, b.descricao)
            }}
          />
        ) : (
          <ColagemChip
            key={b.id}
            bloco={b}
            onRemove={() => drafts().removeBloco(convId, i)}
            onInserir={() => {
              drafts().removeBloco(convId, i)
              drafts().appendText(convId, b.texto)
            }}
          />
        ),
      )}
    </>
  )
}
