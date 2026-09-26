import { useMemo, useState, type ComponentProps, type ReactNode } from "react"
import {
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react"
import { avisar } from "@/lib/avisos"
import { cn } from "@/lib/utils"
import { controle } from "@/components/ui/controle"
import { useStickyNotes, selectNotesFor } from "@/store/stickyNotes"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"
import { useApp } from "@/store/app"
import { StickyNoteCard } from "@/components/notes/StickyNoteCard"
import { NotesList } from "@/components/notes/NotesList"
import {
  ROTULO_DE_ESCOPO,
  agruparNotas,
  escopoDaNota,
  mostraLista,
  type EscopoDeNota,
} from "@/components/notes/noteGroups"
import { ALVO_QUALQUER } from "@/components/notes/noteTargets"
import { mencaoDaNota } from "@/components/notes/noteMention"
import {
  COPY_DE_VAZIO,
  filtrarPorBusca,
  motivoDeVazio,
  type MotivoDeVazio,
} from "@/components/notes/noteText"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { StickyNote, StickyNoteTarget } from "@/components/notes/types"

/** Carimbo compacto: contexto temporal, não título da nota. */
const DATA_CURTA = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})

function IconBtn({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick?: () => void
  title: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        controle("chip", { quadrado: true }),
        "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      {children}
    </button>
  )
}

/**
 * O escopo da nota, na cara e clicável (N3).
 *
 * Hoje o escopo era herdado em silêncio: `handleCreateNote` carimbava
 * `convId: activeId` e ninguém via. É a mesma regra que Configurações já
 * aplica, e ela vale aqui: escopo explícito, nunca herdado em silêncio.
 */
function EscopoPill({
  escopo,
  temConversa,
  onMudar,
}: {
  escopo: EscopoDeNota
  temConversa: boolean
  onMudar?: (proximo: EscopoDeNota) => void
}) {
  const proximo: EscopoDeNota = escopo === "conversa" ? "projeto" : "conversa"
  const podeTrocar = !!onMudar && (proximo === "projeto" || temConversa)
  const rotulo =
    escopo === "conversa" ? "Conversa" : escopo === "todos" ? "Todos" : "Projeto"
  return (
    <button
      type="button"
      disabled={!podeTrocar}
      onClick={() => onMudar?.(proximo)}
      title={
        !onMudar
          ? `Escopo: ${ROTULO_DE_ESCOPO[escopo]}`
          : podeTrocar
            ? `Mover para "${ROTULO_DE_ESCOPO[proximo]}"`
            : "Sem conversa ativa: esta nota é do projeto"
      }
      className={cn(
        controle("chip"),
        "font-medium text-muted-foreground transition-colors enabled:hover:bg-sel-hover enabled:hover:text-foreground disabled:cursor-default",
      )}
    >
      <span>{rotulo}</span>
    </button>
  )
}

/**
 * "Nova": o gesto NOMEIA o escopo em que a nota nasce.
 *
 * Sem conversa ativa há um destino só, e aí o menu seria um enigma de um item:
 * vira botão direto, com o escopo escrito no `title`.
 */
function NovaNota({
  temConversa,
  onCreate,
  variant = "icone",
}: {
  temConversa: boolean
  onCreate?: (escopo: EscopoDeNota) => void
  variant?: "icone" | "vazio"
}) {
  if (!onCreate) return null

  const corpo =
    variant === "icone" ? (
      <Plus className="size-3.5" />
    ) : (
      <>
        <Plus className="size-3.5" />
        <span>Criar primeira nota</span>
      </>
    )
  const classe =
    variant === "icone"
      ? cn(
          controle("chip", { quadrado: true }),
          "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        )
      : cn(
          controle("compacto"),
          "mt-4 border bg-background font-medium text-foreground transition-colors hover:bg-accent",
        )

  if (!temConversa) {
    return (
      <button
        type="button"
        onClick={() => onCreate("projeto")}
        title="Nova nota do projeto"
        aria-label="Nova nota do projeto"
        className={classe}
      >
        {corpo}
      </button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Nova nota"
          aria-label="Nova nota"
          className={classe}
        >
          {corpo}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="z-[130]">
        <DropdownMenuItem onSelect={() => onCreate("conversa")}>
          <MessageSquare className="size-3.5" />
          Nesta conversa
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCreate("projeto")}>
          <FolderGit2 className="size-3.5" />
          No projeto
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A folha quando não há nota pra mostrar, e ela DIZ QUAL vazio é (§ "estado
 * real, nunca teatro").
 *
 * Antes havia um vazio só: "Nenhuma nota ainda / Criar primeira nota". Com a
 * busca sem casar nada, essa frase aparecia ao lado da coluna dizendo
 * "Nenhuma nota com esse texto" — duas frases contraditórias na mesma tela, e a
 * da direita mentindo sobre o estado (as 20 notas continuavam lá).
 *
 * O gesto oferecido segue o motivo: criar só faz sentido quando não existe
 * nota; nos outros dois o que resolve é DESFAZER o recorte.
 */
function FolhaVazia({
  motivo,
  temConversa,
  onCreate,
  onLimparBusca,
  onVerTodas,
}: {
  motivo: MotivoDeVazio
  temConversa: boolean
  onCreate?: (escopo: EscopoDeNota) => void
  onLimparBusca?: () => void
  onVerTodas?: () => void
}) {
  const copy = COPY_DE_VAZIO[motivo]
  const desfazer =
    motivo === "busca"
      ? { rotulo: "Limpar busca", acao: onLimparBusca }
      : motivo === "filtro"
        ? { rotulo: "Ver todas", acao: onVerTodas }
        : undefined

  return (
    <div className="flex flex-col items-center justify-center p-6 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-secondary/50 text-muted-foreground">
        {motivo === "sem-notas" ? (
          <Sparkles className="size-6 opacity-60" />
        ) : (
          <Search className="size-6 opacity-60" />
        )}
      </div>
      <p className="text-[13px] font-medium text-foreground/80">{copy.titulo}</p>
      <p className="mt-1 max-w-[200px] text-[11px] text-muted-foreground">
        {copy.dica}
      </p>
      {motivo === "sem-notas" ? (
        <NovaNota temConversa={temConversa} onCreate={onCreate} variant="vazio" />
      ) : (
        desfazer?.acao && (
          <button
            type="button"
            onClick={desfazer.acao}
            className={cn(
              controle("compacto"),
              "mt-4 border bg-background font-medium text-foreground transition-colors hover:bg-accent",
            )}
          >
            {desfazer.rotulo}
          </button>
        )
      )}
    </div>
  )
}

/**
 * A gaveta é o `asChild` do `PopoverContent` (§12): a `<aside>` com landmark É
 * a superfície, em vez de morar dentro de mais uma.
 *
 * Por isso ela estende as props de `aside` e as REPASSA. O Radix entrega aqui o
 * `className` da superfície E2, o `ref` do posicionamento e os `data-state` /
 * `data-side` de que a animação depende. Componente que engole essas props vira
 * um painel transparente sem borda, flutuando sobre o fio — foi exatamente o
 * defeito do build 311.
 */
export interface StickyNotesDockViewProps extends ComponentProps<"aside"> {
  open: boolean
  notes: readonly StickyNote[]
  /** Projeto ativo: é ele que separa "Deste projeto" de "De todos os
   *  projetos". Sem ele a gaveta volta a chamar de "do projeto" o que aparece
   *  em todos. */
  activeProjectId?: string
  activeConvId?: string
  activeFilter?: StickyNoteTarget | "all"
  /** Relógio injetável: o corte "Hoje" das seções é função dele. */
  agora?: number
  /** Busca e seleção são estado do CONTAINER, não da View (que segue pura e
   *  renderizável em SSR). Enquanto eram `useState` daqui de dentro, NENHUM
   *  caminho de busca tinha teste de render, e foi por essa fresta que o falso
   *  vazio passou. Ambos são opcionais: sem eles a View é o retrato do estado
   *  inicial, que é exatamente o que os testes de SSR precisam. */
  busca?: string
  onBusca?: (termo: string) => void
  escolhidaId?: string
  onEscolher?: (id: string) => void
  onClose?: () => void
  /** Devolve o id da nota criada pra folha já abrir NELA (nota que nasce
   *  escondida atrás da seleção anterior é nota que ninguém escreve). */
  onCreate?: (escopo: EscopoDeNota) => string | undefined
  onUpdate?: (id: string, patch: Partial<StickyNote>) => void
  onDelete?: (id: string) => void
  onFilterChange?: (filter: StickyNoteTarget | "all") => void
  onInsertIntoPrompt?: (note: StickyNote) => void
  onPromoteToTask?: (text: string) => void
  onPromoteToRule?: (text: string) => void
}

/** Componente de apresentação puro (testável em SSR / desacoplado) */
export function StickyNotesDockView({
  open,
  notes,
  activeProjectId,
  activeConvId,
  activeFilter = ALVO_QUALQUER,
  agora: agoraProp,
  busca = "",
  onBusca,
  escolhidaId,
  onEscolher,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  onFilterChange,
  onInsertIntoPrompt,
  onPromoteToTask,
  onPromoteToRule,
  className,
  ...superficie
}: StickyNotesDockViewProps) {
  const agora = useMemo(() => agoraProp ?? Date.now(), [agoraProp])

  // O universo do escopo, SEM o filtro por agent: é ele que decide se a lista
  // existe. Deixar o filtro decidir esconderia a caixa de busca junto com o
  // resultado dela, e o usuário ficaria preso num filtro invisível.
  const todas = useMemo(
    () => selectNotesFor(notes, { projectId: activeProjectId, convId: activeConvId }),
    [notes, activeProjectId, activeConvId],
  )
  const comLista = mostraLista(todas.length)

  const listadas = useMemo(() => {
    if (!comLista) return todas
    return filtrarPorBusca(
      selectNotesFor(notes, {
        projectId: activeProjectId,
        convId: activeConvId,
        filtro: activeFilter,
      }),
      busca,
    )
  }, [comLista, todas, notes, activeProjectId, activeConvId, activeFilter, busca])

  const grupos = useMemo(
    () => agruparNotas(listadas, { agora, convId: activeConvId }),
    [listadas, agora, activeConvId],
  )

  // Seleção derivada, nunca guardada sozinha: a nota escolhida pode ter sido
  // apagada, filtrada pela busca ou trocada de conversa. Caindo pra primeira da
  // lista, a folha nunca fica em branco apontando pra um id que não existe mais.
  const selecionada = listadas.find((n) => n.id === escolhidaId) ?? listadas[0]
  const indice = selecionada ? listadas.indexOf(selecionada) : -1

  /** Cria e ABRE a nota nova. Limpa a busca junto: a nota nasce vazia e um
   *  termo ativo a esconderia no mesmo gesto que a criou. */
  function criar(escopo: EscopoDeNota) {
    const id = onCreate?.(escopo)
    onBusca?.("")
    if (id) onEscolher?.(id)
  }

  if (!open) return null

  return (
    <aside
      aria-label="Bloco de Notas"
      {...superficie}
      className={cn(
        // A superfície E2 vem da primitiva (`ui/popover`, §12), que monta esta
        // `aside` com `asChild`: aqui fica só o que é da gaveta. Repetir borda,
        // fundo ou sombra aqui NÃO é redundância inofensiva — o `Slot` do Radix
        // CONCATENA as duas listas de classe em vez de resolvê-las com
        // `twMerge`, então classe repetida vira disputa de ordem no CSS.
        //
        // E2 e só E2 (§4): nada lá dentro tem sombra própria. `max-h` com teto
        // de viewport + altura do CONTEÚDO: painel de 1 nota tem tamanho de 1
        // nota.
        "flex max-h-[min(40rem,var(--radix-popover-content-available-height,40rem))] overflow-hidden",
        comLista
          ? "w-[min(760px,calc(100vw-32px))]"
          : "w-[min(480px,calc(100vw-32px))]",
        // Por último: a superfície do `PopoverContent` vence o que for igual.
        className,
      )}
    >
      {comLista && (
        <NotesList
          grupos={grupos}
          agora={agora}
          selectedId={selecionada?.id}
          busca={busca}
          filtro={activeFilter}
          onBusca={(termo) => onBusca?.(termo)}
          onSelect={(id) => onEscolher?.(id)}
          onFiltro={onFilterChange ?? (() => {})}
        />
      )}

      {/* A cor identifica a nota na lista e no seletor; o texto fica dono da
          folha neutra, sem disputar com uma superfície inteira saturada. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[11px] text-faint">
          {selecionada ? (
            <>
              <span className="min-w-0 truncate font-mono tabular-nums">
                {DATA_CURTA.format(new Date(selecionada.updatedAt))}
              </span>
              <EscopoPill
                escopo={escopoDaNota(selecionada, activeConvId)}
                temConversa={!!activeConvId}
                onMudar={
                  onUpdate &&
                  ((proximo) =>
                    onUpdate(selecionada.id, {
                      convId: proximo === "conversa" ? activeConvId : undefined,
                    }))
                }
              />
            </>
          ) : (
            <span className="shrink-0 font-medium text-foreground">Bloco de Notas</span>
          )}

          <div className="ml-auto flex items-center gap-0.5">
            {/* Desenho B: sem lista, o folhear é a única navegação que existe,
                e ele precisa dizer ONDE você está (`1/2`), não só "próxima". */}
            {!comLista && listadas.length > 1 && (
              <>
                <IconBtn
                  title="Nota anterior"
                  disabled={indice <= 0}
                  onClick={() => onEscolher?.(listadas[indice - 1]?.id)}
                >
                  <ChevronLeft className="size-3.5" />
                </IconBtn>
                <span className="px-0.5 font-mono text-[11px] tabular-nums">
                  {indice + 1}/{listadas.length}
                </span>
                <IconBtn
                  title="Próxima nota"
                  disabled={indice < 0 || indice >= listadas.length - 1}
                  onClick={() => onEscolher?.(listadas[indice + 1]?.id)}
                >
                  <ChevronRight className="size-3.5" />
                </IconBtn>
              </>
            )}
            <NovaNota
              temConversa={!!activeConvId}
              onCreate={onCreate && criar}
            />
            {onClose && (
              <IconBtn title="Fechar bloco de notas" onClick={onClose}>
                <X className="size-3.5" />
              </IconBtn>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {selecionada ? (
            <StickyNoteCard
              // A chave é o id da nota: trocar de nota na folha tem que
              // recriar o editor, senão o rascunho da anterior vaza pra
              // próxima (o textarea é estado interno do cartão).
              key={selecionada.id}
              flat
              note={selecionada}
              onUpdate={(patch) => onUpdate?.(selecionada.id, patch)}
              onDelete={() => onDelete?.(selecionada.id)}
              onInsertIntoPrompt={onInsertIntoPrompt}
              onPromoteToTask={onPromoteToTask}
              onPromoteToRule={onPromoteToRule}
            />
          ) : (
            <FolhaVazia
              motivo={motivoDeVazio({
                total: todas.length,
                busca,
                filtroAtivo: activeFilter !== "all",
              })}
              temConversa={!!activeConvId}
              onCreate={onCreate && criar}
              onLimparBusca={onBusca && (() => onBusca(""))}
              onVerTodas={onFilterChange && (() => onFilterChange("all"))}
            />
          )}
        </div>
      </div>
    </aside>
  )
}

/** Container conectado à store */
export function StickyNotesDock(superficie: ComponentProps<"aside">) {
  const dockOpen = useStickyNotes((s) => s.dockOpen)
  const setDockOpen = useStickyNotes((s) => s.setDockOpen)
  const notes = useStickyNotes((s) => s.notes)
  const addNote = useStickyNotes((s) => s.addNote)
  const updateNote = useStickyNotes((s) => s.updateNote)
  const deleteNote = useStickyNotes((s) => s.deleteNote)
  const activeFilter = useStickyNotes((s) => s.activeFilter)
  const setFilter = useStickyNotes((s) => s.setFilter)

  const activeId = useChat((s) => s.activeId) ?? undefined
  const projectId = useApp((s) => s.activeProjectId) ?? undefined

  // Busca e seleção moram AQUI, não na View: é o que deixa a View pura e
  // testável em SSR (e foi por essa fresta, quando eram estado interno dela,
  // que o falso vazio da busca passou sem teste).
  const [busca, setBusca] = useState("")
  const [escolhida, setEscolhida] = useState<string | undefined>(undefined)

  /** O escopo vem do GESTO (N3), não do que estava ativo por acaso. */
  function handleCreateNote(escopo: EscopoDeNota): string {
    return addNote({
      // O escopo do gesto vira DONO: "todos" é o único que nasce sem projeto.
      projectId: escopo === "todos" ? undefined : projectId,
      convId: escopo === "conversa" ? activeId : undefined,
      content: "",
      color: "sand",
      targetAgent: activeFilter === "all" ? "all" : activeFilter,
    }).id
  }

  /**
   * Endereça a nota no rascunho — `@nota/slug`, não o texto colado.
   *
   * Colar o texto congelava uma cópia: editar a nota depois de inserir não
   * mudava o que ia. O endereço é resolvido no ENVIO, então vai sempre a versão
   * atual, emoldurada como direção do humano.
   */
  function handleInsertIntoPrompt(nota: StickyNote) {
    if (!activeId) {
      avisar.erro("Nenhuma conversa ativa no momento.")
      return
    }
    const endereco = mencaoDaNota(nota, notes)
    const atual = useComposerDrafts.getState().byConv[activeId]?.text ?? ""
    const proximo = atual.trim() ? `${atual} ${endereco}` : endereco
    useComposerDrafts.getState().setText(activeId, proximo)
  }

  // "Promover pra tarefa" e "promover pra regra" ainda não existem: não há
  // escrita no plano nem no registro de doutrinas por aqui. Enquanto não
  // houver, os handlers NÃO são passados e os dois botões do rodapé do post-it
  // simplesmente não aparecem (são condicionais no StickyNoteCard). Botão que
  // só solta um toast dizendo que fez é pior que botão nenhum.

  return (
    <StickyNotesDockView
      // A superfície vem do `PopoverContent` via `asChild` e atravessa o
      // container sem ser tocada: className, ref e os `data-*` de estado.
      {...superficie}
      open={dockOpen}
      notes={notes}
      activeProjectId={projectId}
      activeConvId={activeId}
      activeFilter={activeFilter}
      busca={busca}
      onBusca={setBusca}
      escolhidaId={escolhida}
      onEscolher={setEscolhida}
      onClose={() => setDockOpen(false)}
      onCreate={handleCreateNote}
      onUpdate={updateNote}
      onDelete={deleteNote}
      onFilterChange={setFilter}
      onInsertIntoPrompt={handleInsertIntoPrompt}
    />
  )
}
