// A IDENTIDADE DO TURNO — quem roda, com qual modelo, com quanto esforço.
//
// A regra estava espalhada em seis expressões dentro do CommandConsole, e ela
// não é óbvia: a identidade TRAVA no 1º envio da conversa (trocar de motor no
// meio é handoff, não seletor), e tem UMA saída de emergência (turno que falhou
// destrava o modelo, e só ele). Enquanto isso os estados crus dos seletores
// SOBREVIVEM à troca de conversa — de propósito, pro carimbo de uma conversa
// nova —, então ler o cru numa conversa travada mostraria o modelo de outra
// conversa. É esse o buraco que estas funções fecham num lugar só.
//
// Puro de propósito: o redesenho do composer vai mover esses controles de faixa
// (docs/mocks/composer-README.md §6 lista este arquivo entre os que mudam), e a
// regra tem de sobreviver à mudança de lugar.

import { DESTINATIONS, agentModels } from "@/lib/agents"

/** O que de fato vai no próximo run (nunca o estado cru dos seletores). */
export interface IdentidadeEfetiva {
  agent: string
  /** id do modelo, ou "default" (deixa o CLI escolher). */
  model: string
  /** nível de esforço, ou "default". */
  effort: string
  /** O humano ESCOLHEU outro modelo numa conversa travada cuja última tentativa
   *  falhou. Sem isto o despacho segue usando o modelo do 1º run. */
  trocouDeModelo: boolean
}

export interface EntradaDaIdentidade {
  /** A conversa já teve turno de executor (`hasExecutorTurn`). */
  travada: boolean
  /** O último turno de executor FALHOU e nada está em voo (`lastExecutorTurnFailed`). */
  modeloDestravado: boolean
  /** O modelo escolhido na saída de emergência (estado próprio, zerado ao trocar
   *  de conversa ou de agent). */
  escolhaDeEmergencia: string | null
  /** O que a conversa carimbou no 1º run. */
  conversa: { agent: string; reqModel: string | null; effort: string | null }
  /** O que os seletores mostram — estado local que SOBREVIVE à troca de conversa. */
  seletores: { agent: string; model: string; effort: string }
}

/**
 * A identidade efetiva do PRÓXIMO envio.
 *
 * Conversa nova: vale o que está nos seletores. Conversa estabelecida: vale o
 * que ela carimbou, e o seletor apenas reflete — é a diferença entre "escolher"
 * e "exibir estado", e confundir as duas foi o que fez o composer prometer um
 * modelo que o despacho ia descartar.
 *
 * A exceção é o MODELO depois de um turno que falhou: sem ela a conversa vira
 * um beco (slug inválido, modelo sem acesso, teto da conta → reenviar repete o
 * mesmo erro). O agent segue travado mesmo assim.
 */
export function identidadeEfetiva(e: EntradaDaIdentidade): IdentidadeEfetiva {
  if (!e.travada) {
    return {
      agent: e.seletores.agent,
      model: e.seletores.model,
      effort: e.seletores.effort,
      trocouDeModelo: false,
    }
  }
  const emergencia = e.modeloDestravado ? e.escolhaDeEmergencia : null
  return {
    agent: e.conversa.agent,
    model: emergencia ?? e.conversa.reqModel ?? "default",
    effort: e.conversa.effort ?? "default",
    trocouDeModelo: emergencia !== null,
  }
}

/**
 * O resumo colapsado da faixa de execução ("Claude Code · Opus 5 · xhigh").
 *
 * "default" NÃO vira texto: dizer "default" não informa nada que o nome do
 * agent já não diga, e o letreiro é o lugar de menor espaço e maior frequência
 * de leitura da tela. O `pill` do modelo ganha do `label` porque é a forma curta
 * (o label traz o sufixo explicativo, que é vocabulário de menu, não de faixa).
 */
export function resumoDaIdentidade(id: IdentidadeEfetiva): string {
  const dest = DESTINATIONS.find((d) => d.id === id.agent) ?? DESTINATIONS[0]
  const opcao = agentModels(id.agent).find((m) => m.value === id.model)
  return [
    dest.label,
    id.model !== "default" ? (opcao?.pill ?? opcao?.label ?? id.model) : null,
    id.effort !== "default" ? id.effort : null,
  ]
    .filter(Boolean)
    .join(" · ")
}
