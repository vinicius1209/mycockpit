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
  /** O modelo escolhido DEPOIS do 1º envio (estado próprio, zerado ao trocar de
   *  conversa ou de agent). Antes de 23/08/2026 isto só valia como saída de
   *  emergência; hoje vale sempre — ver `identidadeEfetiva`. */
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
 * A exceção é o MODELO, e ela deixou de ser "de emergência" em 23/08/2026.
 *
 * O que mudou: trocar de modelo DENTRO do mesmo agent preserva a sessão. O
 * `--resume` continua valendo, o histórico continua no CLI, nada se perde — e é
 * o que Claude Code, Codex e agy deixam fazer no meio da conversa (`/model`). A
 * trava antiga era mais rígida que os motores que a gente orquestra, sem razão
 * técnica: ela só existia porque nasceu junto com a do AGENT, onde a razão é
 * real.
 *
 * A razão real (que continua valendo pro agent): trocar de MOTOR no meio não é
 * mudar um parâmetro, é HANDOFF. Cada CLI guarda a sessão dela por um id
 * próprio e nenhuma retoma a da outra, então o `beginTransplant` abre sessão
 * NOVA com recap + ponteiro pro histórico exportado. Um seletor sugere
 * reversibilidade barata; handoff não é reversível.
 *
 * O caso de emergência (turno que falhou) continua coberto — ele virou um
 * subcaso de "pode trocar quando não está em voo", não uma regra própria.
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
  // `modeloDestravado` hoje significa "não está em voo" (o motor não aceita
  // trocar o modelo de um processo que já subiu — a flag foi no spawn).
  const escolhido = e.modeloDestravado ? e.escolhaDeEmergencia : null
  return {
    agent: e.conversa.agent,
    model: escolhido ?? e.conversa.reqModel ?? "default",
    effort: e.conversa.effort ?? "default",
    trocouDeModelo: escolhido !== null,
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

/**
 * A linha que registra a troca de modelo NO FIO.
 *
 * Existe porque destravar a troca cria um risco novo: sem marca, o histórico
 * passa a MENTIR — a conversa parece ter rodado inteira num modelo só, e quem
 * ler depois ("por que esse trecho ficou pior?") não tem como saber. O custo
 * também some do olho: o preço por token muda no meio e nada avisa.
 *
 * `null` quando não houve troca — ausência de evento, não frase vazia.
 *
 * Puro: quem decide POR QUE trocou é o humano; aqui só se escreve o que houve.
 */
export function notaDeTrocaDeModelo(
  anterior: string | null,
  novo: string | null,
): string | null {
  const de = anterior ?? "default"
  const para = novo ?? "default"
  if (de === para) return null
  return `Modelo trocado nesta conversa: ${de} → ${para}. Vale deste turno em diante.`
}
