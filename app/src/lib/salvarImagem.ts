// "Salvar no projeto" do lightbox: a imagem do fio (captura de MCP, anexo,
// imagem gerada pelo motor) vira arquivo onde a pessoa escolher. A Frota nunca
// escreve no projeto sozinha; o diálogo do sistema é o gesto.
//
// O diálogo abre na última pasta usada NAQUELE projeto nesta sessão, senão na
// raiz dele. Memória de módulo de propósito: é conveniência, não preferência
// que mereça banco.

import { save } from "@tauri-apps/plugin-dialog"
import { avisar } from "@/lib/avisos"
import { saveConvImage } from "@/lib/evidence"

const ultimaPasta = new Map<string, string>()

/** Pasta de um caminho absoluto, sem tocar no disco. Puro. */
export function pastaDe(caminho: string): string {
  const i = caminho.lastIndexOf("/")
  return i > 0 ? caminho.slice(0, i) : "/"
}

/** Onde o diálogo começa: a última pasta deste projeto, a raiz dele, ou nada
 *  (o sistema decide). Puro. */
export function caminhoInicial(
  projeto: string | null,
  nome: string,
  memoria: ReadonlyMap<string, string> = ultimaPasta,
): string | undefined {
  if (!projeto) return undefined
  const pasta = memoria.get(projeto) ?? projeto
  return `${pasta.replace(/\/+$/, "")}/${nome}`
}

/** Abre o diálogo e copia. Cancelar não é erro; falhar diz o motivo. */
export async function salvarImagemDoFio(path: string, nome: string, projeto: string | null): Promise<void> {
  const destino = await save({ defaultPath: caminhoInicial(projeto, nome) })
  if (!destino) return
  try {
    await saveConvImage(path, destino)
    if (projeto) ultimaPasta.set(projeto, pastaDe(destino))
    avisar.feito(`Imagem salva em ${destino.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~")}`)
  } catch (e) {
    avisar.erro(`Não consegui salvar a imagem: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Só para os testes. */
export function _resetUltimaPasta(): void {
  ultimaPasta.clear()
}
