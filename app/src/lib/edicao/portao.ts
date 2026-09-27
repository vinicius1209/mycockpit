// O portão de fechar aba (spec §9.1). Todo fechamento passa por
// `fecharArquivos`, e ele passa por aqui antes: aba suja que é a última cópia
// aberta daquele arquivo pergunta "Salvar, Não salvar, Cancelar".

import { perguntar } from "@/lib/confirm"
import { descartarArquivo, salvar, soltarDaConversa } from "@/lib/edicao/acoes"
import { caminhoDaAba, obter } from "@/lib/edicao/buffers"
import { planoDeFechamento, type Pergunta, type PlanoDeFechamento } from "@/lib/edicao/regras"
import { abasDo, useAbasDeArquivo } from "@/store/abasDeArquivo"
import { useEdicao } from "@/store/edicao"

const MAX_NOMES = 5

/** O texto da pergunta, para uma aba ou um lote. Puro. */
export function textoDaPergunta(perguntas: readonly Pergunta[]): {
  title: string
  description: string
  confirmLabel: string
} {
  if (perguntas.length === 1) {
    return {
      title: `Salvar as alterações em ${perguntas[0].nome}?`,
      description: "Se não salvar, o que você escreveu nesta aba se perde.",
      confirmLabel: "Salvar",
    }
  }
  const nomes = perguntas.slice(0, MAX_NOMES).map((p) => p.nome)
  const resto = perguntas.length - nomes.length
  return {
    title: `${perguntas.length} arquivos têm alterações não salvas`,
    description: `${nomes.join(", ")}${resto > 0 ? ` e mais ${resto}` : ""}.`,
    confirmLabel: `Salvar os ${perguntas.length}`,
  }
}

/** Quem fecha direto e quem pergunta. Síncrono: sem aba suja, o fechamento
 *  segue no mesmo tique, como sempre foi. */
export function planoDoPortao(
  convId: string,
  chaves: readonly string[],
  root: string | null,
): PlanoDeFechamento {
  if (!root) return { fechaDireto: [...chaves], perguntar: [] }
  return planoDeFechamento({
    chaves,
    convId,
    caminhoDe: (chave) => caminhoDaAba(root, chave) ?? null,
    sujos: useEdicao.getState().sujos,
    donos: (caminho) => obter(caminho)?.donos ?? new Map(),
    abertaEm: (conv, chave) => abasDo(useAbasDeArquivo.getState(), conv).abertas.includes(chave),
  })
}

/** Pergunta e cumpre a resposta. Devolve as chaves perguntadas que podem
 *  fechar: as que salvaram, se "Salvar"; todas, se "Não salvar". `null` se
 *  cancelou, e aí nada do lote fecha. Salvar que falhou não fecha: a faixa ou
 *  o aviso de erro explicam. */
export async function resolverPerguntas(plano: PlanoDeFechamento): Promise<string[] | null> {
  if (plano.perguntar.length === 0) return []
  const r = await perguntar({ ...textoDaPergunta(plano.perguntar), alternativa: "Não salvar" })
  if (r === "cancelar") return null
  const fecham: string[] = []
  for (const p of plano.perguntar) {
    if (r === "alternativa") {
      descartarArquivo(p.caminho)
      fecham.push(p.chave)
    } else if (await salvar(p.caminho)) {
      fecham.push(p.chave)
    }
  }
  return fecham
}

/** As abas fecharam: a conversa deixa de ser dona daqueles arquivos. */
export function soltarAsFechadas(convId: string, chaves: readonly string[], root: string | null): void {
  if (!root) return
  for (const chave of chaves) {
    const caminho = caminhoDaAba(root, chave)
    if (caminho) soltarDaConversa(caminho, convId)
  }
}
