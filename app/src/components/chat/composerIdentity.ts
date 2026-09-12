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
  /** O humano ESCOLHEU outro esforço numa conversa travada. Só aparece quando
   *  é verdade (como `revezando`). */
  trocouDeEsforco?: boolean
  /** Revezamento de motor engatilhado para esta conversa travada. */
  revezando?: boolean
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
  /** O esforço escolhido DEPOIS do 1º envio (estado próprio, zerado nos mesmos
   *  gatilhos da escolha de modelo). Mesma regra do modelo: vale quando nada
   *  está em voo. */
  escolhaDeEsforco?: string | null
  /** O que a conversa carimbou no 1º run. */
  conversa: { agent: string; reqModel: string | null; effort: string | null }
  /** O que os seletores mostram — estado local que SOBREVIVE à troca de conversa. */
  seletores: { agent: string; model: string; effort: string }
  /** Revezamento de motor engatilhado para esta conversa. */
  stagedAgent?: string | null
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
 *
 * O ESFORÇO segue o modelo desde 11/09/2026: o destrave de 23/08 esqueceu
 * dele, e a régua ficava apagada numa conversa em que o modelo ao lado
 * trocava. A razão técnica é a mesma (flag de spawn do próximo turno, sessão
 * preservada), então a regra também é.
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
  const targetAgent = e.stagedAgent ?? e.conversa.agent
  const revezando = targetAgent !== e.conversa.agent
  // `modeloDestravado` hoje significa "não está em voo" (o motor não aceita
  // trocar o modelo de um processo que já subiu — a flag foi no spawn).
  const escolhido = e.modeloDestravado ? e.escolhaDeEmergencia : null
  const esforcoEscolhido = e.modeloDestravado ? (e.escolhaDeEsforco ?? null) : null
  return {
    agent: targetAgent,
    model: revezando
      ? (escolhido ?? "default")
      : (escolhido ?? e.conversa.reqModel ?? "default"),
    effort: revezando
      ? (esforcoEscolhido ?? "default")
      : (esforcoEscolhido ?? e.conversa.effort ?? "default"),
    trocouDeModelo: escolhido !== null,
    ...(esforcoEscolhido !== null ? { trocouDeEsforco: true } : {}),
    ...(revezando ? { revezando: true } : {}),
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

/**
 * A linha que registra a troca de esforço NO FIO. Mesmo motivo da troca de
 * modelo: sem ela o histórico mente sobre como aquele trecho rodou, e o custo
 * muda sem aviso.
 */
export function notaDeTrocaDeEsforco(
  anterior: string | null,
  novo: string | null,
): string | null {
  const de = anterior ?? "default"
  const para = novo ?? "default"
  if (de === para) return null
  return `Esforço trocado nesta conversa: ${de} → ${para}. Vale deste turno em diante.`
}

/**
 * A linha que registra o revezamento de motor NO FIO.
 *
 * Exibido quando a conversa passa de um motor para outro (transplante).
 */
export function notaDeRevezamentoDeMotor(
  anterior: string,
  novo: string,
): string | null {
  if (anterior === novo) return null
  const de = DESTINATIONS.find((d) => d.id === anterior)?.label ?? anterior
  const para = DESTINATIONS.find((d) => d.id === novo)?.label ?? novo
  return `Revezamento de motor nesta conversa: ${de} → ${para}. O contexto recente foi transferido e vale deste turno em diante.`
}

/**
 * A identidade que o DESPACHO usa (ChatPanel), com as linhas de troca do fio.
 *
 * Conversa travada fica no agent/modelo/esforço carimbados, salvo troca
 * DELIBERADA (`modelSwitched`/`effortSwitched`, montadas pelo composer) ou
 * revezamento de motor, em que modelo e esforço saem do pedido. Trocar modelo
 * ou esforço no meio é permitido (a sessão do CLI sobrevive), mas não pode ser
 * MUDO: sem a linha o histórico passa a dizer que a conversa rodou inteira
 * numa configuração só, e o custo por token muda sem aviso.
 */
export function identidadeDoDespacho({
  locked,
  conv,
  cfg,
}: {
  locked: boolean
  conv: { agent: string; stagedAgent?: string | null; reqModel: string | null; effort: string | null }
  cfg?: {
    agent: string
    model: string | null
    effort: string | null
    modelSwitched?: boolean
    effortSwitched?: boolean
  }
}) {
  const targetAgent = cfg?.agent ?? conv.stagedAgent ?? conv.agent
  const isAgentSwitch = locked && targetAgent !== conv.agent
  const agent = isAgentSwitch ? targetAgent : locked ? conv.agent : (cfg?.agent ?? "claude-code")
  const pedido = (trocou: boolean | undefined, carimbo: string | null, escolha: string | null | undefined) =>
    isAgentSwitch ? (escolha ?? null) : locked && !trocou ? carimbo : (escolha ?? null)
  const model = pedido(cfg?.modelSwitched, conv.reqModel, cfg?.model)
  const effort = pedido(cfg?.effortSwitched, conv.effort, cfg?.effort)
  const noMesmoMotor = locked && !isAgentSwitch
  return {
    agent,
    model,
    effort,
    isAgentSwitch,
    agentChangeNotice: isAgentSwitch ? notaDeRevezamentoDeMotor(conv.agent, agent) : null,
    modelChangeNotice: noMesmoMotor ? notaDeTrocaDeModelo(conv.reqModel, model) : null,
    effortChangeNotice: noMesmoMotor ? notaDeTrocaDeEsforco(conv.effort, effort) : null,
  }
}
