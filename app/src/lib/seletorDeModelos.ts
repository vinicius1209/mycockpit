// O que a seção Modelos mostra, decidido FORA do JSX.
//
// A tela antiga respondia a pergunta errada. O subtítulo prometia "quais
// modelos entram no seletor dos agents" e a tela nunca listava os modelos do
// seletor: mostrava só EVENTOS (aposentou, entrou sozinho, espera você, não
// passou). Era o changelog, não o estado — você abria pra saber o que tem e
// saía sabendo o que mudou.
//
// A contagem que decidiu o formato, medida no catálogo real desta máquina:
// **27 modelos** (8 no Claude Code, 7 no Codex, 12 no Antigravity). Com 27,
// lista chapada é rolagem; por isso é um cartão por agent, fechado, com a
// contagem no cabeçalho.
//
// Este módulo existe pra que essas decisões tenham teste. Elas são pequenas e
// fáceis de errar em silêncio: casar a aposentadoria com o modelo certo, achar
// qual linha é o padrão, e saber quais linhas o humano pode remover.

import type { AgentModelOption } from "@/lib/curatedModels"
import type { ModelProposal, ModelRetirement } from "@/lib/modelLedger"

/** Uma linha do seletor de um agent, já com tudo que a UI precisa saber. */
export interface LinhaDoSeletor {
  value: string
  label: string
  description?: string
  /** É o modelo pré-selecionado deste agent. */
  padrao: boolean
  /** O fornecedor anunciou o fim. `sucessor` é o que ele indica no lugar. */
  aposentando: { sucessor: string | null } | null
  /** A proposta que colocou este modelo aqui — só ela pode ser removida.
   *  Modelo da lista curada não tem "tirar": ele não entrou por decisão sua. */
  removivelPor: ModelProposal | null
}

/** O seletor de UM agent, com o que o cabeçalho do cartão precisa. */
export interface SeletorDeAgente {
  agent: string
  linhas: LinhaDoSeletor[]
  /** Quantos modelos o fornecedor vai aposentar. Vira selo no cabeçalho, pra
   *  você ver sem abrir o cartão — é a única coisa aqui que muda decisão. */
  aposentando: number
}

/**
 * Monta o seletor de um agent.
 *
 * O casamento da aposentadoria é por **agent + value**, nunca só por value:
 * ids se repetem entre motores (`default` está nos três), e casar só pelo id
 * marcaria o `default` do Claude como aposentado porque o do Codex está.
 */
export function seletorDoAgente(
  agent: string,
  modelos: AgentModelOption[],
  padrao: string,
  aposentadorias: ModelRetirement[],
  propostas: ModelProposal[],
): SeletorDeAgente {
  const linhas = modelos.map((m) => {
    const ret = aposentadorias.find(
      (r) => r.agent === agent && r.value === m.value,
    )
    const prop = propostas.find(
      (p) => p.agent === agent && p.value === m.value && p.status === "active",
    )
    return {
      value: m.value,
      label: m.label,
      description: m.description,
      padrao: m.value === padrao,
      aposentando: ret ? { sucessor: ret.successor ?? null } : null,
      removivelPor: prop ?? null,
    }
  })
  return {
    agent,
    linhas,
    aposentando: linhas.filter((l) => l.aposentando).length,
  }
}

/** Total de modelos em todos os agents — o número do rótulo "No seu seletor". */
export function totalDeModelos(seletores: SeletorDeAgente[]): number {
  return seletores.reduce((n, s) => n + s.linhas.length, 0)
}

/** Um evento do histórico: o que mudou, quando, e em qual agent. */
export interface EventoDeModelo {
  chave: string
  agent: string
  quando: number
  texto: string
}

/**
 * O changelog, que sai da frente sem deixar de existir.
 *
 * Junta as quatro histórias com desfecho (entrou sozinho, você aprovou, foi
 * reprovado, o fornecedor vai aposentar) numa lista só, do mais novo pro mais
 * velho. As pendentes NÃO entram: elas não são histórico, são a fila.
 */
export function historicoDeModelos(
  propostas: ModelProposal[],
  aposentadorias: ModelRetirement[],
): EventoDeModelo[] {
  const eventos: EventoDeModelo[] = []
  for (const p of propostas) {
    if (p.status === "proposed") continue
    const texto =
      p.status === "rejected"
        ? `${p.value} não passou`
        : p.decidedBy === "app"
          ? `${p.value} entrou sozinho`
          : `você adicionou ${p.value}`
    eventos.push({
      chave: `p:${p.id}`,
      agent: p.agent,
      // `decidedAt` e 0 em linha antiga nunca redecidida: cai no createdAt,
      // que sempre existe. Zero na tela viraria "1970" no topo da lista.
      quando: p.decidedAt || p.createdAt,
      texto,
    })
  }
  for (const r of aposentadorias) {
    eventos.push({
      chave: `r:${r.agent}:${r.value}`,
      agent: r.agent,
      quando: r.seenAt,
      texto: r.successor
        ? `o fornecedor vai aposentar ${r.value}, e indica ${r.successor}`
        : `o fornecedor vai aposentar ${r.value}`,
    })
  }
  return eventos.sort((a, b) => b.quando - a.quando)
}
