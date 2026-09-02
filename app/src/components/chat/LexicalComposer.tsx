// Composer Lexical da conversa — desde o cutover, o ÚNICO composer do console
// (o textarea e o toggle de Settings foram aposentados). Entra pelo slot
// `input` do ComposerShell. O que ele entrega:
//   - texto com Enter=envia / Shift+Enter=quebra linha (semântica do console);
//   - `@` menção ATÔMICA (pill via lexical-beautiful-mentions) com o nosso
//     menu (AgentAvatar + nome, seção "Especialistas");
//   - draft por conversa: a fonte da verdade segue useComposerDrafts —
//     o editor serializa a cada mudança e reconstrói quando o valor muda por
//     fora (troca de conversa, sugestão, limpeza pós-envio);
//   - serialização = a MESMA string que o handleSend espera (menção → `@nome`),
//     via lexicalDraft.ts;
//   - alvo de foco `data-composer="console"` (tray://new-task e afins);
//   - comandos "/" (o SlashPopover/useSlashCommands do console — aqui só
//     chegam os gestos do teclado, via SlashMenuKeysPlugin), paste → anexo
//     (PASTE_COMMAND → useAttachments.addFiles) e histórico ↑/↓ estilo shell
//     nas bordas (usePromptHistory + historyRecallIntent). O "/comando"
//     escolhido no popover (ou digitado + espaço, com match exato) vira pill
//     ATÔMICO no INÍCIO do editor — mesmo mecanismo do pill de menção
//     (trigger "/"), serializando pro MESMO `/nome` literal (slashPill.ts).
//   - "@" de arquivos do projeto: os caminhos chegam por prop (`mentionFiles`,
//     a listagem do useAtMentions), viram pill atômico que serializa pra
//     `@caminho` e o menu agrupa Especialistas antes de Arquivos. Este arquivo
//     é carregado LAZY pelo console (React.lazy) — o grafo do Lexical fica
//     fora do chunk main.

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
import { $serializeDraft, $setDraft } from "@/components/chat/lexicalDraft"
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
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

// Tema da menção: chip brass no tema do app. As chaves casam o trigger (`@`);
// `Focused` aplica o estado selecionado do pill.
// Pontuação do matcher do "@" (FASE 3): o default da lib trata `.` `/` `_`
// como fim de token, o que cortaria a busca de caminho no primeiro separador
// (`@src/` pararia a query em "src"). Tira só esses três do conjunto — o resto
// segue delimitando, e o token do textarea (\S*) já aceitava os três.
const AT_PUNCTUATION = ",\\*\\?\\$\\|#{}\\(\\)\\^\\[\\]\\\\!%'\"~=<>:;"

// Node de menção com o NOSSO componente (pattern da lib): substitui o
// BeautifulMentionNode via node replacement — o $createBeautifulMentionNode
// (inclusive o do lexicalDraft) passa a instanciar esta classe.
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

/** Enter (sem shift) serializa e envia; Shift+Enter deixa o RichText quebrar
 *  linha. Registrado em prioridade ALTA pra vencer o insert-parágrafo padrão —
 *  por isso as duas guardas são load-bearing:
 *  - menu de menção aberto (o nosso MentionsMenu carrega
 *    `data-beautiful-mention-menu`) → o Enter escolhe o item, não envia;
 *  - IME compondo (acento/CJK) → o Enter confirma a composição, não envia. */
function EnterToSubmitPlugin({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [editor] = useLexicalComposerContext()
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  const shortcut = useApp((s) => s.settings.userPreferences?.composerSendShortcut ?? "enter")
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null): boolean => {
        if (event?.isComposing) return false
        if (document.querySelector("[data-beautiful-mention-menu]")) return false
        if (shortcut === "cmd-enter") {
          if (!event?.metaKey && !event?.ctrlKey) return false
        } else if (event?.shiftKey) {
          return false
        }
        event?.preventDefault()
        const text = editor.getEditorState().read($serializeDraft)
        onSubmitRef.current(text.trim())
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, shortcut])
  return null
}

/** Ponte do menu "/" de comandos: a LÓGICA (lista, filtro, inserção) mora no
 *  useSlashCommands do CommandConsole e o menu é o MESMO SlashPopover do
 *  textarea — aqui só chegam os gestos do teclado. */
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

/** Teclas do menu "/" — prioridade CRITICAL de propósito: com o popover aberto
 *  elas vencem o Enter-envia (HIGH) e a navegação normal do editor. Quando o
 *  menu está fechado, tudo devolve false e o fluxo segue intacto. As props
 *  entram por ref pra não re-registrar comandos a cada render do console. */
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

/** Pill de comando "/" — as duas transforms que mantêm o editor honesto:
 *
 *  1. CONVERSÃO no gatilho (TextNode): o texto na posição-início que vira
 *     "/nome<espaço>…" com match EXATO no inventário troca o prefixo pelo pill
 *     atômico (mesma conversão-no-espaço das menções). Cobre digitação manual,
 *     paste e o inventário que chega DEPOIS do draft (re-registrar a transform
 *     marca os nós como dirty e ela revarre o conteúdo existente). Sem match,
 *     texto segue texto (fail-open). Só a posição-início converte — "/" no
 *     meio nunca vira pill (a gramática é comando único no começo).
 *
 *  2. DEMOÇÃO (node do pill): pill que deixou de estar no início (usuário
 *     digitou/colou texto antes dele) volta a ser texto literal `/nome` —
 *     pill fora do início seria teatro: o pipeline trataria como texto.
 *
 *  As duas são mutuamente exclusivas (conversão exige início, demoção exige
 *  não-início), então não há loop. */
function SlashPillPlugin({
  commands,
}: {
  commands?: readonly SlashPillCommand[]
}) {
  const [editor] = useLexicalComposerContext()
  const commandsRef = useRef(commands)
  commandsRef.current = commands
  // re-registra quando o INVENTÁRIO muda (nomes): registerNodeTransform marca
  // os TextNodes como dirty, então um draft "/nome " restaurado antes do
  // inventário carregar materializa o pill assim que os comandos chegam.
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
      // caret ANTES da mutação: se estava neste nó, remapeia pro texto restante
      // (o prefixo "/nome" sai do nó de texto e vira o pill).
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
    // namesKey de propósito nas deps (e commands via ref): é a MUDANÇA do
    // inventário que justifica revarrer; o objeto commands muda de identidade
    // a cada render do console.
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

/** Sinal de presença do pill "/" pro dono (CommandConsole): com pill presente
 *  o popover de comandos não reabre (a mensagem já TEM o seu comando — a
 *  gramática é um por envio). Vai por update listener, não pelo OnChange: a
 *  conversão texto→pill não muda o texto serializado, então o OnChange (que
 *  deduplica por texto) não veria a transição. */
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

/** Texto antes/depois do caret (selection colapsada), pra decisão de borda do
 *  histórico. O conteúdo normal é UM parágrafo com LineBreakNode por "\n"
 *  (contrato do $setDraft), então basta varrer os irmãos do nó do anchor; se um
 *  paste criou mais parágrafos, os vizinhos contam como "\n" do lado deles. */
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

/** Histórico ↑/↓ estilo shell: recall SÓ nas bordas (↑ com o caret na 1ª
 *  linha, ↓ na última) pra não atrapalhar a navegação normal de multi-linha —
 *  a decisão é a `historyRecallIntent` pura do usePromptHistory. Prioridade
 *  HIGH: perde pro menu "/" (CRITICAL) e cede a vez ao menu de menção aberto
 *  (guarda explícita, as setas dele navegam o menu). */
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

/** Paste do console. Duas responsabilidades, um só handler:
 *  1. TEXTO PURO SEMPRE — o composer serializa pra string, então formatação
 *     (negrito/itálico que vêm no `text/html` de um copy rico) NÃO tem lugar
 *     aqui. O default do RichText importaria o HTML e o `bold` "grudaria" no
 *     cursor (todo texto novo sairia negrito). Colamos só o `text/plain` e
 *     zeramos o formato da seleção antes, então nada de formatação entra.
 *  2. Anexo — clipboard com File anexável (imagem/PDF, filtro compartilhado
 *     `collectPaste`) roteia pro fluxo de anexos do console (addFiles →
 *     chip); o texto que veio JUNTO entra no caret. Sem handler de arquivo
 *     (fora do Tauri / sem conversa), o texto ainda cola puro. */
function PasteAttachmentsPlugin({
  onPasteFiles,
}: {
  onPasteFiles?: (files: File[]) => void
}) {
  const [editor] = useLexicalComposerContext()
  const handlerRef = useRef(onPasteFiles)
  handlerRef.current = onPasteFiles
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent) || !event.clipboardData)
          return false
        // captura SÍNCRONA antes de qualquer await (F21). O texto já vem
        // filtrado: o endereço `blob:` do recurso que virou anexo não é prompt.
        const { files, text } = collectPaste(event.clipboardData)
        // nada aproveitável (nem texto, nem arquivo) → deixa o pipeline seguir.
        if (files.length === 0 && !text) return false
        event.preventDefault()
        if (text) {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            // zera negrito/itálico eventualmente grudado na seleção antes de
            // inserir — o texto colado sai sempre limpo.
            selection.format = 0
            // "\n" vira LineBreakNode no MESMO parágrafo (contrato do draft).
            text.split("\n").forEach((line, i) => {
              if (i > 0) selection.insertNodes([$createLineBreakNode()])
              if (line) selection.insertText(line)
            })
          }
        }
        if (files.length > 0) handlerRef.current?.(files)
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor])
  return null
}

/** O composer é TEXTO PURO — não há negrito/itálico/sublinhado. Engole o
 *  FORMAT_TEXT_COMMAND (⌘B/⌘I/⌘U) em prioridade ALTA pra vencer o RichText, então
 *  nem atalho de teclado consegue introduzir formatação (que o paste já barra). */
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

/** Mantém o editor espelhando o draft externo. `lastText` guarda o último
 *  texto que SAIU do editor (via OnChange) — se o valor externo divergir, foi
 *  mudança de fora (troca de conversa, sugestão, limpeza pós-envio) e o
 *  conteúdo é reconstruído, com o histórico de undo zerado (senão o ⌘Z traria
 *  de volta o texto de OUTRA conversa). */
function DraftSyncPlugin({
  value,
  mentionNames,
  slashCommands,
  lastText,
}: {
  value: string
  mentionNames: string[]
  slashCommands?: readonly SlashPillCommand[]
  lastText: React.RefObject<string | null>
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    if (value === lastText.current) return
    lastText.current = value
    editor.update(
      () => {
        $setDraft(value, mentionNames, slashCommands)
        // Reconstrução com o editor FOCADO (recall ↑/↓, escolha de "/",
        // sugestão): caret vai pro fim, como o setSelectionRange(len, len) do
        // textarea. Sem foco, não mexe na seleção (não roubar o foco de quem
        // só trocou de conversa).
        const rootEl = editor.getRootElement()
        if (rootEl && rootEl.contains(document.activeElement)) {
          $getRoot().selectEnd()
        }
      },
      { discrete: true },
    )
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
    // mentionNames e slashCommands de propósito FORA das deps: as listas só
    // importam na hora de reconstruir; mudar uma lista sozinha não deve
    // reescrever o que o usuário está digitando. (O inventário "/" que chega
    // depois do draft é coberto pela transform do SlashPillPlugin, que revarre
    // no re-registro.)
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

export function LexicalComposer({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  mentionNames,
  mentionFiles,
  mentionNotes,
  mentionTouched,
  className,
  registerFocus,
  slash,
  history,
  onPasteFiles,
  slashCommands,
  onSlashPill,
}: {
  /** Draft da conversa ativa (string com `@nome`) — fonte da verdade externa. */
  value: string
  /** Cada mudança no editor serializa e escreve aqui (vira o draft). */
  onChangeText: (text: string) => void
  /** Enter sem shift: recebe o texto serializado (menção → `@nome`). */
  onSubmit: (text: string) => void
  placeholder: string
  /** Personas conhecidas (mesma fonte do marketplace) → itens do menu `@`. */
  mentionNames: string[]
  /** FASE 3 — arquivos do projeto (a MESMA listagem do useAtMentions, via
   *  prop): entram no menu `@` sob "Arquivos" e viram pill `@caminho`. */
  mentionFiles?: string[]
  /** N5 — endereços das notas (`nota/slug`): entram sob "Notas" e, no envio, o
   *  endereço vira o conteúdo ATUAL da nota, emoldurado. */
  mentionNotes?: string[]
  /** N7 — caminhos que a conversa TOCOU: sobem no ranqueamento dentro da mesma
   *  classe de casamento. */
  mentionTouched?: ReadonlySet<string>
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
}) {
  // último texto emitido/recebido — evita loop OnChange ↔ DraftSync.
  const lastText = useRef<string | null>(null)
  // Itens do "@" (FASE 3): personas + arquivos do projeto, na ORDEM que o menu
  // agrupa (Especialistas antes de Arquivos, contíguos). A montagem é a pura
  // buildLexicalAtItems (mesma regra de exclusão do textarea); o `kind` viaja
  // como data do item e chega no menu/item pra separar seção e ícone.
  const atItems = useMemo(
    () => buildLexicalAtItems(mentionNames, mentionFiles ?? [], mentionNotes ?? []),
    [mentionNames, mentionFiles, mentionNotes],
  )
  const buscarMencoes = useMentionSearch(atItems, mentionTouched)
  // Tudo que pode virar pill (persona OU caminho) — é o vocabulário que o
  // DraftSync usa pra reconstruir `@x` do draft como menção atômica.
  const mentionValues = useMemo(() => atItems.map((i) => i.value), [atItems])

  const initialConfig = {
    namespace: "ChatComposer",
    theme: { beautifulMentions: mentionsTheme },
    // node custom + replacement (pattern da lib): o pill de comando "/" e o de
    // menção "@" são a MESMA classe de node, renderizada pelo
    // ComposerMentionComponent (que só muda o corpo do "/").
    nodes: [ComposerMentionNode, composerMentionReplacement],
    onError(error: Error) {
      // não engolir em silêncio, mas também não derrubar a conversa.
      console.error("[LexicalComposer]", error)
    },
  }

  return (
    <div className="relative">
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
          searchDelay={0}
          menuComponent={MentionsMenu}
          menuItemComponent={MentionsMenuItem}
          // paridade com o popover do textarea: mesmo teto de itens…
          menuItemLimit={MAX_POPOVER_ITEMS}
          // …e query que atravessa `/` `.` `_` (caminhos de arquivo).
          punctuation={AT_PUNCTUATION}
          // o menu mostra as DUAS listas canônicas (personas + arquivos), não
          // pills soltos do editor — que entrariam sem `kind` e cairiam na
          // seção errada (o textarea tampouco sugere o que já está no texto).
          showCurrentMentionsAsSuggestions={false}
        />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState) => {
            const text = editorState.read($serializeDraft)
            if (text === lastText.current) return
            lastText.current = text
            onChangeText(text)
          }}
        />
        <EnterToSubmitPlugin onSubmit={onSubmit} />
        <SlashMenuKeysPlugin slash={slash} />
        <HistoryRecallPlugin history={history} />
        <PasteAttachmentsPlugin onPasteFiles={onPasteFiles} />
        <PlainTextGuardPlugin />
        <SlashPillPlugin commands={slashCommands} />
        <SlashPillPresencePlugin onPresence={onSlashPill} />
        <DraftSyncPlugin
          value={value}
          mentionNames={mentionValues}
          slashCommands={slashCommands}
          lastText={lastText}
        />
        <FocusBridgePlugin registerFocus={registerFocus} />
      </LexicalComposerBase>
    </div>
  )
}
