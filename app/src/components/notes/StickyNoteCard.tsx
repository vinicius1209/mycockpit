import { useState, useRef, useEffect, useMemo } from "react"
import {
  Sparkles,
  ListPlus,
  GraduationCap,
  Copy,
  Check,
  Pencil,
  Trash2,
  ChevronDown,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/clipboard"
import { confirm } from "@/lib/confirm"
import { saveNoteAttachment, type Attachment } from "@/lib/attachments"
import { collectPaste } from "@/hooks/useAttachments"
import { NoteAttachments } from "@/components/notes/NoteAttachments"
import { AgentMark } from "@/components/common/AgentMark"
import { Markdown } from "@/components/common/Markdown"
import { folhaDaNota, tituloEPreview } from "@/components/notes/noteText"
import {
  ALVO_QUALQUER,
  alvosDeNota,
  normalizarAlvo,
} from "@/components/notes/noteTargets"
import type { StickyNote, StickyNoteColor } from "@/components/notes/types"

export interface StickyNoteCardProps {
  note: StickyNote
  onUpdate?: (patch: Partial<StickyNote>) => void
  onDelete?: () => void
  /** Recebe a NOTA, não o texto: quem monta o endereço `@nota/…` é o container
   *  (só ele conhece as outras notas, e o endereço precisa ser único entre
   *  elas). */
  onInsertIntoPrompt?: (note: StickyNote) => void
  onPromoteToTask?: (content: string) => void
  onPromoteToRule?: (content: string) => void
  readOnly?: boolean
  /**
   * A nota é a FOLHA de uma superfície flutuante (a gaveta), não um cartão
   * solto sobre o fio. Tira borda e sombra próprias: cartão dentro de popover é
   * hairline aninhado, e o §4 fecha essa porta (ADR-043). O que separa a folha
   * do resto da gaveta passa a ser cor + raio, sem filete.
   */
  flat?: boolean
  className?: string
}

/**
 * Tinta de papel do post-it (ADR-117, que revisa o ADR-109).
 *
 * O papel é VIVO: post-it de verdade, não sussurro a 10%. A nota é o único
 * lugar do app onde a cor é ESCOLHA do humano, e sussurrada ela não escolhia
 * nada — cinco tons quase iguais.
 *
 * A regra que substitui a antiga ("`note-*` nunca pinta texto"): sobre papel
 * vivo a letra NÃO pode seguir o tema, senão some no escuro. Cada papel vem com
 * a tinta no par `--note-fg` (mesmo molde de `--brass`/`--brass-fg`): a nota
 * deixa de herdar o tema e vira ilha invertida.
 *
 * E a contenção que mantém o §2 de pé: papel vivo só existe DENTRO da gaveta,
 * que é superfície convocada. O chrome do app segue quieto e o vocabulário de
 * estado (`st-*`) não passa a disputar atenção com rótulo de papel.
 */
export const COLOR_STYLES: Record<
  StickyNoteColor,
  { card: string; border: string; dot: string; label: string }
> = {
  sand: {
    card: "bg-note-sand text-note-fg",
    border: "border-note-sand/60",
    dot: "bg-note-sand",
    label: "Sol",
  },
  slate: {
    card: "bg-note-slate text-note-fg",
    border: "border-note-slate/60",
    dot: "bg-note-slate",
    label: "Coral",
  },
  teal: {
    card: "bg-note-teal text-note-fg",
    border: "border-note-teal/60",
    dot: "bg-note-teal",
    label: "Verde",
  },
  indigo: {
    card: "bg-note-indigo text-note-fg",
    border: "border-note-indigo/60",
    dot: "bg-note-indigo",
    label: "Limão",
  },
  rose: {
    card: "bg-note-rose text-note-fg",
    border: "border-note-rose/60",
    dot: "bg-note-rose",
    label: "Rosa",
  },
}

const ALL_COLORS: StickyNoteColor[] = ["sand", "slate", "teal", "indigo", "rose"]

/**
 * A marca do editor ABERTO, e por que ela existe no DOM.
 *
 * O Esc do editor cancela o rascunho; o Esc da gaveta fecha a gaveta. Um gesto,
 * dois efeitos: editando uma nota, um Esc fazia as DUAS coisas.
 *
 * `stopPropagation` no `onKeyDown` do textarea NÃO resolve, e vale registrar
 * por quê: o Radix escuta `keydown` no `document` em fase de CAPTURA
 * (`@radix-ui/react-use-escape-keydown`), ou seja, antes de o evento sequer
 * chegar ao textarea. Quando o handler do React roda, a gaveta já decidiu
 * fechar. O único ponto onde dá pra intervir é o `onEscapeKeyDown` do
 * `Popover.Content`, que roda DENTRO daquele listener de captura e respeita
 * `preventDefault` (`react-dismissable-layer`: só chama `onDismiss` se o evento
 * não foi prevenido).
 *
 * Daí a marca: o `Content` não conhece o estado do cartão, mas conhece o ALVO
 * do evento. Se o Esc nasceu dentro de um editor aberto, a gaveta se cala e
 * deixa o cartão cancelar o rascunho. O segundo Esc, já fora do editor, fecha.
 */
export const ATRIBUTO_EDITOR_DE_NOTA = "data-nota-editando"
export const SELETOR_EDITOR_DE_NOTA = `[${ATRIBUTO_EDITOR_DE_NOTA}]`

/** O Esc veio de dentro de um editor de nota aberto?
 *  Recebe `EventTarget` cru: alvo que não é elemento (o `document`, a janela)
 *  não tem `closest` e responde `false` — fail-open pro comportamento antigo,
 *  que é o certo aqui: sem editor, Esc fecha a gaveta. */
export function escapeVemDoEditorDeNota(alvo: EventTarget | null): boolean {
  const elemento = alvo as { closest?: (seletor: string) => unknown } | null
  if (!elemento || typeof elemento.closest !== "function") return false
  return elemento.closest(SELETOR_EDITOR_DE_NOTA) != null
}


export function StickyNoteCard({
  note,
  onUpdate,
  onDelete,
  onInsertIntoPrompt,
  onPromoteToTask,
  onPromoteToRule,
  readOnly,
  flat,
  className,
}: StickyNoteCardProps) {
  const [isEditing, setIsEditing] = useState(!note.content.trim() && !readOnly)
  const [draftContent, setDraftContent] = useState(note.content)
  const [copied, setCopied] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [targetMenuOpen, setTargetMenuOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const folha = useMemo(() => folhaDaNota(note.content), [note.content])
  const activeColor = note.color ?? "sand"
  const theme = COLOR_STYLES[activeColor] ?? COLOR_STYLES.sand
  // O alvo vem do REGISTRY (`noteTargets.ts`), não de uma lista escrita aqui:
  // agent novo aparece sozinho, e valor gravado por versão antiga (`claude`)
  // é normalizado em vez de virar nota sem destino.
  const alvos = useMemo(() => alvosDeNota(), [])
  const alvoId = normalizarAlvo(note.targetAgent)
  const target = alvos.find((t) => t.id === alvoId) ?? alvos[0]

  useEffect(() => {
    setDraftContent(note.content)
  }, [note.content])

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      // Posiciona cursor no final
      const len = textareaRef.current.value.length
      textareaRef.current.setSelectionRange(len, len)
    }
  }, [isEditing])

  function saveAndExit() {
    setIsEditing(false)
    const trimmed = draftContent.trim()
    if (trimmed !== note.content) {
      onUpdate?.({ content: trimmed, updatedAt: Date.now() })
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      saveAndExit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      // Quem impede a gaveta de fechar junto é o `onEscapeKeyDown` do popover
      // (ver `ATRIBUTO_EDITOR_DE_NOTA`); este `stopPropagation` fecha a porta
      // do lado do React, pra nenhum atalho de tecla acima do cartão comer o
      // mesmo Esc que já foi gasto cancelando o rascunho.
      e.stopPropagation()
      setDraftContent(note.content)
      setIsEditing(false)
    }
  }

  async function handleCopy() {
    if (!note.content) return
    const ok = await copyText(note.content)
    if (ok) {
      setCopied(true)
      toast.success("Nota copiada")
      setTimeout(() => setCopied(false), 1500)
    }
  }

  /**
   * Colar imagem na nota.
   *
   * O byte vai pro disco pelo MESMO caminho da conversa (`save_note_attachment`
   * reusa validação, sniff, allowlist e teto de 10 MB); o que entra na nota é o
   * metadado. Falha não engole: anexo que some sem dizer nada é pior que anexo
   * que não entrou.
   */
  async function handlePaste(e: React.ClipboardEvent) {
    if (readOnly || !onUpdate) return
    const { files } = collectPaste(e.clipboardData)
    if (files.length === 0) return
    e.preventDefault()
    const novos: Attachment[] = []
    for (const f of files) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer())
        novos.push(
          await saveNoteAttachment(note.id, f.name || "colado", f.type, bytes),
        )
      } catch (err) {
        toast.error("Não consegui anexar.", { description: String(err) })
      }
    }
    if (novos.length > 0) {
      onUpdate({ attachments: [...(note.attachments ?? []), ...novos] })
    }
  }

  function handlePromptInsert() {
    if (!note.content.trim()) return
    onInsertIntoPrompt?.(note)
    toast.success("Nota endereçada no composer")
  }

  function handlePromoteTask() {
    if (!note.content.trim()) return
    onPromoteToTask?.(note.content.trim())
  }

  function handlePromoteRule() {
    if (!note.content.trim()) return
    onPromoteToRule?.(note.content.trim())
  }

  return (
    <div
      className={cn(
        // Elevação tem 3 níveis e só 3 (§4): post-it em repouso é E1, e sobe
        // pra E2 no hover. Sombra montada à mão não tem par claro/escuro.
        // `flat` = a nota já está DENTRO de uma superfície E2 (a gaveta): ali
        // ela não tem elevação própria nenhuma, senão vira cartão em cartão.
        "group/sticky relative flex flex-col rounded-xl p-3.5 transition-all duration-150",
        // `flat` = a nota está DENTRO da gaveta, que já é a superfície. Ali ela
        // não tem elevação NEM tinta próprias: papel colorido dentro de um
        // popover branco é cartão-em-cartão de cor, e a folha do desenho A é
        // papel limpo. A cor não some da vida — ela continua na bolinha do
        // seletor aqui e no ponto da linha da lista, que é onde ela é RÓTULO.
        !flat && "border shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-pop)]",
        !flat && theme.card,
        !flat && theme.border,
        className,
      )}
    >
      {/* Cabeçalho do Post-it */}
      <div className="flex items-center justify-between gap-1.5 pb-2 text-[11px]">
        {/* Seletor de Agente Alvo */}
        <div className="relative">
          <button
            type="button"
            disabled={readOnly}
            onClick={() => setTargetMenuOpen((o) => !o)}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition-colors",
              "bg-background/50 hover:bg-background/80 text-foreground/85 border border-border/40",
            )}
            title="Agente de destino da nota"
          >
            {target.id !== ALVO_QUALQUER ? (
              <AgentMark agent={target.id} title={target.label} />
            ) : (
              <span className="size-1.5 rounded-full bg-muted-foreground/60" />
            )}
            <span className="text-[11px] leading-none">{target.label}</span>
            {!readOnly && <ChevronDown className="size-2.5 opacity-60" />}
          </button>

          {targetMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setTargetMenuOpen(false)}
              />
              <div className="absolute left-0 top-full z-30 mt-1 min-w-[130px] rounded-lg border bg-popover p-1 shadow-[var(--shadow-pop)] backdrop-blur-md">
                {alvos.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onUpdate?.({ targetAgent: opt.id, updatedAt: Date.now() })
                      setTargetMenuOpen(false)
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                      opt.id === (note.targetAgent ?? "all")
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {opt.id !== ALVO_QUALQUER ? (
                      <AgentMark agent={opt.id} title={opt.label} />
                    ) : (
                      <span className="size-2 rounded-full bg-muted-foreground/50" />
                    )}
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Ações do cabeçalho (cor, apagar) */}
        <div className="flex items-center gap-1">
          {/* Seletor de cor */}
          {!readOnly && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPaletteOpen((o) => !o)}
                className="grid size-5 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
                title="Mudar cor do post-it"
              >
                <span className={cn("size-2.5 rounded-full border border-black/10 dark:border-white/10", theme.dot)} />
              </button>

              {paletteOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setPaletteOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-30 mt-1 flex items-center gap-1 rounded-lg border bg-popover p-1.5 shadow-[var(--shadow-pop)] backdrop-blur-md">
                    {ALL_COLORS.map((col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={() => {
                          onUpdate?.({ color: col, updatedAt: Date.now() })
                          setPaletteOpen(false)
                        }}
                        className={cn(
                          "size-4 rounded-full border transition-transform hover:scale-125",
                          COLOR_STYLES[col].dot,
                          col === activeColor
                            ? "ring-2 ring-foreground/40 ring-offset-1"
                            : "opacity-70 hover:opacity-100",
                        )}
                        title={COLOR_STYLES[col].label}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Apagar.
              Dois consertos numa coisa só. O glifo era um ✕ IDÊNTICO ao ✕ que
              fecha a gaveta, a dois centímetros dele: mesma forma, mesmo peso,
              um fecha e o outro DESTRÓI. Ícone de lixeira separa as duas
              famílias — fechar é ✕, apagar é lixeira, em todo lugar.
              E some o clique único: nota é texto que você escreveu, o app não
              tem desfazer, e apagar por engano é perda definitiva. */}
          {!readOnly && onDelete && (
            <button
              type="button"
              onClick={async () => {
                const { titulo } = tituloEPreview(note.content)
                const ok = await confirm({
                  title: "Apagar esta nota?",
                  description: note.content.trim()
                    ? `"${titulo}" some junto com os anexos dela. Não dá pra desfazer.`
                    : "A nota está vazia e some sem deixar rastro.",
                  confirmLabel: "Apagar",
                  danger: true,
                })
                if (ok) onDelete()
              }}
              className="grid size-5 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-destructive/15 hover:text-destructive"
              title="Apagar nota"
              aria-label="Apagar nota"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Corpo da Nota (Markdown ou Textarea de Edição) */}
      <div className="min-h-[64px] flex-1 py-1">
        {isEditing ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              ref={textareaRef}
              // A marca que o Esc do popover consulta. Vive no textarea porque
              // ele só existe enquanto a edição existe: estado de verdade, sem
              // ninguém pra sincronizar.
              {...{ [ATRIBUTO_EDITOR_DE_NOTA]: "" }}
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={saveAndExit}
              placeholder="Clique para anotar algo (o que lembrar, código, ideias)..."
              rows={3}
              className={cn(
                "w-full resize-none rounded-lg border-0 bg-background/60 p-2.5 text-[13px] leading-relaxed",
                "text-foreground outline-none ring-1 ring-border/60 focus:ring-brass/60 placeholder:text-muted-foreground/50",
              )}
            />
            <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground/70">
              <span>⌘⏎ ou clique fora para salvar · Esc cancela</span>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  saveAndExit()
                }}
                className="font-medium text-foreground hover:underline"
              >
                Pronto
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => !readOnly && setIsEditing(true)}
            className={cn(
              "group/content min-h-[48px] cursor-text rounded-lg p-1.5 text-[13px] leading-relaxed transition-colors",
              !readOnly && "hover:bg-background/35",
            )}
            title={readOnly ? undefined : "Clique para editar"}
          >
            {note.content.trim() ? (
              flat ? (
                // Folha (desenho A): a primeira linha SOBE a título, como no
                // Apple Notes e como a lista já faz. Sem isso, a folha era a
                // única superfície das notas onde o conteúdo saía cru.
                <>
                  {folha.titulo && (
                    <p className="mb-1.5 text-[14px] font-semibold leading-snug text-foreground">
                      {folha.titulo}
                    </p>
                  )}
                  {folha.corpo && (
                    <div className="prose prose-xs dark:prose-invert max-w-none font-sans text-foreground/90">
                      <Markdown text={folha.corpo} />
                    </div>
                  )}
                </>
              ) : (
                <div className="prose prose-xs dark:prose-invert max-w-none text-foreground/90 font-sans">
                  <Markdown text={note.content} />
                </div>
              )
            ) : (
              <span className="italic text-muted-foreground/60">
                Clique para editar esta nota...
              </span>
            )}
          </div>
        )}
      </div>

      {note.attachments && note.attachments.length > 0 && (
        <NoteAttachments
          attachments={note.attachments}
          onRemove={
            readOnly || !onUpdate
              ? undefined
              : (path) =>
                  onUpdate({
                    attachments: (note.attachments ?? []).filter(
                      (a) => a.path !== path,
                    ),
                  })
          }
        />
      )}

      {/* Barra de Ações Inteligentes do Cockpit (Footer) */}
      <div className="mt-2 flex items-center justify-between border-t border-border/30 pt-2 text-[11px]">
        {/* Status / Ação de Edição */}
        <div className="flex items-center gap-1.5 text-muted-foreground/70">
          {/* Na folha o botão "Editar" é redundante: o corpo inteiro já abre a
              edição no clique, e um botão que repete o gesto da superfície
              inteira só ocupa a linha das ações que importam. */}
          {!readOnly && !flat && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
              title="Editar texto"
            >
              <Pencil className="size-2.5" />
              <span>Editar</span>
            </button>
          )}
        </div>

        {/* Ações Inteligentes com 1 Clique */}
        <div className="flex items-center gap-1">
          {/* 1. Inserir no Prompt */}
          {onInsertIntoPrompt && (
            <button
              type="button"
              onClick={handlePromptInsert}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors",
                "bg-brass/10 hover:bg-brass/20 text-brass-fg dark:text-brass",
              )}
              title="Inserir conteúdo desta nota no prompt atual"
            >
              <Sparkles className="size-3" />
              <span>Prompt</span>
            </button>
          )}

          {/* 2. Promover para Tarefa */}
          {onPromoteToTask && (
            <button
              type="button"
              onClick={handlePromoteTask}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
              title="Transformar nota em tarefa no Plano"
            >
              <ListPlus className="size-3" />
              <span className="sr-only sm:not-sr-only">Tarefa</span>
            </button>
          )}

          {/* 3. Promover para Doutrina / Regra */}
          {onPromoteToRule && (
            <button
              type="button"
              onClick={handlePromoteRule}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
              title="Transformar em regra/aprendizado duradouro (🎓)"
            >
              <GraduationCap className="size-3" />
            </button>
          )}

          {/* 4. Copiar */}
          <button
            type="button"
            onClick={handleCopy}
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
            title="Copiar nota"
          >
            {/* Confirmação de cópia é ambiente, não marco: cinza que escurece,
                não verde (§2, linha do Verde). */}
            {copied ? <Check className="size-3 text-foreground" /> : <Copy className="size-3" />}
          </button>
        </div>
      </div>
    </div>
  )
}
