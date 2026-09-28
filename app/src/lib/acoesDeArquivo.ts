// O catálogo único de gestos sobre arquivo e pasta (docs/explorador-de-arquivos-prd.md,
// D1): a árvore, a aba de arquivo e o chip do fio leem os mesmos itens e os
// mesmos rótulos. Regra pura, alvo → itens; quem executa é
// `components/common/executarAcaoDeArquivo.ts`.
//
// Item que não faz não existe (ADR-042): sem conversa não há onde citar, fora
// do app não há pasta para mostrar, sem mudança no git não há alterações.

import { projectFilePreviewKind } from "@/lib/projectFilePreview"

export type AlvoDeArquivo =
  /** `fora`: o caminho é absoluto, de fora da raiz (a aba pode ter um). */
  | { tipo: "arquivo"; rel: string; fora?: boolean }
  | { tipo: "pasta"; rel: string }
  | { tipo: "varios"; itens: readonly { rel: string; pasta: boolean }[] }

/** Onde o menu abre. A aba já é o arquivo aberto: não oferece "Abrir", e
 *  oferece "Mostrar na árvore". */
export type SuperficieDoMenu = "arvore" | "aba"

export interface RecursosDoArquivo {
  /** No app (Tauri): "Mostrar na pasta" e "Abrir no app padrão". */
  noApp: boolean
  /** Há conversa ativa para citar e para abrir ao lado. */
  conversa: boolean
  /** O cartão da conversa tem largura para um arquivo ao lado. */
  ladoCabe: boolean
  /** O arquivo tem mudança no git. */
  alterado: boolean
  /** A pasta está aberta na árvore. */
  expandida: boolean
}

export type AcaoDeArquivo =
  | "abrir"
  | "abrir-ao-lado"
  | "abrir-no-editor"
  | "abrir-no-app"
  | "citar"
  | "ver-alteracoes"
  | "copiar-nome"
  | "copiar-caminho-relativo"
  | "copiar-caminho-completo"
  | "copiar-caminhos"
  | "buscar-na-pasta"
  | "recolher-dentro"
  | "mostrar-na-arvore"
  | "mostrar-na-pasta"

export const DIVISOR_DE_ARQUIVO = "divisor" as const
export type LinhaDoMenuDeArquivo = AcaoDeArquivo | typeof DIVISOR_DE_ARQUIVO

export const ROTULOS_DE_ARQUIVO: Record<AcaoDeArquivo, string> = {
  abrir: "Abrir",
  "abrir-ao-lado": "Abrir ao lado da conversa",
  "abrir-no-editor": "Abrir no editor",
  "abrir-no-app": "Abrir no app padrão",
  citar: "Citar no composer",
  "ver-alteracoes": "Ver alterações",
  "copiar-nome": "Copiar nome",
  "copiar-caminho-relativo": "Copiar caminho relativo",
  "copiar-caminho-completo": "Copiar caminho completo",
  "copiar-caminhos": "Copiar caminhos",
  "buscar-na-pasta": "Buscar nesta pasta",
  "recolher-dentro": "Recolher tudo dentro",
  "mostrar-na-arvore": "Mostrar na árvore",
  "mostrar-na-pasta": "Mostrar na pasta",
}

/** O rótulo no alvo: citar diz o que vai citar. Puro. */
export function rotuloDaAcao(acao: AcaoDeArquivo, alvo: AlvoDeArquivo): string {
  if (acao === "citar") {
    if (alvo.tipo === "pasta") return "Citar a pasta no composer"
    if (alvo.tipo === "varios") return `Citar ${alvo.itens.length} itens no composer`
  }
  return ROTULOS_DE_ARQUIVO[acao]
}

/** O atalho que o menu mostra ao lado do item, quando a árvore o tem. */
export function atalhoDaAcao(acao: AcaoDeArquivo, mac: boolean): string | null {
  if (acao === "abrir") return "↵"
  if (acao === "citar") return mac ? "⌘↵" : "Ctrl ↵"
  return null
}

/** O que o visualizador da Frota não mostra como texto vai para o app padrão.
 *  O Rust confere a mesma coisa pela extensão. */
function vaiParaOApp(rel: string): boolean {
  return projectFilePreviewKind(rel) !== "code" && projectFilePreviewKind(rel) !== "markdown"
}

function limpa(linhas: (LinhaDoMenuDeArquivo | false)[]): LinhaDoMenuDeArquivo[] {
  const saida: LinhaDoMenuDeArquivo[] = []
  for (const l of linhas) {
    if (l === false) continue
    if (l === DIVISOR_DE_ARQUIVO && (saida.length === 0 || saida.at(-1) === DIVISOR_DE_ARQUIVO)) continue
    saida.push(l)
  }
  while (saida.at(-1) === DIVISOR_DE_ARQUIVO) saida.pop()
  return saida
}

/** A regra: alvo → itens. Puro. */
export function itensDoArquivo(
  alvo: AlvoDeArquivo,
  r: RecursosDoArquivo,
  onde: SuperficieDoMenu = "arvore",
): LinhaDoMenuDeArquivo[] {
  const d = DIVISOR_DE_ARQUIVO
  if (alvo.tipo === "varios") {
    return limpa([r.conversa && "citar", d, "copiar-caminhos"])
  }
  if (alvo.tipo === "pasta") {
    return limpa([
      r.conversa && "citar",
      d,
      onde === "arvore" && "buscar-na-pasta",
      onde === "arvore" && r.expandida && "recolher-dentro",
      d,
      "copiar-caminho-relativo",
      "copiar-caminho-completo",
      d,
      r.noApp && "mostrar-na-pasta",
    ])
  }
  const dentro = !alvo.fora
  return limpa([
    onde === "arvore" && "abrir",
    onde === "arvore" && r.conversa && r.ladoCabe && "abrir-ao-lado",
    "abrir-no-editor",
    r.noApp && dentro && vaiParaOApp(alvo.rel) && "abrir-no-app",
    d,
    r.conversa && "citar",
    dentro && r.alterado && "ver-alteracoes",
    d,
    "copiar-nome",
    dentro && "copiar-caminho-relativo",
    "copiar-caminho-completo",
    d,
    onde === "aba" && dentro && "mostrar-na-arvore",
    r.noApp && "mostrar-na-pasta",
  ])
}
