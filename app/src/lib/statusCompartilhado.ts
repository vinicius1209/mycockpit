// O `git status` de uma pasta, compartilhado entre a árvore de arquivos e as
// abas de arquivo: pedidos simultâneos da mesma pasta viram UMA chamada, e a
// última leitura (de quem for, inclusive da aba Alterações) fica em cache para
// quem chega depois (docs/explorador-de-arquivos-prd.md, 5b).

import { loadGitStatus, type GitFileItem, type GitStatus } from "@/lib/git"

const emVoo = new Map<string, Promise<GitStatus>>()
const ultima = new Map<string, GitStatus>()

/** Lê o status de `cwd`. Quem pede enquanto uma leitura está em voo recebe a
 *  mesma promessa. */
export function lerStatusDoGit(cwd: string): Promise<GitStatus> {
  const pendente = emVoo.get(cwd)
  if (pendente) return pendente
  const leitura = loadGitStatus(cwd)
    .then((s) => {
      ultima.set(cwd, s)
      return s
    })
    .finally(() => emVoo.delete(cwd))
  emVoo.set(cwd, leitura)
  return leitura
}

/** Quem lê por conta própria (a aba Alterações, que relê logo depois de uma
 *  ação sua e não pode pegar carona numa leitura de antes dela) publica aqui. */
export function publicarStatus(cwd: string, s: GitStatus): void {
  ultima.set(cwd, s)
}

export function statusEmCache(cwd: string): GitStatus | null {
  return ultima.get(cwd) ?? null
}

/** A letra da linha na árvore (D3): M modificado, A novo, U não rastreado,
 *  D apagado. */
export type LetraDoGit = "M" | "A" | "U" | "D"

const LETRA: Record<GitFileItem["status"], LetraDoGit> = {
  modified: "M",
  renamed: "M",
  added: "A",
  untracked: "U",
  deleted: "D",
}
/** Quando o arquivo está nas duas listas, a letra mais informativa vence. */
const PESO: Record<LetraDoGit, number> = { M: 0, D: 1, A: 2, U: 3 }

/** Caminho → letra, relativos ao repositório. Puro. */
export function caminhosAlterados(s: GitStatus | null): Map<string, LetraDoGit> {
  const saida = new Map<string, LetraDoGit>()
  if (!s?.isRepo) return saida
  for (const f of [...s.staged, ...s.unstaged]) {
    const letra = LETRA[f.status]
    const antes = saida.get(f.path)
    if (!antes || PESO[letra] > PESO[antes]) saida.set(f.path, letra)
  }
  return saida
}

/** As pastas que têm algum filho mudado, calculadas uma vez por status: a
 *  linha só consulta o conjunto. Puro. */
export function pastasComMudanca(alterados: ReadonlyMap<string, LetraDoGit>): Set<string> {
  const pastas = new Set<string>()
  for (const caminho of alterados.keys()) {
    const partes = caminho.split("/")
    for (let i = 1; i < partes.length; i++) pastas.add(partes.slice(0, i).join("/"))
  }
  return pastas
}
