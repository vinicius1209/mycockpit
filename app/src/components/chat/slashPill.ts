// Pill atômico do comando "/" no composer Lexical (irmão do pill de menção,
// ADR-027). A gramática do comando é "o input INTEIRO é `/nome [args]`"
// (parseSlashInvocation/slashQueryOf), então o pill só existe numa posição: o
// COMEÇO do editor — e só quando o nome casa EXATAMENTE com um comando do
// inventário do popover (fail-open: sem match, `/algo` segue texto normal).
//
// Este arquivo é a lógica PURA (testável sem editor):
//   - `slashPillMatch` decide a conversão texto→pill (no gatilho: o whitespace
//     depois do nome, como a menção converte no espaço) e a re-materialização
//     de um draft/histórico restaurado que começa com "/nome ";
//   - `slashPillCaretOffset` remapeia o caret quando o "/nome" sai do texto;
//   - `slashPillSourceLabel` dá o rótulo do micro-chip de origem, o MESMO
//     primeiro chip do popover (commandBadges) — fonte única do rótulo.
//
// O contrato de serialização não muda: o pill devolve `/nome` literal no
// getTextContent (trigger "/" + value nome), então o value que sai do editor é
// byte-idêntico ao que o pipeline de send (expansão, builtin, fila, histórico)
// sempre recebeu.

import { commandBadges } from "@/lib/slashCommands"
import type { SlashCommand } from "@/lib/sources"

/** Trigger do pill de comando no editor (chave do tema e do node). */
export const SLASH_TRIGGER = "/"

/** O que o pill precisa saber de um comando (subconjunto do SlashCommand). */
export type SlashPillCommand = Pick<
  SlashCommand,
  "name" | "source" | "origin" | "kind"
>

/** Match PURO da conversão/re-materialização: o valor começa com "/nome"
 *  seguido de whitespace (espaço OU quebra de linha — args na linha de baixo
 *  também são invocação válida) e o nome casa EXATAMENTE (case-sensitive, como
 *  o insertCommand insere) com um comando do inventário. `rest` preserva o
 *  whitespace do gatilho — a serialização pill+rest é byte-idêntica ao valor. */
export function slashPillMatch(
  value: string,
  commandNames: readonly string[],
): { name: string; rest: string } | null {
  const m = value.match(/^\/([\w:-]+)\s/)
  if (!m) return null
  if (!commandNames.includes(m[1])) return null
  return { name: m[1], rest: value.slice(1 + m[1].length) }
}

/** Caret depois da conversão texto→pill: o prefixo "/nome" (1 + nome) saiu do
 *  nó de texto; um caret que estava dentro do prefixo colapsa pro começo. */
export function slashPillCaretOffset(oldOffset: number, name: string): number {
  return Math.max(0, oldOffset - (1 + name.length))
}

/** Rótulo do micro-chip de origem do pill: o PRIMEIRO chip do popover
 *  (commandBadges → source), pra origem exibida ser a mesma nas duas
 *  superfícies (app/mycockpit/claude/codex). */
export function slashPillSourceLabel(cmd: SlashPillCommand): string {
  return commandBadges(cmd)[0]
}
