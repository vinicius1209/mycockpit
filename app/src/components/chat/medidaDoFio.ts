// As medidas e os gestos do fio, puros: o `useChatScroll` decide com eles
// quando seguir o fim, soltar e devolver a leitura. Moram fora do hook para
// ele caber no teto de tamanho; o hook os reexporta.

import type { ChatItem } from "@/store/chat"

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

/** O último grupo do fio e onde ele começa no conteúdo rolável. */
export interface MarcaDaCauda {
  chave: string
  topo: number
}

/**
 * Puro: quanto o que está ACIMA da cauda mudou de altura desde a última
 * medida. A cauda cresce para baixo, então o topo dela só anda quando algo
 * acima mudou (a janela de 150 nós desliza no fim do turno e um nó antigo
 * entra ou sai pelo topo). O WebKit não tem ancoragem de scroll: sem
 * compensar, a tela pula e a mola a traz de volta à vista (ADR-290).
 * Grupo novo na cauda não é desvio.
 */
export function desvioAcimaDaCauda(antes: MarcaDaCauda | null, agora: MarcaDaCauda | null): number {
  if (!antes || !agora || antes.chave !== agora.chave) return 0
  const desvio = agora.topo - antes.topo
  return Math.abs(desvio) < 1 ? 0 : desvio
}

/** O último pedido SEU no fio: é nele que a pista se ancora. */
export function ultimoPedido(items: ChatItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "user") return items[i].id
  }
  return null
}

export function movimentoReduzido(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

/** O topo do pedido no conteúdo rolável. Quando ele abre o grupo, conta do
 *  grupo, para o "Você" ficar à vista junto. */
export function topoDoPedido(scroller: HTMLElement, id: string): number | null {
  const no = scroller.querySelector<HTMLElement>(`[data-chat-item-ids~="${CSS.escape(id)}"]`)
  if (!no) return null
  const grupo = no.closest<HTMLElement>("[data-turn-key]")
  const alvo = grupo && grupo.querySelector("[data-chat-item-ids]") === no ? grupo : no
  return alvo.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
}

/** Onde começa o último grupo do fio, no conteúdo rolável. */
export function marcaDaCauda(scroller: HTMLElement, conteudo: HTMLElement): MarcaDaCauda | null {
  const grupos = conteudo.querySelectorAll<HTMLElement>("[data-turn-key]")
  const ultimo = grupos[grupos.length - 1]
  if (!ultimo) return null
  return {
    chave: ultimo.dataset.turnKey ?? "",
    topo: ultimo.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop,
  }
}
