// O RELÓGIO DO VIVO (ADR-256, ADR-259): um só para o app inteiro, que move
// todo sinal de "rodando" (o `CometaVivo` e o `TextoVivo`).
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
// Aqui não há animação do navegador para retomar. A pose é CALCULADA pela hora
// (`anguloEm`, `faixaDoBrilhoEm`), e um `requestAnimationFrame` compartilhado a
// aplica: quando a janela volta, o próximo quadro já nasce no ponto certo.
//
// # Por que isto não sobrevive ao fim do turno
//
// A guarda `rodandoMotion.mjs` temia "timer de JS que sobrevive ao turno". O
// relógio não decide QUEM está vivo: só pinta os sinais que existem, e cada
// um existe porque o store diz "rodando". Sem assinante, o laço para.

/** Uma volta do cometa, em ms. */
export const VOLTA_MS = 1100
/** O brilho atravessa a frase em `TRAVESSIA_MS` e descansa até o fim do ciclo. */
export const TRAVESSIA_MS = 1400
export const CICLO_DO_BRILHO_MS = 2200
/** Pose parada (reduced-motion): o cometa em ¾ de volta. */
export const ANGULO_PARADO = 270

/** Ângulo do cometa naquele instante (ms), 0..360. Puro. */
export function anguloEm(ms: number): number {
  return ((ms % VOLTA_MS) / VOLTA_MS) * 360
}

/** Posição do brilho no texto, em % de `background-position`: de 100 (antes
 *  da primeira letra) a -100 (depois da última). No descanso, fora do texto.
 *  Puro. */
export function faixaDoBrilhoEm(ms: number): number {
  const t = ms % CICLO_DO_BRILHO_MS
  if (t >= TRAVESSIA_MS) return -100
  return 100 - (t / TRAVESSIA_MS) * 200
}

type Pintor = (ms: number, parado: boolean) => void

const pintores = new Set<Pintor>()
let laco: number | null = null

function semMovimento(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

function passo(agora: number) {
  for (const p of pintores) p(agora, false)
  laco = requestAnimationFrame(passo)
}

/** Assina o relógio. O pintor recebe a hora já na assinatura e a cada quadro.
 *  Devolve o cancelamento; sem assinantes, o laço para. */
export function assinarRelogio(pintor: Pintor): () => void {
  pintores.add(pintor)
  if (typeof requestAnimationFrame === "undefined" || semMovimento()) {
    // Sem animação possível (teste, reduced-motion): uma pose parada e só.
    pintor(0, true)
  } else {
    pintor(performance.now(), false)
    if (laco === null) laco = requestAnimationFrame(passo)
  }
  return () => {
    pintores.delete(pintor)
    if (pintores.size === 0 && laco !== null) {
      cancelAnimationFrame(laco)
      laco = null
    }
  }
}

/** Só para teste: o laço está girando? */
export function _relogioAtivo(): boolean {
  return laco !== null
}
