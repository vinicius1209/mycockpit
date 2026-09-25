// O RELÓGIO DO VIVO (ADR-256): um só para o app inteiro, que move toda
// `MatrizViva` (o sinal de "rodando").
//
// # Por que um relógio e não `@keyframes`
//
// "O spinner trava e só volta quando clico no projeto" (25/09/2026). O giro
// era animação CSS, e no macOS a janela coberta por outra vira ocluída: o
// WKWebView suspende a pintura e, ao reaparecer, repinta o último quadro SEM
// retomar a animação (diagnóstico da ADR-071, em `lib/janelaViva.ts`). O
// remédio de lá remonta o giro quando a janela ganha foco ou volta a ficar
// visível, mas coberta-e-descoberta SEM perder o foco não dispara nenhum dos
// dois: o arco ficava parado até um clique forçar a repintura.
//
// Aqui não há animação do navegador para retomar. O quadro é CALCULADO pela
// hora (`quadroEm`), e um `requestAnimationFrame` compartilhado o aplica: quando
// a janela volta, o próximo quadro já nasce no ponto certo.
//
// # Por que isto não sobrevive ao fim do turno
//
// A guarda `rodandoMotion.mjs` temia "timer de JS que sobrevive ao turno". O
// relógio não decide QUEM está vivo: só pinta as matrizes que existem, e cada
// uma existe porque o store diz "rodando". Sem assinante, o laço para.

/** Quadros por segundo: a matriz lê como movimento a 12, e custa pouco. */
export const QUADROS_POR_SEGUNDO = 12
/** Quadros num ciclo: nove pontos acendendo, e três de respiro. */
export const CICLO = 12

export type Onda = "diagonal" | "coluna"

/** Em que quadro do ciclo cada ponto (0..8, linha a linha) acende.
 *  diagonal: a conversa trabalhando, a onda desce do canto.
 *  coluna: um passo executando, a onda sobe da esquerda para a direita. */
const ATRASO: Record<Onda, readonly number[]> = {
  diagonal: [0, 1, 2, 1, 2, 3, 2, 3, 4].map((d) => d * 2),
  coluna: [2, 5, 8, 1, 4, 7, 0, 3, 6],
}

/** O quadro do ciclo naquele instante (ms). Puro. */
export function quadroEm(ms: number): number {
  return Math.floor((ms / 1000) * QUADROS_POR_SEGUNDO) % CICLO
}

/** Brilho de um ponto num quadro: 2 aceso, 1 na esteira, 0 apagado. Com
 *  `parado` (reduced-motion), a matriz fica acesa pela metade e o centro
 *  inteiro: sinal visível, sem piscar. Puro. */
export function brilho(quadro: number, onda: Onda, ponto: number, parado = false): 0 | 1 | 2 {
  if (parado) return ponto === 4 ? 2 : 1
  const d = (quadro - ATRASO[onda][ponto] + CICLO) % CICLO
  return d === 0 ? 2 : d <= 2 ? 1 : 0
}

type Pintor = (quadro: number, parado: boolean) => void

const pintores = new Set<Pintor>()
let laco: number | null = null
let ultimo = -1

function semMovimento(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

function passo(agora: number) {
  const q = quadroEm(agora)
  if (q !== ultimo) {
    ultimo = q
    for (const p of pintores) p(q, false)
  }
  laco = requestAnimationFrame(passo)
}

/** Assina o relógio. O pintor recebe o quadro já na assinatura e a cada troca.
 *  Devolve o cancelamento; sem assinantes, o laço para. */
export function assinarRelogio(pintor: Pintor): () => void {
  pintores.add(pintor)
  if (typeof requestAnimationFrame === "undefined" || semMovimento()) {
    // Sem animação possível (teste, reduced-motion): um quadro parado e só.
    pintor(0, true)
  } else {
    pintor(quadroEm(performance.now()), false)
    if (laco === null) laco = requestAnimationFrame(passo)
  }
  return () => {
    pintores.delete(pintor)
    if (pintores.size === 0 && laco !== null) {
      cancelAnimationFrame(laco)
      laco = null
      ultimo = -1
    }
  }
}

/** Só para teste: o laço está girando? */
export function _relogioAtivo(): boolean {
  return laco !== null
}
