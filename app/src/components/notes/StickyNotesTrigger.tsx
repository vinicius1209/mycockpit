/**
 * O GATILHO da gaveta: o chip "Notas" da barra de título e o popover que ele
 * ancora.
 *
 * Separado do conteúdo da gaveta (`StickyNotesDock.tsx`) porque são duas
 * responsabilidades que só compartilham a store: aqui mora a ancoragem, a
 * fronteira de colisão e o gesto de abrir/fechar; lá mora o que aparece
 * dentro. O corte veio pela catraca do §10 (o arquivo passou de 700 linhas), e
 * é um recorte fechado, não um pedaço partido pra caber.
 */

import { useLayoutEffect, useMemo, useState, type ComponentProps } from "react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { StickyNote as StickyIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { controle } from "@/components/ui/controle"
import { SELECTED_FILL, UNSELECTED } from "@/lib/selection"
import { useStickyNotes, selectNotesFor } from "@/store/stickyNotes"
import { useChat } from "@/store/chat"
import { useApp } from "@/store/app"
import { escapeVemDoEditorDeNota } from "@/components/notes/StickyNoteCard"
import { StickyNotesDock } from "@/components/notes/StickyNotesDock"

export interface StickyNotesToggleViewProps
  extends Omit<ComponentProps<"button">, "onToggle"> {
  open: boolean
  count: number
  onToggle?: () => void
}

export function StickyNotesToggleView({
  open,
  count,
  onToggle,
  className,
  ...resto
}: StickyNotesToggleViewProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title="Abrir Bloco de Notas / Post-its"
      // `resto` por ÚLTIMO de propósito: quando este botão é o `Trigger` do
      // popover (`asChild`), quem manda no clique, no `aria-haspopup` e no ref
      // é o Radix. Sem este spread o `asChild` viraria decoração: os props do
      // gatilho morriam aqui e a gaveta não abria.
      {...resto}
      className={cn(
        controle("padrao"),
        "relative gap-1.5 border transition-colors",
        open ? SELECTED_FILL : UNSELECTED,
        className,
      )}
    >
      <StickyIcon className="size-3.5" />
      <span>Notas</span>
      {count > 0 && (
        <span
          className="grid h-4 min-w-4 place-items-center rounded-full bg-muted-foreground/15 px-1 text-[11px] font-medium leading-none text-foreground"
        >
          {count}
        </span>
      )}
    </button>
  )
}

/**
 * Botão gatilho + a gaveta ANCORADA nele (N1).
 *
 * Antes a gaveta era `fixed right-4 top-14 bottom-16`: altura cheia sempre,
 * presa em nada, e por ser `fixed` abria por cima do painel de contexto quando
 * os dois estavam abertos. Agora ela é um popover do chip: alinhado à direita
 * do gatilho, altura do conteúdo com teto de viewport, e fora do fluxo do
 * layout só enquanto está aberta — ela convive com o `ContextPanel` em vez de
 * cobri-lo.
 *
 * Esc e clique fora fecham (o `Popover` do Radix é quem sabe fazer isso; a
 * versão anterior só fechava no ✕ e no próprio gatilho). O ⌘K continua abrindo
 * pela store, porque `open` é controlado por ela, não pelo Radix.
 *
 * A gaveta pôde descer do host global do `App` porque a TitleBar é chrome: ela
 * está montada em TODA superfície, que era exatamente a razão do host.
 */
export function StickyNotesToggle({ className }: { className?: string }) {
  const dockOpen = useStickyNotes((s) => s.dockOpen)
  const setDockOpen = useStickyNotes((s) => s.setDockOpen)
  const notes = useStickyNotes((s) => s.notes)
  const activeId = useChat((s) => s.activeId) ?? undefined
  const projectId = useApp((s) => s.activeProjectId) ?? undefined

  const activeNotesCount = useMemo(
    () => selectNotesFor(notes, { projectId, convId: activeId }).length,
    [notes, projectId, activeId],
  )

  // A FRONTEIRA da gaveta: o cartão do centro do `AppShell`, que é exatamente
  // "tudo menos o painel direito". O desenho A assume flutuar sobre o fio; o
  // que ele não pode é comer o painel, que era justamente o defeito da gaveta
  // `fixed`. Vai como elemento (e não como largura decorada) porque o painel é
  // redimensionável: quem mede é o contêiner, nunca uma constante.
  //
  // `useLayoutEffect` e não `useMemo`: ler o DOM durante o render pega o layout
  // ANTES do commit da moldura e devolve `null` no boot (a gaveta abria com a
  // preferência `dockOpen` já ligada e ignorava a fronteira). O efeito de
  // layout roda depois da mutação e antes da pintura, então o reposicionamento
  // não pisca.
  const [limite, setLimite] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    setLimite(
      dockOpen
        ? document.querySelector<HTMLElement>("[data-notes-boundary]")
        : null,
    )
  }, [dockOpen])

  return (
    <Popover open={dockOpen} onOpenChange={setDockOpen}>
      {/* Sem `onToggle`: quem alterna aqui é o próprio `Trigger` do Radix.
          Passar o gesto da store JUNTO faria os dois dispararem no mesmo
          clique e a gaveta abriria e fecharia no mesmo frame. */}
      <PopoverTrigger asChild>
        <StickyNotesToggleView
          open={dockOpen}
          count={activeNotesCount}
          className={className}
        />
      </PopoverTrigger>
      {/* `asChild`: a gaveta é uma `<aside>` com landmark, então ela É a
          superfície em vez de morar dentro de mais uma. O E2 vem da primitiva
          (§12); a `aside` acrescenta só o que é dela (largura, altura,
          overflow).

          z-[120]: a TitleBar é z-[110], e no z padrão a borda de cima do painel
          ficaria ATRÁS da faixa de título (mesmo tropeço do sino). */}
      <PopoverContent
        asChild
        align="end"
        collisionBoundary={limite ?? undefined}
        // `sticky="always"`, e não o "partial" padrão: o padrão instala um
        // `limitShift` que trava o deslocamento assim que a gaveta ia
        // "descolar" do chip — na prática ela parava com a borda direita na
        // borda ESQUERDA do chip, ainda dentro do painel. Aqui a fronteira é
        // que manda; a gaveta pode descolar do chip, cobrir o painel não pode.
        sticky="always"
        className="z-[120]"
        // A gaveta é lugar de ESCREVER: devolver o foco pro chip a cada
        // abertura roubaria o cursor de quem abriu pra digitar. O foco entra
        // no conteúdo e o Esc devolve pro gatilho, que é o padrão do Radix.
        onOpenAutoFocus={(e) => e.preventDefault()}
        // UM Esc, UM efeito. O Radix escuta em CAPTURA no document, então o
        // Esc que o editor da nota trata pra descartar o rascunho chegava
        // aqui também e fechava a gaveta inteira no mesmo gesto — dois
        // contratos disputando a mesma tecla. Com editor aberto a gaveta se
        // cala; o segundo Esc, já fora do editor, fecha normalmente.
        onEscapeKeyDown={(e) => {
          if (escapeVemDoEditorDeNota(e.target)) e.preventDefault()
        }}
      >
        <StickyNotesDock />
      </PopoverContent>
    </Popover>
  )
}
