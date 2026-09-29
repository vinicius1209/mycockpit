import { sobAPasta } from "@/lib/frotaDir"

/** Regra ÚNICA de arquivo mencionável no "@": os `.md` das duas pastas de
 *  agents ficam fora (já entram como persona ou são contexto de code agent
 *  externo). */
export function isMentionableFile(f: string): boolean {
  return !f.startsWith(".claude/agents/") && !sobAPasta(f, "agents/")
}

/** Item de menção do composer (editor Lexical): só valor + tipo (o menu
 *  resolve avatar por nome via usePresets; arquivo leva ícone). O `kind`
 *  viaja como data do item do beautiful-mentions e agrupa o menu
 *  (Especialistas antes de Arquivos). */
export type LexicalAtItem = { value: string; kind: "agent" | "file" | "nota" | "conversa" }

/** Montagem PURA dos itens locais do "@": personas primeiro, arquivos depois
 *  (contíguos — o menu insere o cabeçalho na troca de kind), arquivos passando
 *  pela regra de exclusão única. SEM slice: o filtro por query e o limite
 *  (MAX_POPOVER_ITEMS) ficam com o beautiful-mentions na hora de renderizar,
 *  senão cortar aqui esconderia arquivos da busca. */
export function buildLexicalAtItems(
  names: string[],
  files: string[],
  notas: string[] = [],
  conversas: string[] = [],
): LexicalAtItem[] {
  return [
    ...names.map((n) => ({ value: n, kind: "agent" as const })),
    // Notas ANTES dos arquivos: são poucas e são suas; a lista de arquivos do
    // projeto tem centenas e empurraria a nota pra fora da primeira tela do
    // menu (o corte por query e o teto de itens são do beautiful-mentions).
    ...notas.map((n) => ({ value: n, kind: "nota" as const })),
    // Conversas do projeto (ADR-287), também poucas e suas.
    ...conversas.map((c) => ({ value: c, kind: "conversa" as const })),
    ...files
      .filter(isMentionableFile)
      .map((f) => ({ value: f, kind: "file" as const })),
  ]
}
