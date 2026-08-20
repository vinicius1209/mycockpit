// Worktrees SOLTOS — os que o cockpit criou e ninguém mais reivindica.
//
// De onde isto vem: isolar era gesto deliberado (menu da conversa) até o fork
// passar a isolar sozinho. Criar automático sem recolher automático virou
// branch `mycockpit/*` acumulando na main tree sem ninguém saber.
// `store/chat/remove.ts` fechou a torneira; este módulo é o balde: o que já
// vazou, e o que fica quando o git segura trabalho não-commitado.
//
// Puro de propósito. Quem fala com o git é o comando Rust `list_worktrees`;
// quem sabe quais conversas existem é a store. Aqui só mora o CRUZAMENTO, que
// é a única parte com regra de negócio — e a única que dá pra testar sem repo.

/** Uma entrada como o Rust devolve (`list_worktrees`). */
export interface WorktreeEntry {
  branch: string
  /** Pasta checada nesse branch; `null` = só o branch sobrou. */
  path: string | null
  /** Commits que o branch tem e o HEAD não. */
  ownCommits: number
}

export interface LooseWorktree extends WorktreeEntry {
  /** Sem commit próprio: recolher não perde nada. Quando `false`, há trabalho
   *  que só existe ali, e a oferta de recolher não pode aparecer. */
  clean: boolean
}

/** Tira barra final: `/a/b` e `/a/b/` são a mesma pasta, e uma diferença de
 *  texto aqui viraria um worktree VIVO listado como solto (e oferecido pra
 *  recolher, que é o erro caro deste módulo). */
function normPath(p: string): string {
  return p.replace(/\/+$/, "")
}

/**
 * O que sobrou. `claimed` são os `worktreePath` das conversas que existem —
 * qualquer conversa, de qualquer projeto: uma conversa de outro projeto
 * apontando pra esta pasta ainda é alguém usando.
 *
 * Branch SEM pasta entra sempre: ninguém consegue reivindicar uma pasta que
 * não existe, e é exatamente essa a forma mais comum do vazamento (a pasta sai,
 * o branch fica).
 */
export function looseWorktrees(
  entries: readonly WorktreeEntry[],
  claimed: Iterable<string | null | undefined>,
): LooseWorktree[] {
  const usados = new Set<string>()
  for (const c of claimed) if (c) usados.add(normPath(c))
  return entries
    .filter((e) => !(e.path && usados.has(normPath(e.path))))
    .map((e) => ({ ...e, clean: e.ownCommits === 0 }))
}

/**
 * O que a linha do diálogo diz sobre uma entrada. Duas informações, nesta
 * ordem: se dá pra recolher, e por quê não quando não dá.
 *
 * "N commits" nunca vira "não dá pra apagar" seco: o número é o que deixa o
 * usuário decidir ir lá buscar o trabalho em vez de achar que travou.
 */
export function worktreeStatusText(w: LooseWorktree): string {
  const onde = w.path ? w.path : "pasta ausente"
  if (w.clean) return `${onde} · sem commit próprio`
  const n = w.ownCommits
  return `${onde} · ${n} commit${n === 1 ? "" : "s"} que só existe${n === 1 ? "" : "m"} aqui`
}
