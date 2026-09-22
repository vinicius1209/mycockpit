// Caminhos de arquivo citados em comandos de shell de uma conversa.
//
// Visto em 22/09/2026: o agente editou `app/src-tauri/src/AGENTS.md` por um
// script dentro do `Bash` (`python3 - <<'EOF' p='app/src-tauri/src/AGENTS.md'`),
// e o clique em "`AGENTS.md`" no fio não sabia qual dos quatro abrir: para a
// Frota, só Read/Edit/Write "tocam" arquivo.
//
// Texto livre de shell erra fácil, então este extrator é DESEMPATE, nunca
// fonte: o clique só usa o que sair daqui para escolher entre candidatos que o
// índice do projeto já confirmou existir (`abrirMencaoDeArquivo`). E só conta
// token com pasta: nome solto (`AGENTS.md` dentro de um comentário) não diz
// qual pasta, que é justamente a dúvida.

/** Separa o comando em trechos na ordem em que rodam. */
const SEPARADOR = /&&|\|\||;|\||\n/

/** Aspas simples ou duplas, ou palavra solta sem metacaractere de shell. */
const TOKEN = /(["'])([^"'\n]+?)\1|([^\s"'<>|;&()=`]+)/g

/** Parece caminho de arquivo: tem pasta e termina em algo com nome. */
const PARECE_CAMINHO = /^[\w@~.-][\w@~.\/-]*\/[\w@.-]+$/

function normalizar(partes: string[]): string[] | null {
  const out: string[] = []
  for (const parte of partes) {
    if (!parte || parte === ".") continue
    if (parte === "..") {
      if (!out.length) return null
      out.pop()
      continue
    }
    out.push(parte)
  }
  return out
}

/** Relativo à raiz do projeto, ou null se cair fora dela. */
function relativoAoProjeto(caminho: string, pastaAtual: string, raiz: string): string | null {
  const absoluto = caminho.startsWith("/") ? caminho : `${pastaAtual}/${caminho}`
  const partes = normalizar(absoluto.split("/"))
  if (!partes) return null
  const limpo = `/${partes.join("/")}`
  if (!limpo.startsWith(`${raiz}/`)) return null
  return limpo.slice(raiz.length + 1)
}

/**
 * Os caminhos (relativos ao projeto) que um comando cita. `cd <pasta>` muda a
 * base dos relativos que vêm depois dele no mesmo comando; sem `cd`, a base é
 * a raiz do projeto. Puro.
 */
export function caminhosEmComando(comando: string, projectPath: string): string[] {
  const raiz = projectPath.replace(/\/+$/, "")
  let pastaAtual = raiz
  const out: string[] = []
  for (const trecho of comando.split(SEPARADOR)) {
    const cd = trecho.match(/^\s*cd\s+(["']?)([^"'\s]+)\1\s*$/)
    if (cd) {
      const destino = cd[2].startsWith("/") ? cd[2] : `${pastaAtual}/${cd[2]}`
      const partes = normalizar(destino.split("/"))
      pastaAtual = partes ? `/${partes.join("/")}` : pastaAtual
      continue
    }
    for (const m of trecho.matchAll(TOKEN)) {
      const token = (m[2] ?? m[3] ?? "").trim()
      if (!PARECE_CAMINHO.test(token) || token.includes("*")) continue
      const rel = relativoAoProjeto(token, pastaAtual, raiz)
      if (rel && !out.includes(rel)) out.push(rel)
    }
  }
  return out
}

/** Todos os caminhos citados nos comandos de shell de uma conversa. */
export function arquivosCitadosEmShell(
  items: readonly { kind: string; name?: string; input?: unknown }[],
  projectPath: string,
): Set<string> {
  const out = new Set<string>()
  for (const it of items) {
    if (it.kind !== "tool" || !it.input || typeof it.input !== "object") continue
    const comando = (it.input as Record<string, unknown>).command
    if (typeof comando !== "string" || !comando.trim()) continue
    for (const caminho of caminhosEmComando(comando, projectPath)) out.add(caminho)
  }
  return out
}
