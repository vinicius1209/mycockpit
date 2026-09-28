// Ponte draft (string) ↔ conteúdo Lexical do composer da conversa (FASE 1).
//
// A fonte da verdade do rascunho continua sendo a STRING por conversa em
// `useComposerDrafts` (a mesma que o CommandConsole usa) — o editor
// Lexical é uma view: serializa pra essa string a cada mudança e reconstrói
// a partir dela quando o valor muda por fora (troca de conversa, sugestão,
// limpeza pós-envio).
//
// Serialização: `getTextContent()` do root — o BeautifulMentionNode devolve
// `@nome` (trigger + value), então o texto que sai é EXATAMENTE o que o
// handleSend da conversa já espera hoje. Shift+Enter vira LineBreakNode → "\n".
//
// Reconstrução: `splitMentions` (a MESMA regra do overlay de destaque e do
// render do fio) decide o que é menção conhecida; só essas viram pill — o
// resto fica texto puro (um `@desconhecido` não vira chip fantasma).
//
// A lógica PURA (string → plano de tokens por linha, e plano → string) mora em
// `planDraft`/`serializePlan`, testáveis sem um editor. As funções com prefixo
// `$` só constroem/leem os nós Lexical a partir desse plano e por isso só rodam
// dentro de `editor.update()` / `editorState.read()`.

import { $createImagemNoTexto } from "@/components/chat/FichaDeImagem"
import { referencia, referencias } from "@/lib/imagemNoTexto"
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  type LexicalNode,
} from "lexical"
import {
  $createBeautifulMentionNode,
  $isBeautifulMentionNode,
} from "lexical-beautiful-mentions"
import { splitMentions } from "@/components/chat/mentions"
import {
  SLASH_TRIGGER,
  slashPillMatch,
  slashPillSourceLabel,
  type SlashPillCommand,
} from "@/components/chat/slashPill"

/** Token de uma linha do plano: texto puro, uma menção conhecida (só o nome,
 *  sem o `@` — o pill recompõe o trigger) ou o comando "/" do começo do input
 *  (só o nome, sem a barra — idem; no máximo UM por plano, sempre o primeiro
 *  token da primeira linha: a gramática é comando único no início). */
export type DraftToken =
  | { type: "text"; text: string }
  | { type: "mention"; name: string }
  | { type: "slash"; name: string }
  /** "[imagem N]" com N entre as imagens do rascunho (G3). */
  | { type: "imagem"; n: number }

/** Uma linha do plano é uma sequência de tokens; `value` inteiro é a lista de
 *  linhas (separadas por `\n`, que vira LineBreakNode no editor). */
export type DraftPlan = DraftToken[][]

/** Lógica PURA: draft (string com `@nome`) → plano de tokens por linha.
 *  Reusa `splitMentions` (mesma regra do overlay e do render do fio) pra decidir
 *  o que é menção conhecida. Texto vazio de segmento é descartado (não vira nó
 *  de texto vazio).
 *
 *  `slashCommandNames` (opcional): nomes do inventário "/" da conversa. Um
 *  draft que começa com "/nome " (nome com match EXATO, whitespace obrigatório
 *  — `slashPillMatch`) re-materializa o comando como token slash; o resto
 *  (inclusive o whitespace do gatilho) segue como texto. Sem inventário, ou
 *  sem match, nada muda (fail-open: comando que não existe mais fica texto). */
export function planDraft(
  value: string,
  mentionNames: string[],
  slashCommandNames?: readonly string[],
  totalImagens = 0,
): DraftPlan {
  let slashName: string | null = null
  let rest = value
  if (slashCommandNames && slashCommandNames.length > 0) {
    const match = slashPillMatch(value, slashCommandNames)
    if (match) {
      slashName = match.name
      rest = match.rest
    }
  }
  const plan = rest.split("\n").map((line) =>
    splitMentions(line, mentionNames).flatMap((seg): DraftToken[] => {
      if (seg.type === "mention") return [{ type: "mention", name: seg.name }]
      return seg.text ? comImagens(seg.text, totalImagens) : []
    }),
  )
  if (slashName) plan[0].unshift({ type: "slash", name: slashName })
  return plan
}

/** Texto → texto e fichas de imagem, pela mesma regra do Rust. Puro. */
function comImagens(texto: string, total: number): DraftToken[] {
  const out: DraftToken[] = []
  let desde = 0
  for (const r of referencias(texto, total)) {
    if (r.inicio > desde) out.push({ type: "text", text: texto.slice(desde, r.inicio) })
    out.push({ type: "imagem", n: r.n })
    desde = r.fim
  }
  if (desde < texto.length) out.push({ type: "text", text: texto.slice(desde) })
  return out
}

/** Lógica PURA inversa: plano → string (menção → `@nome`, linha → `\n`). É o que
 *  `$serializeDraft` produz a partir dos nós, extraído pra testar o round-trip. */
export function serializePlan(plan: DraftPlan): string {
  return plan
    .map((line) =>
      line
        .map((t) =>
          t.type === "mention"
            ? `@${t.name}`
            : t.type === "slash"
              ? `/${t.name}`
              : t.type === "imagem"
                ? referencia(t.n)
                : t.text,
        )
        .join(""),
    )
    .join("\n")
}

/** Reconstrói o conteúdo do editor a partir do draft (string com `@nome`).
 *  Menções conhecidas viram pill atômico; `\n` vira quebra de linha dentro do
 *  MESMO parágrafo (paridade com o textarea, onde só existe "\n" — nunca
 *  parágrafo, que serializaria "\n\n"). `slashCommands` (inventário "/" da
 *  conversa): um draft que começa com "/nome " conhecido re-materializa o
 *  comando como pill atômico (mesmo node de menção, trigger "/"), com a origem
 *  no `data` pro micro-chip do render. */
export function $setDraft(
  value: string,
  mentionNames: string[],
  slashCommands?: readonly SlashPillCommand[],
  totalImagens = 0,
): void {
  const root = $getRoot()
  root.clear()
  const paragraph = $createParagraphNode()
  const plan = planDraft(
    value,
    mentionNames,
    slashCommands?.map((c) => c.name),
    totalImagens,
  )
  plan.forEach((line, i) => {
    if (i > 0) paragraph.append($createLineBreakNode())
    for (const token of line) {
      if (token.type === "mention") {
        paragraph.append($createBeautifulMentionNode("@", token.name))
      } else if (token.type === "slash") {
        const cmd = slashCommands?.find((c) => c.name === token.name)
        paragraph.append(
          $createBeautifulMentionNode(SLASH_TRIGGER, token.name, {
            source: cmd ? slashPillSourceLabel(cmd) : "",
          }),
        )
      } else if (token.type === "imagem") {
        paragraph.append($createImagemNoTexto(token.n))
      } else {
        paragraph.append($createTextNode(token.text))
      }
    }
  })
  root.append(paragraph)
}

/** Serializa o conteúdo do editor pra string do draft: menção → `@nome`,
 *  quebra de linha → `\n`. É a string que vai pro `onSend` e pro rascunho. */
export function $serializeDraft(): string {
  return $getRoot().getTextContent()
}

/** Metadado durável dos pills `@` realmente selecionados. Ele permite
 * reconstruir um caminho depois do restart sem revarrer o projeto inteiro. */
export function $mentionedValues(): string[] {
  const values = new Set<string>()
  const visit = (node: LexicalNode) => {
    if ($isBeautifulMentionNode(node) && node.getTrigger() === "@") {
      values.add(node.getValue())
    }
    if ($isElementNode(node)) node.getChildren().forEach(visit)
  }
  visit($getRoot())
  return [...values]
}
