// A APARÊNCIA da menção, dos dois lados: o PILL (o que fica escrito no
// composer) e o MENU (as opções). Vieram juntos do `LexicalComposer.tsx` pela
// catraca do §10, e ficam juntos porque são a mesma pergunta — como uma menção
// se parece.

export const mentionsTheme: BeautifulMentionsTheme = {
  "@": cn(
    "rounded bg-brass/[0.14] px-1 font-medium text-brass",
    "align-baseline transition-colors",
  ),
  "@Focused": cn(
    "rounded bg-brass/25 px-1 font-medium text-brass",
    "outline outline-1 outline-brass/50",
  ),
  // Pill do comando "/": mesma família do de menção (brass, mesmo raio/fundo),
  // distinguível pelo conteúdo — `/nome` em mono + micro-chip da origem
  // (renderizados pelo ComposerMentionComponent). Tokens do tema (brass,
  // muted-foreground, border) já resolvem claro/escuro.
  [SLASH_TRIGGER]: cn(
    "inline-flex items-baseline gap-1 rounded bg-brass/[0.14] px-1 text-brass",
    "align-baseline transition-colors",
  ),
  [`${SLASH_TRIGGER}Focused`]: cn(
    "inline-flex items-baseline gap-1 rounded bg-brass/25 px-1 text-brass",
    "outline outline-1 outline-brass/50",
  ),
}

/** Render dos pills. A menção "@" sai IDÊNTICA ao componente default da lib
 *  (span com a classe do tema + `@nome`); o comando "/" ganha o corpo próprio:
 *  `/nome` em mono + micro-chip da origem (o `data.source` que a criação do
 *  node gravou — mesmo rótulo do commandBadges do popover). A atomicidade
 *  (clique seleciona, backspace/delete removem inteiro, setas pulam) continua
 *  toda no MentionComponent da lib, que nos envolve. */
export function ComposerMentionComponent({
  trigger,
  value,
  data: _data,
  children,
  ...props
}: BeautifulMentionComponentProps<{ source?: string }>) {
  if (trigger !== SLASH_TRIGGER) {
    // Menção de NOTA: o pill mostra o nome, não o endereço — mesma razão do
    // menu. O que serializa no texto (e o que o envio resolve) segue sendo
    // `@nota/slug`; isto é só a tinta.
    if (value.startsWith(PREFIXO_NOTA)) {
      return <span {...props}>{`@${rotuloDaMencao(value)}`}</span>
    }
    if (value.startsWith(PREFIXO_CONVERSA)) {
      return <span {...props}>{`@${rotuloDaConversa(value)}`}</span>
    }
    // DOM igual ao default da lib: children é o `trigger+value` já pronto.
    return <span {...props}>{children}</span>
  }
  const source = _data?.source
  return (
    <span {...props}>
      <span className="font-mono">{`/${value}`}</span>
      {source ? (
        <span className="rounded border border-brass/30 px-1 py-px font-sans text-[11px] tracking-wide text-muted-foreground uppercase">
          {source}
        </span>
      ) : null}
    </span>
  )
}

/**
 * O MENU do "@" do composer: cabeçalho de seção, item com ícone e o
 * posicionamento fixo que a lib não faz.
 *
 * Separado do `LexicalComposer.tsx` pela catraca do §10, e o recorte é
 * fechado: aqui mora tudo que desenha as OPÇÕES; lá, o editor e os plugins.
 * A fronteira é o contrato do `lexical-beautiful-mentions`
 * (`menuComponent` / `menuItemComponent`).
 */

import { Children, isValidElement, useLayoutEffect, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { FileText, MessageSquare, StickyNote } from "lucide-react"
import { PREFIXO_CONVERSA, rotuloDaConversa } from "@/lib/conversaCitada"
import {
  SLASH_TRIGGER,
} from "@/components/chat/slashPill"
import type {
  BeautifulMentionComponentProps,
  BeautifulMentionsTheme,
} from "lexical-beautiful-mentions"
import { PREFIXO_NOTA, rotuloDaMencao } from "@/components/notes/noteMention"
import { usePresets } from "@/store/presets"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import { cn } from "@/lib/utils"

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
function childKind(child: React.ReactNode): "agent" | "file" | "nota" | "conversa" {
  if (!isValidElement(child)) return "agent"
  const item = (
    child.props as { item?: { data?: { kind?: unknown } } }
  ).item
  const kind = item?.data?.kind
  return kind === "file" || kind === "nota" || kind === "conversa" ? kind : "agent"
}

export function MentionsMenu({
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
                className="px-2 pt-1 pb-1 text-[11px] tracking-wide text-muted-foreground/80 uppercase"
              >
                {kind === "file"
                  ? "Arquivos"
                  : kind === "nota"
                    ? "Notas"
                    : kind === "conversa"
                      ? "Conversas"
                      : "Especialistas"}
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
export function MentionsMenuItem({
  selected,
  item,
  kind: _kind,
  ...props
}: {
  selected: boolean
  item: { value: string; data?: { kind?: "agent" | "file" | "nota" | "conversa" } }
  kind?: "agent" | "file" | "nota" | "conversa"
} & React.LiHTMLAttributes<HTMLLIElement>) {
  const isFile = item.data?.kind === "file"
  const isNota = item.data?.kind === "nota"
  const isConversa = item.data?.kind === "conversa"
  const def = usePresets((s) =>
    isFile || isNota || isConversa ? undefined : s.list.find((d) => d.name === item.value),
  )
  return (
    <li
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-left",
        selected ? "bg-accent" : "hover:bg-accent/50",
      )}
      {...props}
    >
      {isConversa ? (
        <MessageSquare className="size-[18px] shrink-0 text-muted-foreground/70" />
      ) : isNota ? (
        <StickyNote className="size-[18px] shrink-0 text-muted-foreground/70" />
      ) : isFile ? (
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
        {/* A nota aparece pelo NOME. O `nota/` é endereço — ele já está dito
            pelo cabeçalho "NOTAS" e pelo ícone, e repetido em cada linha vira
            ruído que empurra o que importa pra fora da largura. O valor
            serializado no texto continua sendo o endereço inteiro. */}
        {isNota ? rotuloDaMencao(item.value) : isConversa ? rotuloDaConversa(item.value) : item.value}
      </span>
    </li>
  )
}
