// As medidas e os gestos do fio, puros: o `useChatScroll` decide com eles
// quando seguir o fim, soltar e devolver a leitura. Moram fora do hook para
// ele caber no teto de tamanho; o hook os reexporta.

/** Distância do fim que ainda conta como "está no fim". */
export const PERTO_DO_FIM_PX = 80

export interface Medida {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

export function pertoDoFim(m: Medida): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight < PERTO_DO_FIM_PX
}

/**
 * O fio está escondido (outra aba da tira à vista, host em `display: none`)?
 * Sem layout, a medida não diz nada sobre leitura: o scroll zera e a altura
 * vira 0. Puro.
 */
export function escondido(m: Pick<Medida, "clientHeight">): boolean {
  return m.clientHeight === 0
}

/**
 * Onde o fio fica ao reaparecer. Quem seguia volta ao fim; quem tinha subido
 * pra ler volta onde estava. Pedido de 24/09/2026: fechar o arquivo com ⌘W
 * devolvia a conversa no COMEÇO, porque o WebKit descarta a rolagem de quem
 * fica em `display: none`. Puro.
 */
export function rolagemAoReaparecer(
  seguindo: boolean,
  guardada: number | null,
  scrollHeight: number,
): number | null {
  return seguindo ? scrollHeight : guardada
}

/**
 * A tecla significa "quero ler" (e não "quero acompanhar")?
 *
 * Seta pra baixo e End entram: quem navega pra baixo com o teclado também está
 * conduzindo a leitura, e ser puxado pelo autoscroll no meio disso é o mesmo
 * incômodo. O que fica de fora é digitação: ela acontece no composer, não aqui.
 */
export function ehGestoDeLeitura(key: string): boolean {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "PageUp" ||
    key === "PageDown" ||
    key === "Home" ||
    key === "End"
  )
}

/**
 * O movimento da roda ou toque significa intenção de ler o passado (subir)?
 */
export function ehGestoDeSubida(deltaY: number): boolean {
  return deltaY < 0
}
