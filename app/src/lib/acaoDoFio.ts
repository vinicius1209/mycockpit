// O que uma ação do fio fez com os arquivos, classificado UMA vez por item.
//
// Medido em 23/09/2026 na maior conversa real (1.194 itens, 611 ações): o
// histórico da aba Conversa levava ~8 ms por recálculo e a assinatura da aba
// Alterações ~34 ms ao abrir, quase tudo reclassificando cada ação com
// `presentTool` (expressões regulares) a cada token de streaming e a cada
// tique do relógio. O item do fio é imutável (o reducer troca o objeto quando
// o resultado chega), então a classificação pode morar num cache por
// identidade, compartilhado pelas duas abas.

import { presentTool } from "@/lib/toolview"
import type { ChatItem } from "@/store/chat"

type Acao = Extract<ChatItem, { kind: "tool" }>

export interface ClassificacaoDaAcao {
  /** Mudou (ou pode ter mudado) arquivo: a mesma régua do fio. */
  muda: boolean
  /** Caminho do arquivo escrito, quando é uma edição ou escrita. */
  caminho: string | null
  /** `git commit` no comando (conta só se a ação não falhou). */
  commitsNoComando: number
}

const CHAVES_DE_CAMINHO = ["file_path", "path", "filePath", "notebook_path"]
const cache = new WeakMap<Acao, ClassificacaoDaAcao>()

export function classificarAcao(item: Acao): ClassificacaoDaAcao {
  const pronto = cache.get(item)
  if (pronto) return pronto
  const view = presentTool(item.name || "x", item.input)
  const input = (item.input && typeof item.input === "object" ? item.input : {}) as Record<string, unknown>
  let caminho: string | null = null
  if (view.kind === "edit" || view.kind === "write") {
    for (const chave of CHAVES_DE_CAMINHO) {
      const v = input[chave]
      if (typeof v === "string" && v.trim()) {
        caminho = v.trim()
        break
      }
    }
    caminho ??= view.detail
  }
  const comando = typeof input.command === "string" ? input.command : ""
  const classificacao = {
    muda: view.category === "change",
    caminho,
    commitsNoComando: comando.match(/\bgit\s+commit\b(?![^;&|\n]*--dry-run)/g)?.length ?? 0,
  }
  cache.set(item, classificacao)
  return classificacao
}
