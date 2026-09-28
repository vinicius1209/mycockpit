// O que o cartão de hover da árvore diz de um caminho (docs/explorador-de-arquivos-prd.md,
// D2 e D2b). O Rust lê o disco (`detalhe_do_caminho`) e acha as ações nas
// conversas (`quem_alterou`); aqui ficam as regras puras: a linha de metadados
// e quem alterou, com a régua de alteração do fio.

import { invoke } from "@tauri-apps/api/core"
import { classificarAcao } from "@/lib/acaoDoFio"
import { fmtBytes } from "@/lib/format"
import { idadeCurta } from "@/lib/processos"
import type { ChatItem } from "@/store/chat"

export interface DetalheDoCaminho {
  tipo: "arquivo" | "pasta"
  bytes: number
  alteradoEm: number | null
  linhas: number | null
  link: string | null
}

export interface CandidatoDeAlteracao {
  conversaId: string
  titulo: string | null
  motor: string
  fonte: "carimbo" | "custo" | "vizinho" | "conversa"
  nome: string
  entrada: Record<string, unknown>
  quando: number
  terminou: number | null
}

export const lerDetalheDoCaminho = (root: string, rel: string) =>
  invoke<DetalheDoCaminho>("detalhe_do_caminho", { root, rel })
export const lerQuemAlterou = (projeto: string, rel: string) =>
  invoke<CandidatoDeAlteracao[]>("quem_alterou", { projeto, rel })

const TIPOS: Record<string, string> = {
  md: "Markdown", mdx: "Markdown", ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  mjs: "JavaScript", rs: "Rust", py: "Python", java: "Java", kt: "Kotlin", go: "Go", rb: "Ruby", swift: "Swift",
  json: "JSON", toml: "TOML", yaml: "YAML", yml: "YAML", html: "HTML", css: "CSS", sql: "SQL", sh: "Shell",
  png: "PNG", jpg: "JPEG", jpeg: "JPEG", gif: "GIF", webp: "WebP", svg: "SVG", pdf: "PDF", txt: "Texto",
}

/** "Markdown", "PNG", ou a extensão em maiúsculas. Puro. */
export function tipoDoArquivo(rel: string): string {
  const nome = rel.split("/").pop() ?? rel
  const ponto = nome.lastIndexOf(".")
  if (ponto <= 0) return "Arquivo"
  const ext = nome.slice(ponto + 1).toLowerCase()
  return TIPOS[ext] ?? ext.toUpperCase()
}

/** "há 3 min", "agora há pouco". Puro. */
export function haQuanto(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000))
  return s < 60 ? "agora há pouco" : `há ${idadeCurta(s)}`
}

/** A linha de metadados: "Markdown · 4.2 KB · 112 linhas · alterado há 2 min". Puro. */
export function metaDoArquivo(d: DetalheDoCaminho, rel: string, now: number, extra?: string | null): string {
  const partes = [tipoDoArquivo(rel), extra ?? null, fmtBytes(d.bytes)]
  if (d.linhas !== null) partes.push(`${d.linhas} linha${d.linhas === 1 ? "" : "s"}`)
  if (d.alteradoEm !== null) partes.push(`alterado ${haQuanto(d.alteradoEm, now)}`)
  return partes.filter(Boolean).join(" · ")
}

export interface LinhaDeQuemAlterou {
  conversaId: string
  titulo: string | null
  motor: string
  quando: number
  nesta: boolean
}

export interface QuemAlterou {
  /** O disco mudou depois da última alteração conhecida: você, um editor, o git. */
  fora: number | null
  linhas: LinhaDeQuemAlterou[]
  /** Conversas além das três mostradas. */
  mais: number
}

/** Folga entre o fim da ação e o `mtime` que ela mesma deixou no disco. */
const FOLGA_DA_ESCRITA = 2_000

/** O caminho da ação é este arquivo? Absoluto compara com a raiz; relativo,
 *  com o caminho da árvore. Uma cópia num worktree não é este arquivo. Puro. */
function ehOArquivo(caminho: string, root: string, rel: string): boolean {
  const limpo = caminho.replace(/^\.\//, "")
  if (limpo.startsWith("/")) return limpo === `${root.replace(/\/+$/, "")}/${rel}`
  return limpo === rel
}

/** Quem alterou, de qualquer conversa, com a régua do fio: só ação que muda
 *  arquivo e aponta para ESTE arquivo; leitura não conta. Uma linha por
 *  conversa, a mais recente primeiro. Puro. */
export function quemAlterou(
  candidatos: readonly CandidatoDeAlteracao[],
  o: { root: string; rel: string; conversaAtiva: string | null; alteradoEm: number | null },
): QuemAlterou {
  const porConversa = new Map<string, LinhaDeQuemAlterou & { fim: number }>()
  for (const c of candidatos) {
    const acao = { kind: "tool", id: "", name: c.nome, input: c.entrada } as Extract<ChatItem, { kind: "tool" }>
    const { muda, caminho } = classificarAcao(acao)
    if (!muda || !caminho || !ehOArquivo(caminho, o.root, o.rel)) continue
    const atual = porConversa.get(c.conversaId)
    if (atual && atual.quando >= c.quando) continue
    porConversa.set(c.conversaId, {
      conversaId: c.conversaId,
      titulo: c.titulo,
      motor: c.motor,
      quando: c.quando,
      nesta: c.conversaId === o.conversaAtiva,
      fim: c.terminou ?? c.quando,
    })
  }
  const todas = [...porConversa.values()].sort((a, b) => b.quando - a.quando)
  const ultima = todas[0]?.fim ?? null
  const fora = o.alteradoEm !== null && (ultima === null || o.alteradoEm > ultima + FOLGA_DA_ESCRITA) && todas.length > 0
    ? o.alteradoEm
    : null
  return {
    fora,
    linhas: todas.slice(0, 3).map(({ fim: _fim, ...l }) => l),
    mais: Math.max(0, todas.length - 3),
  }
}
