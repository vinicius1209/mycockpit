// A porta do front para `edicao.rs` (docs/edicao-de-arquivos-spec.md §6, §7.1).
// Três comandos, e o salvar nunca lança: quem chama decide a tela.

import { invoke } from "@tauri-apps/api/core"

export type FimDeLinha = "lf" | "crlf"

export interface ArquivoEditavel {
  /** Sem BOM; fins de linha como estão no disco. */
  conteudo: string
  /** blake3 dos bytes crus: o que o salvar confere. */
  versao: string
  fimDeLinha: FimDeLinha
  bom: boolean
  gravavel: boolean
  /** Por que é só leitura, na língua da pessoa. */
  motivo: string | null
  /** Canônico (symlink e `~/` resolvidos): a identidade do arquivo. */
  caminhoAbsoluto: string
}

export type ErroAoSalvar =
  | { tipo: "conflito"; versao: string }
  | { tipo: "sumiu" }
  | { tipo: "fora-das-pastas" }
  | { tipo: "so-leitura"; motivo: string }
  | { tipo: "falhou"; detalhe: string }

export type ResultadoAoSalvar = { ok: true; versao: string } | { ok: false; erro: ErroAoSalvar }

export function abrirParaEdicao(root: string, path: string): Promise<ArquivoEditavel> {
  return invoke<ArquivoEditavel>("abrir_para_edicao", { root, path })
}

/** `null` quando o arquivo não está mais no disco. */
export function versaoNoDisco(root: string, path: string): Promise<string | null> {
  return invoke<string | null>("versao_no_disco", { root, path })
}

export async function salvarArquivo(a: {
  root: string
  path: string
  conteudo: string
  versaoEsperada: string
  fimDeLinha: FimDeLinha
  bom: boolean
}): Promise<ResultadoAoSalvar> {
  try {
    const versao = await invoke<string>("salvar_arquivo", a)
    return { ok: true, versao }
  } catch (e) {
    return { ok: false, erro: parseErroAoSalvar(e) }
  }
}

const texto = (v: unknown): string | null => (typeof v === "string" ? v : null)

/** O Rust manda `{ tipo, ... }`. Qualquer outra forma vira `falhou` com a
 *  mensagem crua: nunca some, nunca vira exceção (fail-open no render). */
export function parseErroAoSalvar(e: unknown): ErroAoSalvar {
  if (e && typeof e === "object" && "tipo" in e) {
    const o = e as Record<string, unknown>
    switch (o.tipo) {
      case "conflito":
        if (texto(o.versao)) return { tipo: "conflito", versao: o.versao as string }
        break
      case "sumiu":
        return { tipo: "sumiu" }
      case "fora-das-pastas":
        return { tipo: "fora-das-pastas" }
      case "so-leitura":
        return { tipo: "so-leitura", motivo: texto(o.motivo) ?? "Só leitura" }
      case "falhou":
        return { tipo: "falhou", detalhe: texto(o.detalhe) ?? "erro desconhecido" }
    }
  }
  if (e instanceof Error) return { tipo: "falhou", detalhe: e.message }
  return { tipo: "falhou", detalhe: typeof e === "string" ? e : JSON.stringify(e) ?? String(e) }
}

/** O detalhe de um erro que vai para o `avisar.erro`. */
export function detalheDoErro(erro: ErroAoSalvar): string {
  switch (erro.tipo) {
    case "conflito":
      return "O arquivo mudou no disco."
    case "sumiu":
      return "O arquivo não está mais no disco."
    case "fora-das-pastas":
      return "O arquivo está fora das pastas do projeto."
    case "so-leitura":
      return erro.motivo
    case "falhou":
      return erro.detalhe
  }
}
