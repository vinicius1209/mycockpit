// A física do acompanhamento do fim (ADR-290). Pura: o `useChatScroll` só
// mede o DOM, chama estes passos e escreve o `scrollTop`.
//
// Por que mola e não salto: o salto a cada token faz o texto subir em degraus
// do tamanho de uma linha. A mola persegue o fim e soma uma estimativa de
// quanto ele cresce por quadro, então o texto sobe como uma esteira. As
// constantes são as da use-stick-to-bottom, que o Zeron também usa.

/** Retém a velocidade de um quadro para o outro (mais alto = mais deslize). */
export const AMORTECIMENTO = 0.7
/** Puxão em direção ao alvo (mais alto = mais seco). */
export const RIGIDEZ = 0.05
/** Inércia (mais alto = demora mais a arrancar e a parar). */
export const MASSA = 1.25
/** A integração é em quadros de 60 Hz, qualquer que seja a tela. */
export const QUADRO_MS = 1000 / 60
/** Um engasgo recupera até este tanto de quadros; o resto é descartado, para
 *  a mola não disparar depois de uma aba escondida. */
export const MAX_QUADROS_POR_PASSO = 8
/** Suavização da estimativa de crescimento do alvo por quadro. */
export const EMA_CRESCIMENTO = 0.12
/** O deslize de entrada da pista retém esta fração do que falta a cada quadro
 *  (~90% do caminho em ~230ms, desacelerando). */
export const RETEM_DESLIZE = 0.85
/** Mais longe do que isto (em alturas de tela) não se desliza: teleporta.
 *  Atravessar três telas de histórico animado é espetáculo, não leitura. */
export const TELETRANSPORTE_TELAS = 2.5
/** A pista segura a mensagem enviada a esta distância do topo do fio (o
 *  `scroll-mt-6` do grupo). */
export const RECUO_DA_PISTA_PX = 24

export interface EstadoDaMola {
  pos: number
  v: number
  /** Crescimento médio do alvo por quadro (px). */
  cresc: number
  alvoAnt: number | null
  /** Na entrada da pista a mensagem desliza até o lugar; depois, mola. */
  deslizando: boolean
}

export function molaParada(pos: number): EstadoDaMola {
  return { pos, v: 0, cresc: 0, alvoAnt: null, deslizando: false }
}

/**
 * Avança a perseguição do fim por `quadros` quadros de 60 Hz. Devolve o novo
 * estado e se assentou (aí o laço para, e não sobra quadro ocioso).
 */
export function passoDaMola(
  e: EstadoDaMola,
  alvo: number,
  quadros: number,
): { estado: EstadoDaMola; assentou: boolean } {
  const q = Math.min(MAX_QUADROS_POR_PASSO, Math.max(0, quadros))
  const cresceu = e.alvoAnt === null ? 0 : Math.max(0, alvo - e.alvoAnt)
  const cresc = e.cresc + EMA_CRESCIMENTO * (cresceu - e.cresc)
  let { pos, v, deslizando } = e

  if (deslizando) {
    pos = alvo - (alvo - pos) * Math.pow(RETEM_DESLIZE, q)
    v = 0
    if (Math.abs(alvo - pos) < 1) {
      pos = alvo
      deslizando = false
    }
  } else {
    const n = Math.max(1, Math.round(q))
    for (let i = 0; i < n; i++) {
      v = (AMORTECIMENTO * v + RIGIDEZ * (alvo - pos)) / MASSA
      pos += v + cresc
      // Além do fim o scroll não vai; a sobra só criaria um tranco de volta.
      if (pos > alvo) {
        pos = alvo
        v = Math.min(v, 0)
      }
    }
  }

  const assentou = !deslizando && Math.abs(alvo - pos) < 0.5 && Math.abs(v) < 0.05
  if (assentou) {
    pos = alvo
    v = 0
  }
  return { estado: { pos, v, cresc, alvoAnt: alvo, deslizando }, assentou }
}

/** Longe demais para deslizar? */
export function deveTeleportar(distancia: number, alturaDaTela: number): boolean {
  return alturaDaTela > 0 && Math.abs(distancia) > TELETRANSPORTE_TELAS * alturaDaTela
}

/**
 * Altura do espaço reservado abaixo do fio depois de um envio seu.
 *
 * Duas garantias, e vale a maior: o fim do scroll não fica acima de
 * `topoDaMensagem - RECUO` (o pedido segura no topo enquanto a resposta
 * nasce embaixo) nem acima de onde a tela está agora (conteúdo que encolhe no
 * fim, como um grupo de ações recolhendo, não arrasta a tela para baixo; o
 * espaço absorve, e o crescimento seguinte o consome antes de mover nada).
 *
 * Em px inteiros: meio pixel relido arredondado fazia o fim oscilar 1px a
 * cada token, e a tela tremia junto.
 */
export function alturaDaPista(m: {
  alturaAtual: number
  scrollHeight: number
  clientHeight: number
  scrollTop: number
  topoDaMensagem: number
}): number {
  const conteudo = m.scrollHeight - m.alturaAtual
  const segurar = Math.max(0, Math.round(m.topoDaMensagem) - RECUO_DA_PISTA_PX)
  const piso = Math.max(segurar, Math.round(m.scrollTop))
  return Math.max(0, piso + m.clientHeight - conteudo)
}
