// Ponte draft (string) ↔ conteúdo Lexical do composer da conversa (FASE 1).
//
// A fonte da verdade do rascunho continua sendo a STRING por conversa em
// `useChat.drafts` (a mesma que o CommandConsole/textarea usa) — o editor
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

import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
} from "lexical"
import { $createBeautifulMentionNode } from "lexical-beautiful-mentions"
import { splitMentions } from "@/components/chat/mentions"

/** Token de uma linha do plano: texto puro ou uma menção conhecida (só o nome,
 *  sem o `@` — o pill recompõe o trigger). */
export type DraftToken =
  | { type: "text"; text: string }
  | { type: "mention"; name: string }

/** Uma linha do plano é uma sequência de tokens; `value` inteiro é a lista de
 *  linhas (separadas por `\n`, que vira LineBreakNode no editor). */
export type DraftPlan = DraftToken[][]

/** Lógica PURA: draft (string com `@nome`) → plano de tokens por linha.
 *  Reusa `splitMentions` (mesma regra do overlay e do render do fio) pra decidir
 *  o que é menção conhecida. Texto vazio de segmento é descartado (não vira nó
 *  de texto vazio). */
export function planDraft(value: string, mentionNames: string[]): DraftPlan {
  return value.split("\n").map((line) =>
    splitMentions(line, mentionNames).flatMap((seg): DraftToken[] => {
      if (seg.type === "mention") return [{ type: "mention", name: seg.name }]
      return seg.text ? [{ type: "text", text: seg.text }] : []
    }),
  )
}

/** Lógica PURA inversa: plano → string (menção → `@nome`, linha → `\n`). É o que
 *  `$serializeDraft` produz a partir dos nós, extraído pra testar o round-trip. */
export function serializePlan(plan: DraftPlan): string {
  return plan
    .map((line) =>
      line
        .map((t) => (t.type === "mention" ? `@${t.name}` : t.text))
        .join(""),
    )
    .join("\n")
}

/** Reconstrói o conteúdo do editor a partir do draft (string com `@nome`).
 *  Menções conhecidas viram pill atômico; `\n` vira quebra de linha dentro do
 *  MESMO parágrafo (paridade com o textarea, onde só existe "\n" — nunca
 *  parágrafo, que serializaria "\n\n"). */
export function $setDraft(value: string, mentionNames: string[]): void {
  const root = $getRoot()
  root.clear()
  const paragraph = $createParagraphNode()
  const plan = planDraft(value, mentionNames)
  plan.forEach((line, i) => {
    if (i > 0) paragraph.append($createLineBreakNode())
    for (const token of line) {
      if (token.type === "mention") {
        paragraph.append($createBeautifulMentionNode("@", token.name))
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
