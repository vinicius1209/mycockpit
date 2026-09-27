// O texto em edição mora AQUI, num registro de módulo, e não num store
// (spec §7.2): o `EditorState` é grande e imutável, não pode causar render nem
// ir para o `persist`. O store `useEdicao` guarda só quem está sujo.
//
// Identidade: o caminho CANÔNICO que o Rust devolveu. O mesmo arquivo aberto em
// duas conversas é um buffer; o mesmo relativo em dois worktrees são dois.
//
// Só tipos do CodeMirror entram aqui (`import type`): este módulo vive no
// bundle principal, e o editor em si é carregado sob demanda.

import type { EditorState, Text } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { FimDeLinha } from "@/lib/edicao/api"

export interface Buffer {
  caminho: string
  root: string
  /** A chave da aba que abriu primeiro (relativa ao `root`, ou absoluta). */
  relativo: string
  /** O estado guardado enquanto não há editor montado. */
  estado: EditorState
  /** O editor montado agora, se houver. É a fonte do texto quando existe. */
  vista: EditorView | null
  /** O documento da última leitura ou gravação. Sujo = texto ≠ base. */
  base: Text
  versao: string
  fimDeLinha: FimDeLinha
  bom: boolean
  gravavel: boolean
  motivo: string | null
  /** A versão do disco que causou o conflito; "Manter a minha" a adota. */
  versaoDoConflito: string | null
  /** Conversa → a chave com que ela abriu este arquivo nesta sessão. */
  donos: Map<string, string>
}

const porCaminho = new Map<string, Buffer>()
/** `root\0chave` → caminho canônico. A aba só conhece o root e a chave. */
const porAba = new Map<string, string>()

const chaveDaAba = (root: string, chave: string) => `${root}\0${chave}`

export function obter(caminho: string): Buffer | undefined {
  return porCaminho.get(caminho)
}

export function caminhoDaAba(root: string, chave: string): string | undefined {
  return porAba.get(chaveDaAba(root, chave))
}

export function obterDaAba(root: string, chave: string): Buffer | undefined {
  const caminho = caminhoDaAba(root, chave)
  return caminho ? porCaminho.get(caminho) : undefined
}

/** Registra o buffer e o índice da aba que o abriu. Se o arquivo já tem buffer
 *  (aberto por outra chave), o existente vence e só o índice é acrescentado. */
export function registrar(b: Buffer, root: string, chave: string): Buffer {
  const existente = porCaminho.get(b.caminho)
  porAba.set(chaveDaAba(root, chave), b.caminho)
  if (existente) return existente
  porCaminho.set(b.caminho, b)
  return b
}

/** O estado atual: o do editor montado, ou o guardado. */
export function estadoAtual(b: Buffer): EditorState {
  return b.vista?.state ?? b.estado
}

export function textoAtual(b: Buffer): string {
  return estadoAtual(b).doc.toString()
}

export function guardarEstado(caminho: string, estado: EditorState): void {
  const b = porCaminho.get(caminho)
  if (b) b.estado = estado
}

/** O disco agora é `base`, na versão `versao` (depois de salvar ou recarregar). */
export function rebasear(caminho: string, base: Text, versao: string): void {
  const b = porCaminho.get(caminho)
  if (!b) return
  b.base = base
  b.versao = versao
  b.versaoDoConflito = null
}

export function descartar(caminho: string): void {
  porCaminho.delete(caminho)
  for (const [k, v] of porAba) if (v === caminho) porAba.delete(k)
}

export function adicionarDono(caminho: string, convId: string, chave: string): void {
  porCaminho.get(caminho)?.donos.set(convId, chave)
}

/** Tira a conversa dos donos. Devolve os donos que sobraram. */
export function soltarDono(caminho: string, convId: string): ReadonlyMap<string, string> {
  const b = porCaminho.get(caminho)
  if (!b) return new Map()
  b.donos.delete(convId)
  return b.donos
}

/** Os buffers em que a conversa é dona (para apagar a conversa). */
export function buffersDaConversa(convId: string): Buffer[] {
  return [...porCaminho.values()].filter((b) => b.donos.has(convId))
}

export function todos(): Buffer[] {
  return [...porCaminho.values()]
}

export function __resetParaTeste(): void {
  porCaminho.clear()
  porAba.clear()
}
