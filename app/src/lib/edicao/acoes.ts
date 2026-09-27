// Os gestos sobre um arquivo em edição (spec §8): salvar, manter a minha
// versão, descartar, soltar a conversa. Vivem no bundle principal (nenhum
// runtime do CodeMirror aqui) porque o portão de fechar e a exclusão de
// conversa também os chamam. Recarregar do disco cria `EditorState`, então
// mora no editor.

import { avisar } from "@/lib/avisos"
import { detalheDoErro, salvarArquivo } from "@/lib/edicao/api"
import {
  buffersDaConversa,
  descartar,
  estadoAtual,
  obter,
  rebasear,
  soltarDono,
  type Buffer,
} from "@/lib/edicao/buffers"
import { estaSujo, nomeDoArquivo } from "@/lib/edicao/regras"
import { avisarGravacao } from "@/lib/sinaisDoDisco"
import { useEdicao } from "@/store/edicao"

/** O texto como vai para o disco: o CodeMirror guarda `\n` por dentro, e o
 *  arquivo CRLF volta CRLF (`sliceString` aceita o separador). */
export function textoParaODisco(b: Pick<Buffer, "fimDeLinha">, doc: { length: number; sliceString: (from: number, to?: number, sep?: string) => string }): string {
  return doc.sliceString(0, doc.length, b.fimDeLinha === "crlf" ? "\r\n" : "\n")
}

/** Salva. `true` só se gravou. Nunca salva sozinho: quem chama é gesto. */
export async function salvar(caminho: string): Promise<boolean> {
  const b = obter(caminho)
  const edicao = useEdicao.getState()
  if (!b || edicao.salvando[caminho]) return false
  if (!b.gravavel) {
    // O ⌘S não some calado: o gesto não aconteceu, e a nota diz por quê.
    avisar.nota(`${nomeDoArquivo(b.caminho)} é só leitura.`, { detalhe: b.motivo, id: `so-leitura:${caminho}` })
    return false
  }
  const doc = estadoAtual(b).doc
  edicao.marcarSalvando(caminho, true)
  const r = await salvarArquivo({
    root: b.root,
    path: b.caminho,
    conteudo: textoParaODisco(b, doc),
    versaoEsperada: b.versao,
    fimDeLinha: b.fimDeLinha,
    bom: b.bom,
  })
  edicao.marcarSalvando(caminho, false)
  const nome = nomeDoArquivo(b.caminho)
  if (r.ok) {
    rebasear(caminho, doc, r.versao)
    // Quem digitou enquanto gravava continua sujo: compara com o que foi.
    edicao.marcarSujo(caminho, estaSujo(estadoAtual(b).doc, doc))
    edicao.marcarAviso(caminho, null)
    avisarGravacao(b.root)
    return true
  }
  const erro = r.erro
  if (erro.tipo === "conflito") {
    b.versaoDoConflito = erro.versao
    edicao.marcarAviso(caminho, "conflito")
  } else if (erro.tipo === "sumiu") {
    edicao.marcarAviso(caminho, "sumiu")
  } else {
    avisar.erro(`Não consegui salvar ${nome}.`, { detalhe: detalheDoErro(erro) })
  }
  return false
}

/** "Manter a minha": a versão do disco vira a base da conferência, e o texto
 *  segue sujo. O próximo ⌘S grava por cima, agora por decisão. */
export function manterAMinha(caminho: string): void {
  const b = obter(caminho)
  if (!b || !b.versaoDoConflito) return
  b.versao = b.versaoDoConflito
  b.versaoDoConflito = null
  useEdicao.getState().marcarAviso(caminho, null)
}

/** Joga fora o texto não salvo e esquece o arquivo. */
export function descartarArquivo(caminho: string): void {
  descartar(caminho)
  useEdicao.getState().esquecer(caminho)
}

/** A conversa deixou de ter o arquivo aberto. Sem dono, o buffer sai; o
 *  portão de fechar já perguntou antes se havia texto a perder. */
export function soltarDaConversa(caminho: string, convId: string): void {
  if (soltarDono(caminho, convId).size === 0) descartarArquivo(caminho)
}

/** Arquivos sujos que só esta conversa tem: a exclusão dela os descarta. */
export function sujosSoDaConversa(convId: string): Buffer[] {
  const sujos = useEdicao.getState().sujos
  return buffersDaConversa(convId).filter((b) => b.donos.size === 1 && sujos[b.caminho])
}

/** A linha que a confirmação de apagar a conversa ganha, ou `null`. */
export function avisoDeSujosDaConversa(convId: string): string | null {
  const n = sujosSoDaConversa(convId).length
  if (n === 0) return null
  return n === 1
    ? "1 arquivo com alterações não salvas, aberto só nesta conversa, será descartado."
    : `${n} arquivos com alterações não salvas, abertos só nesta conversa, serão descartados.`
}

/** A conversa foi apagada: solta todos os buffers dela. */
export function soltarConversa(convId: string): void {
  for (const b of buffersDaConversa(convId)) soltarDaConversa(b.caminho, convId)
}
