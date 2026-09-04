// O GATE DO COMPOSER — a decisão de "isto vai, isto espera, isto não sai daqui".
//
// Estava embutida no `submit()` do CommandConsole em DOIS ramos quase iguais
// (um pro turno em andamento, outro pro repouso), cada um repetindo as mesmas
// guardas e cada um limpando o composer por conta própria. Ramos gêmeos que
// divergem são como um anexo fica pra trás: já aconteceu — a imagem "enviada"
// ficava órfã no composer e nunca ia junto —, e o comentário do próprio arquivo
// registra o episódio.
//
// Aqui vira uma decisão só, pura e testável, e o componente ganha UM caminho de
// despacho: quem envia e quem enfileira mandam o MESMO par (texto + anexos).

/** Destino solicitado pelo botão ou pelo atalho explícito do composer. */
export type DestinoDoComposer =
  /** Sai agora: vira turno. */
  | "enviar"
  /** Turno em andamento: entra na fila e sai junto quando o atual terminar. */
  | "enfileirar"
  /** Não sai daqui (vazio, composer travado, ou anexo que o motor não lê). */
  | "barrado"

export interface EstadoDoComposer {
  /** Texto já aparado (`trim`) — o Enter do editor entrega a string serializada. */
  texto: string
  /** Quantos anexos pendentes estão no composer. */
  anexos: number
  /** TODOS os anexos são suportados pelo agent-alvo (espelha o trait do motor). */
  anexosSuportados: boolean
  /** Composer desabilitado pelo dono (sem projeto, conversa corrompida…). */
  disabled: boolean
  /** Turno em voo nesta conversa. */
  running: boolean
  /** Turno terminando (o CLI ainda está fechando a contabilidade). */
  finalizing: boolean
  /** Missão em andamento nesta conversa: envio manual bloqueado (M2). */
  missionRunning: boolean
}

/**
 * A regra, em ordem de precedência:
 *
 * 1. **Sem conteúdo não sai nada.** Texto vazio E zero anexo é barrado sempre —
 *    inclusive pra fila, que não existe pra guardar mensagem vazia.
 * 2. **Anexo que o motor não lê barra o envio inteiro**, e não só o anexo: enviar
 *    "a metade que dá" é o tipo de silêncio que faz o usuário achar que o agente
 *    viu a imagem. O chip vermelho já explica qual e por quê.
 * 3. **Missão em andamento barra ANTES da fila** — e esta ordem é uma correção,
 *    não uma cópia do que havia. O ramo antigo do turno em voo não olhava a
 *    missão, então com missão E turno linear ao mesmo tempo (acontece: a missão
 *    pode ser lançada pelo Launchpad/agenda com um turno já em voo) o composer
 *    dizia "Missão em andamento; pare a missão para enviar manualmente…" no
 *    placeholder e MESMO ASSIM empilhava na fila. Aí a drenagem no fim do turno
 *    esvazia a fila (`dequeueQueued`) e o envio re-entrante é recusado pela
 *    guarda de missão — as mensagens **somem**, sem voltar pra fila e sem aviso.
 *    Enfileirar o que o despacho vai recusar é prometer um envio que não existe.
 * 4. **Turno em voo enfileira.** O gesto explícito de fila usa este caminho.
 *    O Enter durante execução é tratado antes pelo editor: ele pede correção
 *    imediata e, sem transporte nativo de steering, interrompe e retoma.
 */
export function destinoDoComposer(e: EstadoDoComposer): DestinoDoComposer {
  const temConteudo = e.texto.length > 0 || e.anexos > 0
  if (!temConteudo || e.disabled || !e.anexosSuportados) return "barrado"
  if (e.missionRunning) return "barrado"
  if (e.running || e.finalizing) return "enfileirar"
  return "enviar"
}

/** O botão primário de enviar está clicável? (Com turno em voo ele já virou
 *  Parar, então "enfileirar" não acende o Enviar.) */
export function podeEnviar(e: EstadoDoComposer): boolean {
  return destinoDoComposer(e) === "enviar"
}
