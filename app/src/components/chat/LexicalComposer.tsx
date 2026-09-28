// O composer da conversa: Enter envia ou corrige, Tab enfileira, Shift+Enter
// quebra linha, "@" menciona, "/" comanda, ↑/↓ percorre o histórico.

import { virouPilula } from "@/components/chat/colagemGrande"
import { useEffect, useMemo, useRef } from "react"
import { LexicalComposer as LexicalComposerBase } from "@lexical/react/LexicalComposer"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createLineBreakNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
  TextNode,
  type LexicalNode,
} from "lexical"
import {
  $createImagemNoTexto,
  ImagemNoTextoNode,
  ImagemNoTextoPlugin,
  ImagensDoRascunho,
} from "@/components/chat/FichaDeImagem"
import type { Attachment } from "@/lib/attachments"
import {
  BeautifulMentionsPlugin,
  $createBeautifulMentionNode,
  $isBeautifulMentionNode,
  createBeautifulMentionNode,
} from "lexical-beautiful-mentions"
import {
  ComposerMentionComponent,
  MentionsMenu,
  MentionsMenuItem,
  mentionsTheme,
} from "@/components/chat/ComposerMentionsMenu"
import {
  $mentionedValues,
  $serializeDraft,
  $setDraft,
} from "@/components/chat/lexicalDraft"
import {
  SLASH_TRIGGER,
  slashPillCaretOffset,
  slashPillMatch,
  slashPillSourceLabel,
  type SlashPillCommand,
} from "@/components/chat/slashPill"
import { historyRecallIntent } from "@/hooks/usePromptHistory"
import { collectPaste } from "@/hooks/useAttachments"
import { buildLexicalAtItems } from "@/hooks/useAtMentions"
import { useMentionSearch } from "@/hooks/useMentionSearch"
import { MAX_POPOVER_ITEMS } from "@/hooks/useSlashCommands"
import { cn } from "@/lib/utils"
import { ComposerSubmitKeys } from "@/components/chat/composerSubmitKeys"

// Tema da menção: chip brass; `Focused` é o pill selecionado.
// O matcher do "@" não termina token em `.` `/` `_`: `@src/lib` é um caminho
// só, e o default da lib cortaria a busca no primeiro separador.
const AT_PUNCTUATION = ",\\*\\?\\$\\|#{}\\(\\)\\^\\[\\]\\\\!%'\"~=<>:;"

// O node de menção usa o NOSSO componente (node replacement da lib): todo
// $createBeautifulMentionNode passa a instanciar esta classe.
const [ComposerMentionNode, composerMentionReplacement] =
  createBeautifulMentionNode(ComposerMentionComponent)

/** O primeiro filho do primeiro parágrafo é um pill de comando "/"? (posição
 *  ÚNICA em que ele pode existir — gramática de comando no início.) */
function $hasLeadingSlashPill(): boolean {
  const first = $getRoot().getFirstChild()
  if (!$isElementNode(first)) return false
  const child = first.getFirstChild()
  return $isBeautifulMentionNode(child) && child.getTrigger() === SLASH_TRIGGER
}

/** Ponte do menu "/": lista, filtro e inserção moram no useSlashCommands;
 *  aqui só chegam os gestos do teclado. */
export type SlashMenuBridge = {
  /** Popover visível (showSlash) → as teclas navegam o menu, não o texto. */
  active: boolean
  /** ↑/↓ movem a seleção (com wrap, como no textarea). */
  move: (delta: 1 | -1) => void
  /** Enter/Tab inserem o comando selecionado (insertCommand → "/nome "). */
  pick: () => void
  /** Esc fecha até a próxima edição (setSlashDismissed). */
  dismiss: () => void
}

/** Ponte do histórico ↑/↓ estilo shell (usePromptHistory do CommandConsole). */
export type HistoryBridge = {
  /** Há prompts enviados pra recuperar (userPrompts.length > 0). */
  canPrev: boolean
  /** Já navegando o histórico (histIdx !== null). */
  navigating: boolean
  recallPrev: () => void
  recallNext: () => void
}

/** Teclas do menu "/" em prioridade CRITICAL: com o popover aberto elas vencem
 *  o Enter-envia (HIGH); fechado, tudo devolve false. Props por ref para não
 *  re-registrar comandos a cada render. */
function SlashMenuKeysPlugin({ slash }: { slash?: SlashMenuBridge }) {
  const [editor] = useLexicalComposerContext()
  const slashRef = useRef(slash)
  slashRef.current = slash
  useEffect(() => {
    const step =
      (delta: 1 | -1) =>
      (event: KeyboardEvent | null): boolean => {
        const s = slashRef.current
        if (!s?.active || event?.isComposing) return false
        event?.preventDefault()
        s.move(delta)
        return true
      }
    const choose = (event: KeyboardEvent | null): boolean => {
      const s = slashRef.current
      if (!s?.active || event?.isComposing) return false
      event?.preventDefault()
      s.pick()
      return true
    }
    const unregister = [
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        step(1),
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        step(-1),
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(KEY_ENTER_COMMAND, choose, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(KEY_TAB_COMMAND, choose, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          const s = slashRef.current
          if (!s?.active) return false
          event.preventDefault()
          s.dismiss()
          return true
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    ]
    return () => unregister.forEach((u) => u())
  }, [editor])
  return null
}

/** O nó está na posição-início do editor (sem irmão anterior, dentro do
 *  PRIMEIRO parágrafo do root)? É a única posição onde o pill "/" pode viver. */
function $isAtComposerStart(node: LexicalNode): boolean {
  if (node.getPreviousSibling() !== null) return false
  const parent = node.getParent()
  if (!$isParagraphNode(parent)) return false
  return parent.getPreviousSibling() === null && $isRootNode(parent.getParent())
}

/** Pill de comando "/": duas transforms, mutuamente exclusivas (sem loop).
 *  1. Conversão: "/nome<espaço>" NO INÍCIO com match exato no inventário vira
 *     pill atômico; sem match, fica texto. Re-registrar a transform revarre o
 *     conteúdo, então inventário que chega depois do draft também converte.
 *  2. Demoção: pill que deixou de estar no início volta a ser `/nome` literal,
 *     porque o pipeline só trata como comando o que está no começo. */
function SlashPillPlugin({
  commands,
}: {
  commands?: readonly SlashPillCommand[]
}) {
  const [editor] = useLexicalComposerContext()
  const commandsRef = useRef(commands)
  commandsRef.current = commands
  // Re-registra quando os nomes do inventário mudam: a transform revarre, e
  // um "/nome " restaurado antes do inventário vira pill quando ele chega.
  const namesKey = (commands ?? []).map((c) => c.name).join("\n")
  useEffect(() => {
    return editor.registerNodeTransform(TextNode, (node) => {
      const cmds = commandsRef.current
      if (!cmds || cmds.length === 0) return
      if (!$isAtComposerStart(node)) return
      const match = slashPillMatch(
        node.getTextContent(),
        cmds.map((c) => c.name),
      )
      if (!match) return
      const cmd = cmds.find((c) => c.name === match.name)
      if (!cmd) return
      // Caret antes da mutação: se estava neste nó, vai para o texto restante.
      const selection = $getSelection()
      const oldOffset =
        $isRangeSelection(selection) &&
        selection.isCollapsed() &&
        selection.anchor.key === node.getKey()
          ? selection.anchor.offset
          : null
      node.insertBefore(
        $createBeautifulMentionNode(SLASH_TRIGGER, match.name, {
          source: slashPillSourceLabel(cmd),
        }),
      )
      node.setTextContent(match.rest)
      if (oldOffset !== null) {
        const off = Math.min(
          slashPillCaretOffset(oldOffset, match.name),
          match.rest.length,
        )
        node.select(off, off)
      }
    })
    // namesKey nas deps (e commands por ref): o objeto muda de identidade a
    // cada render; o que justifica revarrer é mudar o inventário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, namesKey])
  useEffect(() => {
    return editor.registerNodeTransform(ComposerMentionNode, (node) => {
      if (node.getTrigger() !== SLASH_TRIGGER) return
      if ($isAtComposerStart(node)) return
      node.replace($createTextNode(node.getTextContent()))
    })
  }, [editor])
  return null
}

/** Avisa o dono se há pill "/" (com ele, o popover não reabre). Por update
 *  listener porque a conversão texto→pill não muda o texto serializado, e o
 *  OnChange deduplica por texto. */
function SlashPillPresencePlugin({
  onPresence,
}: {
  onPresence?: (present: boolean) => void
}) {
  const [editor] = useLexicalComposerContext()
  const cbRef = useRef(onPresence)
  cbRef.current = onPresence
  const lastRef = useRef(false)
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      const present = editorState.read($hasLeadingSlashPill)
      if (present === lastRef.current) return
      lastRef.current = present
      cbRef.current?.(present)
    })
  }, [editor])
  return null
}

/** Texto antes e depois do caret, para a borda do histórico. O conteúdo é um
 *  parágrafo com LineBreakNode por "\n" (contrato do $setDraft); parágrafos
 *  extras de um paste contam como "\n". */
function $textAroundCaret(): { before: string; after: string } | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
  const anchor = selection.anchor
  const node = anchor.getNode()
  let before = ""
  let after = ""
  if ($isElementNode(node)) {
    // anchor num elemento: offset é índice de filho (parágrafo vazio, caret
    // entre nós). No root, cada filho é um parágrafo → conta como linha.
    const children = node.getChildren()
    const sep = $isRootNode(node) ? "\n" : ""
    before = children
      .slice(0, anchor.offset)
      .map((n) => n.getTextContent())
      .join(sep)
    after = children
      .slice(anchor.offset)
      .map((n) => n.getTextContent())
      .join(sep)
  } else {
    const text = node.getTextContent()
    before = text.slice(0, anchor.offset)
    after = text.slice(anchor.offset)
    for (let s = node.getPreviousSibling(); s; s = s.getPreviousSibling())
      before = s.getTextContent() + before
    for (let s = node.getNextSibling(); s; s = s.getNextSibling())
      after = after + s.getTextContent()
  }
  if (!$isRootNode(node)) {
    const top = node.getTopLevelElement()
    if (top?.getPreviousSibling()) before = "\n" + before
    if (top?.getNextSibling()) after = after + "\n"
  }
  return { before, after }
}

/** Histórico ↑/↓: só nas bordas (↑ na 1ª linha, ↓ na última), para não roubar
 *  a navegação multilinha (`historyRecallIntent`). Prioridade HIGH: perde para
 *  o menu "/" e cede ao menu de menção aberto. */
function HistoryRecallPlugin({ history }: { history?: HistoryBridge }) {
  const [editor] = useLexicalComposerContext()
  const historyRef = useRef(history)
  historyRef.current = history
  useEffect(() => {
    const recall =
      (key: "ArrowUp" | "ArrowDown") =>
      (event: KeyboardEvent): boolean => {
        const h = historyRef.current
        if (!h || event.isComposing) return false
        if (document.querySelector("[data-beautiful-mention-menu]")) return false
        const around = $textAroundCaret()
        if (!around) return false
        const intent = historyRecallIntent({
          key,
          before: around.before,
          after: around.after,
          canPrev: h.canPrev,
          navigating: h.navigating,
        })
        if (!intent) return false
        event.preventDefault()
        if (intent === "prev") h.recallPrev()
        else h.recallNext()
        return true
      }
    const unregister = [
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        recall("ArrowUp"),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        recall("ArrowDown"),
        COMMAND_PRIORITY_HIGH,
      ),
    ]
    return () => unregister.forEach((u) => u())
  }, [editor])
  return null
}

/** Paste: sempre texto puro (o composer serializa para string, e o HTML de um
 *  copy rico deixaria o negrito grudado no cursor). Arquivo anexável no
 *  clipboard vai para os anexos (`collectPaste`), e o texto que veio junto
 *  entra no caret. */
function PasteAttachmentsPlugin({
  onPasteFiles,
  totalImagens,
}: {
  onPasteFiles?: (files: File[]) => void
  totalImagens: number
}) {
  const [editor] = useLexicalComposerContext()
  const handlerRef = useRef(onPasteFiles)
  handlerRef.current = onPasteFiles
  const totalRef = useRef(totalImagens)
  totalRef.current = totalImagens
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent) || !event.clipboardData)
          return false
        // Captura síncrona antes de qualquer await (F21). O endereço `blob:` do
        // recurso que virou anexo já vem filtrado.
        const { files, text } = collectPaste(event.clipboardData)
        // nada aproveitável (nem texto, nem arquivo) → deixa o pipeline seguir.
        if (files.length === 0 && !text) return false
        event.preventDefault()
        if (files.length === 0 && virouPilula(text)) return true
        if (text) {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            // Zera a formatação da seleção antes de inserir.
            selection.format = 0
            // "\n" vira LineBreakNode no MESMO parágrafo (contrato do draft).
            text.split("\n").forEach((line, i) => {
              if (i > 0) selection.insertNodes([$createLineBreakNode()])
              if (line) selection.insertText(line)
            })
          }
        }
        // Imagem colada no meio de um texto vira ficha no cursor (G3), com o
        // número que ela vai ter. Mistura com PDF ou tipo não declarado vai
        // para a fileira: o número previsto poderia errar.
        const soImagens = files.length > 0 && files.every((f) => f.type.startsWith("image/"))
        const selection = $getSelection()
        if (soImagens && $getRoot().getTextContent().trim() && $isRangeSelection(selection)) {
          selection.insertNodes(files.map((_, i) => $createImagemNoTexto(totalRef.current + i + 1)))
        }
        if (files.length > 0) handlerRef.current?.(files)
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor])
  return null
}

/** Texto puro: engole ⌘B/⌘I/⌘U em prioridade alta para vencer o RichText. */
function PlainTextGuardPlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerCommand(
      FORMAT_TEXT_COMMAND,
      () => true,
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor])
  return null
}

/** Espelha o draft externo. `lastText` é o último texto que saiu do editor:
 *  valor diferente veio de fora (troca de conversa, sugestão, limpeza pós-
 *  envio) e reconstrói o conteúdo com o undo zerado, senão o ⌘Z traria texto
 *  de outra conversa. */
function DraftSyncPlugin({
  value,
  mentionNames,
  slashCommands,
  lastText,
  totalImagens,
}: {
  value: string
  mentionNames: string[]
  slashCommands?: readonly SlashPillCommand[]
  lastText: React.RefObject<string | null>
  totalImagens: number
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    if (value === lastText.current) return
    lastText.current = value
    editor.update(
      () => {
        $setDraft(value, mentionNames, slashCommands, totalImagens)
        // Focado (recall, "/", sugestão): caret no fim. Sem foco, não mexe na
        // seleção, para não roubar o foco de quem só trocou de conversa.
        const rootEl = editor.getRootElement()
        if (rootEl && rootEl.contains(document.activeElement)) {
          $getRoot().selectEnd()
        }
      },
      { discrete: true },
    )
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
    // As listas ficam fora das deps: só importam ao reconstruir, e mudar uma
    // lista não pode reescrever o que você está digitando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value, lastText])
  return null
}

/** Expõe o foco programático do editor pro dono (submit refoca, clique no
 *  cartão foca — paridade com o textareaRef.focus() do console). */
function FocusBridgePlugin({
  registerFocus,
}: {
  registerFocus?: (fn: () => void) => void
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    registerFocus?.(() => editor.focus())
  }, [editor, registerFocus])
  return null
}

const SEM_IMAGENS: readonly Attachment[] = []

export function LexicalComposer({
  value,
  onChangeText,
  onSubmit,
  onForceSubmit,
  onQueueSubmit,
  placeholder,
  mentionNames,
  mentionPersisted,
  mentionProjectRoot,
  mentionNotes,
  mentionTouched,
  onMentionValuesChange,
  className,
  registerFocus,
  slash,
  history,
  onPasteFiles,
  slashCommands,
  onSlashPill,
  imagens,
}: {
  /** Draft da conversa ativa (string com `@nome`) — fonte da verdade externa. */
  value: string
  /** Cada mudança no editor serializa e escreve aqui (vira o draft). */
  onChangeText: (text: string) => void
  /** Enter em repouso: recebe o texto serializado (menção → `@nome`). */
  onSubmit: (text: string) => void
  /** Enter com turno em voo: correção imediata, interrompe e retoma. */
  onForceSubmit?: (text: string) => void
  /** Tab com turno em voo: guarda para o próximo turno. */
  onQueueSubmit?: (text: string) => void
  placeholder: string
  /** Personas conhecidas (mesma fonte do marketplace) → itens do menu `@`. */
  mentionNames: string[]
  /** Pills já escolhidos: vocabulário local para restaurar o draft sem scan. */
  mentionPersisted?: string[]
  /** Raiz consultada por demanda somente quando a pessoa busca no `@`. */
  mentionProjectRoot?: string
  /** N5 — endereços das notas (`nota/slug`): entram sob "Notas" e, no envio, o
   *  endereço vira o conteúdo ATUAL da nota, emoldurado. */
  mentionNotes?: string[]
  /** N7 — caminhos que a conversa TOCOU: sobem no ranqueamento dentro da mesma
   *  classe de casamento. */
  mentionTouched?: ReadonlySet<string>
  onMentionValuesChange?: (values: string[]) => void
  /** Classes do box do input (as MESMAS do textarea, pra alinhar o cartão). */
  className?: string
  registerFocus?: (fn: () => void) => void
  /** FASE 2 — teclado do menu "/" (a lógica fica no useSlashCommands do dono). */
  slash?: SlashMenuBridge
  /** FASE 2 — recall ↑/↓ do histórico (usePromptHistory do dono). */
  history?: HistoryBridge
  /** FASE 2 — paste com File anexável roteia pra cá (useAttachments.addFiles). */
  onPasteFiles?: (files: File[]) => void
  /** Inventário "/" da conversa (o MESMO do useSlashCommands): vocabulário do
   *  pill atômico de comando — materialização do draft e conversão no espaço. */
  slashCommands?: readonly SlashPillCommand[]
  /** Presença do pill "/" no editor → o dono suprime o popover de comandos
   *  (a gramática é UM comando por mensagem, sempre no início). */
  onSlashPill?: (present: boolean) => void
  /** As imagens do rascunho, na ordem: "[imagem N]" vira ficha da N-ésima. */
  imagens?: readonly Attachment[]
}) {
  const imgs = imagens ?? SEM_IMAGENS
  // último texto emitido/recebido — evita loop OnChange ↔ DraftSync.
  const lastText = useRef<string | null>(null)
  const lastMentions = useRef("")
  // Só o conjunto quente fica local. O restante vem da busca por demanda.
  const localFiles = useMemo(
    () => [...new Set([...(mentionPersisted ?? []), ...(mentionTouched ?? [])])],
    [mentionPersisted, mentionTouched],
  )
  // Nomes por CONTEÚDO: por identidade, cada delta de texto recriava
  // `onSearch`, a lib zerava os resultados num efeito, e o commit extra por
  // delta acabava estourando o limite de updates do React (ADR-190).
  const nomesChave = mentionNames.join("\n")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nomes = useMemo(() => mentionNames, [nomesChave])
  const atItems = useMemo(
    () => buildLexicalAtItems(nomes, localFiles, mentionNotes ?? []),
    [nomes, localFiles, mentionNotes],
  )
  const buscarMencoes = useMentionSearch(atItems, mentionTouched, mentionProjectRoot)
  // Tudo que pode virar pill (persona OU caminho) — é o vocabulário que o
  // DraftSync usa pra reconstruir `@x` do draft como menção atômica.
  const mentionValues = useMemo(() => atItems.map((i) => i.value), [atItems])

  const initialConfig = {
    namespace: "ChatComposer",
    theme: { beautifulMentions: mentionsTheme },
    // Pill "/" e menção "@" são a mesma classe de node; o
    // ComposerMentionComponent só muda o corpo do "/".
    nodes: [ComposerMentionNode, composerMentionReplacement, ImagemNoTextoNode],
    onError(error: Error) {
      // não engolir em silêncio, mas também não derrubar a conversa.
      console.error("[LexicalComposer]", error)
    },
  }

  return (
    <div className="relative">
      <ImagensDoRascunho.Provider value={imgs}>
      <LexicalComposerBase initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              // alvo estável p/ foco programático (tray://new-task) — mesmo
              // contrato do textarea do console.
              data-composer="console"
              aria-label="Mensagem"
              className={cn(
                "w-full overflow-y-auto break-words whitespace-pre-wrap text-foreground outline-none",
                className,
              )}
            />
          }
          placeholder={
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 overflow-hidden text-muted-foreground",
                className,
              )}
            >
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <BeautifulMentionsPlugin
          // `onSearch` no lugar de `items` (N7): quem filtra e ORDENA é o
          // `rankearMencoes`, não a busca por substring da lib.
          triggers={["@"]}
          onSearch={buscarMencoes}
          searchDelay={120}
          menuComponent={MentionsMenu}
          menuItemComponent={MentionsMenuItem}
          // paridade com o popover do textarea: mesmo teto de itens…
          menuItemLimit={MAX_POPOVER_ITEMS}
          // …e query que atravessa `/` `.` `_` (caminhos de arquivo).
          punctuation={AT_PUNCTUATION}
          // O menu mostra as duas listas canônicas (personas e arquivos), não
          // pills soltos do editor, que cairiam na seção errada sem `kind`.
          showCurrentMentionsAsSuggestions={false}
        />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState) => {
            const snapshot = editorState.read(() => ({
              text: $serializeDraft(),
              mentions: $mentionedValues(),
            }))
            const mentionsKey = snapshot.mentions.join("\0")
            if (mentionsKey !== lastMentions.current) {
              lastMentions.current = mentionsKey
              onMentionValuesChange?.(snapshot.mentions)
            }
            if (snapshot.text !== lastText.current) {
              lastText.current = snapshot.text
              onChangeText(snapshot.text)
            }
          }}
        />
        <ComposerSubmitKeys
          onSubmit={onSubmit}
          onForceSubmit={onForceSubmit}
          onQueueSubmit={onQueueSubmit}
        />
        <SlashMenuKeysPlugin slash={slash} />
        <HistoryRecallPlugin history={history} />
        <PasteAttachmentsPlugin onPasteFiles={onPasteFiles} totalImagens={imgs.length} />
        <PlainTextGuardPlugin />
        <SlashPillPlugin commands={slashCommands} />
        <SlashPillPresencePlugin onPresence={onSlashPill} />
        <DraftSyncPlugin
          value={value}
          mentionNames={mentionValues}
          slashCommands={slashCommands}
          lastText={lastText}
          totalImagens={imgs.length}
        />
        <FocusBridgePlugin registerFocus={registerFocus} />
        <ImagemNoTextoPlugin total={imgs.length} />
      </LexicalComposerBase>
      </ImagensDoRascunho.Provider>
    </div>
  )
}
