// Composer Lexical da conversa (FASE 2 — paridade). Promovido do spike validado.
//
// É o INPUT do console (substitui o <Textarea> via slot `input` do
// ComposerShell quando Settings → Comportamento liga o "Composer Lexical").
// O que ele entrega:
//   - texto com Enter=envia / Shift+Enter=quebra linha (semântica do console);
//   - `@` menção ATÔMICA (pill via lexical-beautiful-mentions) com o nosso
//     menu (AgentAvatar + nome, seção "Especialistas");
//   - draft por conversa: a fonte da verdade segue a string em useChat.drafts —
//     o editor serializa a cada mudança e reconstrói quando o valor muda por
//     fora (troca de conversa, sugestão, limpeza pós-envio);
//   - serialização = a MESMA string que o handleSend espera (menção → `@nome`),
//     via lexicalDraft.ts;
//   - alvo de foco `data-composer="console"` (tray://new-task e afins);
//   - FASE 2: comandos "/" (o MESMO SlashPopover/useSlashCommands do console —
//     aqui só chegam os gestos do teclado, via SlashMenuKeysPlugin), paste →
//     anexo (PASTE_COMMAND → useAttachments.addFiles) e histórico ↑/↓ estilo
//     shell nas bordas (usePromptHistory + historyRecallIntent). O "/comando"
//     é TEXTO normal, não pill — só a menção é atômica.
//   - FASE 3: "@" de arquivos do projeto (paridade com o AtPopover do
//     textarea): os caminhos chegam por prop (`mentionFiles`, a MESMA listagem
//     do useAtMentions), viram pill atômico que serializa pra `@caminho` e o
//     menu agrupa Especialistas antes de Arquivos. Este arquivo também é
//     carregado LAZY pelo console (React.lazy) — o chunk do Lexical só baixa
//     quando o toggle liga o motor.
//
// Falta (passo final, com o usuário): virar o default e aposentar o textarea.

import {
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { LexicalComposer as LexicalComposerBase } from "@lexical/react/LexicalComposer"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createLineBreakNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
} from "lexical"
import {
  BeautifulMentionsPlugin,
  BeautifulMentionNode,
  type BeautifulMentionsTheme,
} from "lexical-beautiful-mentions"
import { FileText } from "lucide-react"
import { $serializeDraft, $setDraft } from "@/components/chat/lexicalDraft"
import { historyRecallIntent } from "@/hooks/usePromptHistory"
import { collectPastedFiles } from "@/hooks/useAttachments"
import { buildLexicalAtItems } from "@/hooks/useAtMentions"
import { MAX_POPOVER_ITEMS } from "@/hooks/useSlashCommands"
import { usePresets } from "@/store/presets"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import { cn } from "@/lib/utils"

// Tema da menção: chip brass no tema do app. As chaves casam o trigger (`@`);
// `Focused` aplica o estado selecionado do pill.
// Pontuação do matcher do "@" (FASE 3): o default da lib trata `.` `/` `_`
// como fim de token, o que cortaria a busca de caminho no primeiro separador
// (`@src/` pararia a query em "src"). Tira só esses três do conjunto — o resto
// segue delimitando, e o token do textarea (\S*) já aceitava os três.
const AT_PUNCTUATION = ",\\*\\?\\$\\|#{}\\(\\)\\^\\[\\]\\\\!%'\"~=<>:;"

const mentionsTheme: BeautifulMentionsTheme = {
  "@": cn(
    "rounded bg-brass/[0.14] px-1 font-medium text-brass",
    "align-baseline transition-colors",
  ),
  "@Focused": cn(
    "rounded bg-brass/25 px-1 font-medium text-brass",
    "outline outline-1 outline-brass/50",
  ),
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
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null): boolean => {
        if (event?.isComposing) return false
        if (document.querySelector("[data-beautiful-mention-menu]")) return false
        if (event?.shiftKey) return false
        event?.preventDefault()
        const text = editor.getEditorState().read($serializeDraft)
        onSubmitRef.current(text.trim())
        editor.update(() => {
          $getRoot().clear()
        })
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor])
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

/** Paste → anexo: clipboard com File anexável (imagem/PDF, filtro compartilhado
 *  `collectPastedFiles`) roteia pro fluxo de anexos do console (addFiles → chip)
 *  e o texto que veio JUNTO entra no caret (paridade com o F20 do textarea).
 *  Paste de texto puro devolve false e segue no pipeline normal do RichText.
 *  Sem handler (fora do Tauri / sem conversa) idem — o default fica de pé. */
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
        const handler = handlerRef.current
        if (!handler) return false
        if (!(event instanceof ClipboardEvent) || !event.clipboardData)
          return false
        // captura SÍNCRONA antes de qualquer await (F21) — depois esvazia.
        const files = collectPastedFiles(event.clipboardData)
        if (files.length === 0) return false
        event.preventDefault()
        const text = event.clipboardData.getData("text/plain")
        if (text) {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            // "\n" vira LineBreakNode no MESMO parágrafo (contrato do draft).
            text.split("\n").forEach((line, i) => {
              if (i > 0) selection.insertNodes([$createLineBreakNode()])
              if (line) selection.insertText(line)
            })
          }
        }
        handler(files)
        return true
      },
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
  lastText,
}: {
  value: string
  mentionNames: string[]
  lastText: React.RefObject<string | null>
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    if (value === lastText.current) return
    lastText.current = value
    editor.update(
      () => {
        $setDraft(value, mentionNames)
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
    // mentionNames de propósito FORA das deps: a lista só importa na hora de
    // reconstruir; mudar a lista sozinha não deve reescrever o que o usuário
    // está digitando.
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
  className,
  registerFocus,
  slash,
  history,
  onPasteFiles,
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
  /** Classes do box do input (as MESMAS do textarea, pra alinhar o cartão). */
  className?: string
  registerFocus?: (fn: () => void) => void
  /** FASE 2 — teclado do menu "/" (a lógica fica no useSlashCommands do dono). */
  slash?: SlashMenuBridge
  /** FASE 2 — recall ↑/↓ do histórico (usePromptHistory do dono). */
  history?: HistoryBridge
  /** FASE 2 — paste com File anexável roteia pra cá (useAttachments.addFiles). */
  onPasteFiles?: (files: File[]) => void
}) {
  // último texto emitido/recebido — evita loop OnChange ↔ DraftSync.
  const lastText = useRef<string | null>(null)
  // Itens do "@" (FASE 3): personas + arquivos do projeto, na ORDEM que o menu
  // agrupa (Especialistas antes de Arquivos, contíguos). A montagem é a pura
  // buildLexicalAtItems (mesma regra de exclusão do textarea); o `kind` viaja
  // como data do item e chega no menu/item pra separar seção e ícone.
  const atItems = useMemo(
    () => buildLexicalAtItems(mentionNames, mentionFiles ?? []),
    [mentionNames, mentionFiles],
  )
  const mentionItems = useMemo(() => ({ "@": atItems }), [atItems])
  // Tudo que pode virar pill (persona OU caminho) — é o vocabulário que o
  // DraftSync usa pra reconstruir `@x` do draft como menção atômica.
  const mentionValues = useMemo(() => atItems.map((i) => i.value), [atItems])

  const initialConfig = {
    namespace: "ChatComposer",
    theme: { beautifulMentions: mentionsTheme },
    nodes: [BeautifulMentionNode],
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
          items={mentionItems}
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
        <DraftSyncPlugin
          value={value}
          mentionNames={mentionValues}
          lastText={lastText}
        />
        <FocusBridgePlugin registerFocus={registerFocus} />
      </LexicalComposerBase>
    </div>
  )
}

// Menu de sugestões no NOSSO padrão (mesmo visual do AtPopover, ComposerParts):
// card popover da casa + cabeçalho de seção "Especialistas" + itens avatar+nome
// (sem o "@" na frente, o gatilho já foi digitado).
//
// POSICIONAMENTO — o certo, não o hack CSS: a lib (LexicalTypeaheadMenuPlugin)
// porta este menu num container `position:absolute` colado ao CURSOR e anexado
// ao <body>. O flip-pra-cima nativo dela só dispara quando há espaço acima
// DENTRO do editor root — e o nosso root é um input de UMA linha, então nunca
// flipa e o menu cairia fora da viewport (o composer vive no rodapé). Em vez de
// brigar com o anchor por-cursor, ancoramos ao COMPOSER como o AtPopover: um
// painel `position:fixed` medido a partir do rect do editor (getRootElement),
// aberto SEMPRE pra cima (`bottom` acima do topo do input), alinhado à esquerda
// e com a largura do input. `fixed` ignora o container por-cursor da lib (que
// segue invisível), então não há dupla-deslocação nem gap.
//
// O atributo `data-beautiful-mention-menu` é a guarda do EnterToSubmitPlugin
// (menu aberto → Enter escolhe, não envia); não remover.
const MENU_GAP_PX = 8

/** Kind do item de um filho do menu (o plugin renderiza cada opção como
 *  <MentionsMenuItem item={{value, data}}> — o `kind` que pusemos no item viaja
 *  em `item.data`). Sem data → persona (itens antigos só-string). */
function childKind(child: React.ReactNode): "agent" | "file" {
  if (!isValidElement(child)) return "agent"
  const item = (
    child.props as { item?: { data?: { kind?: unknown } } }
  ).item
  return item?.data?.kind === "file" ? "file" : "agent"
}

function MentionsMenu({
  loading,
  children,
  ...props
}: {
  loading?: boolean
  children?: React.ReactNode
} & React.HTMLAttributes<HTMLUListElement>) {
  const [editor] = useLexicalComposerContext()
  const [pos, setPos] = useState<{
    left: number
    bottom: number
    width: number
  } | null>(null)

  useLayoutEffect(() => {
    const root = editor.getRootElement()
    if (!root) return
    const measure = () => {
      const r = root.getBoundingClientRect()
      setPos({
        left: r.left,
        // topo do input, subindo (bottom cresce a lista pra cima → colado).
        bottom: window.innerHeight - r.top + MENU_GAP_PX,
        width: r.width,
      })
    }
    measure()
    // o composer é fixo no rodapé (não rola com a conversa); só resize move o
    // input. ResizeObserver pega mudança de largura/altura do próprio input.
    window.addEventListener("resize", measure)
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => {
      window.removeEventListener("resize", measure)
      ro.disconnect()
    }
  }, [editor])

  return (
    <ul
      data-beautiful-mention-menu
      style={
        pos
          ? {
              position: "fixed",
              left: pos.left,
              bottom: pos.bottom,
              width: pos.width,
              // sobrescreve o `top` que a lib seta imperativamente no elemento.
              top: "auto",
              right: "auto",
            }
          : // antes da 1ª medida: fora da tela, evita flash colado ao cursor.
            { position: "fixed", visibility: "hidden", top: 0, left: 0 }
      }
      className="z-50 max-h-72 overflow-auto rounded-xl border bg-popover p-1 shadow-[var(--shadow-pop)]"
      {...props}
    >
      {loading ? (
        <li className="px-3 py-1.5 text-[12px] text-muted-foreground">
          Carregando…
        </li>
      ) : (
        // Cabeçalhos de seção como no AtPopover: os itens chegam agrupados
        // (personas primeiro, arquivos depois — ordem do buildLexicalAtItems,
        // que o filtro da lib preserva), então basta inserir o título quando o
        // kind muda de um filho pro outro.
        Children.toArray(children).flatMap((child, i, all) => {
          const kind = childKind(child)
          const header =
            i === 0 || childKind(all[i - 1]) !== kind ? (
              <li
                key={`h:${kind}`}
                aria-hidden
                className="px-2 pt-1 pb-1 text-[10px] tracking-wide text-muted-foreground/80 uppercase"
              >
                {kind === "file" ? "Arquivos" : "Especialistas"}
              </li>
            ) : null
          return header ? [header, child] : [child]
        })
      )}
    </ul>
  )
}

// Item: persona = avatar (resolvido pelo def, via usePresets por nome — mesma
// fonte única do marketplace) + nome; arquivo = ícone FileText + caminho em
// mono. Estilo idêntico ao item do AtPopover do textarea. O `kind` chega duas
// vezes (a lib espalha o data do item nas props) — destruturado pra não vazar
// como atributo no <li>.
function MentionsMenuItem({
  selected,
  item,
  kind: _kind,
  ...props
}: {
  selected: boolean
  item: { value: string; data?: { kind?: "agent" | "file" } }
  kind?: "agent" | "file"
} & React.LiHTMLAttributes<HTMLLIElement>) {
  const isFile = item.data?.kind === "file"
  const def = usePresets((s) =>
    isFile ? undefined : s.list.find((d) => d.name === item.value),
  )
  return (
    <li
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-left",
        selected ? "bg-accent" : "hover:bg-accent/50",
      )}
      {...props}
    >
      {isFile ? (
        <FileText className="size-[18px] shrink-0 text-muted-foreground/70" />
      ) : def ? (
        <AgentAvatar def={def} size={20} rounded />
      ) : (
        <span className="size-5 shrink-0 rounded-full bg-brass/20" />
      )}
      <span
        className={cn(
          "truncate",
          isFile
            ? "font-mono text-[12px] text-muted-foreground"
            : "text-[13px] font-medium text-foreground",
        )}
      >
        {item.value}
      </span>
    </li>
  )
}
