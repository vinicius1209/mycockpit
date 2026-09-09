// RASTREADOR ÚNICO DE PONTEIRO (STYLEGUIDE §6).
//
// Um avatar que segue o cursor é fácil de fazer errado de duas maneiras, e as
// duas já são regra da casa:
//
//  1. Um `pointermove` por componente. Seis caras na tela viram seis
//     assinaturas do mesmo evento pra responder a MESMA pergunta ("onde está o
//     cursor?"). É o erro que o `lib/minuteTick.ts` já resolveu pro relógio, e
//     este módulo é o mesmo padrão: ouvinte de módulo, ligado no primeiro
//     assinante, desligado no último.
//
//  2. Movimento ambiente. O §6 manda que movimento seja pra VIVO e pro que
//     termina sozinho. Um bichinho olhando pra volta o dia inteiro é ruído
//     permanente, e ainda compete com o spinner cinza, que é o único movimento
//     do fio com significado. Por isso o olhar aqui NÃO é animação: é resposta
//     a um gesto, da mesma família do `:hover`. Sem cursor na tela não há
//     posição, e sem posição a cara fica parada.
//
// O evento é coalescido por quadro: o `pointermove` dispara dezenas de vezes por
// segundo e só o último valor de cada quadro interessa. Sem isso, cada assinante
// mediria a própria geometria N vezes por quadro — layout thrashing por
// decoração, que é o pior tipo.
//
// O AMBIENTE é injetável (mesmo motivo do `_setRelogio` do minuteTick): a suíte
// roda em node, sem DOM, e um módulo que só se prova no navegador não se prova.

/** Posição do ponteiro em coordenadas de viewport. */
export interface PosicaoDoPonteiro {
  x: number
  y: number
}

/** A janela, reduzida ao que este módulo precisa. Existe pra que a suíte possa
 *  provar o coalescimento e o ouvinte único sem navegador. */
export interface AmbienteDoOlhar {
  /** A MÁQUINA aceita olhar? Ver `olharDisponivel` para os três "não". */
  aceita(): boolean
  ouvir(tipo: "pointermove" | "pointerleave" | "blur", fn: (e: unknown) => void): void
  parar(tipo: "pointermove" | "pointerleave" | "blur", fn: (e: unknown) => void): void
  /** Agenda um flush; devolve um id cancelável, ou `null` quando o ambiente não
   *  tem quadro (aí o flush é imediato — coalescer é otimização, não contrato). */
  agendarQuadro(fn: () => void): number | null
  cancelarQuadro(id: number): void
}

/** Ambiente inerte: sem tela, não há para onde olhar. É o default em node
 *  (suíte, SSR), então importar este módulo fora do navegador é inofensivo. */
const AMBIENTE_INERTE: AmbienteDoOlhar = {
  aceita: () => false,
  ouvir: () => {},
  parar: () => {},
  agendarQuadro: () => null,
  cancelarQuadro: () => {},
}

function ambienteDaJanela(): AmbienteDoOlhar {
  return {
    aceita: () => {
      if (!window.matchMedia) return false
      // Degrada pra cara ESTÁTICA, que continua visível e continua
      // identificando a persona. O §6 exige degradação para indicador estático,
      // nunca para ausência de sinal — e uma cara parada cumpre isso sozinha,
      // porque a informação é a cara, não o movimento.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false
      // `any-hover` e não `hover`: um laptop com touchscreen reporta o ponteiro
      // grosso como primário mesmo tendo trackpad. A pergunta certa é se EXISTE
      // algum apontador fino, não qual o sistema prefere.
      if (window.matchMedia("(any-hover: none)").matches) return false
      return true
    },
    // `passive`: o handler nunca cancela o evento, e dizer isso libera o
    // navegador de esperar por nós antes de rolar.
    ouvir: (tipo, fn) =>
      window.addEventListener(tipo, fn as EventListener, { passive: true }),
    parar: (tipo, fn) => window.removeEventListener(tipo, fn as EventListener),
    agendarQuadro: (fn) =>
      typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : null,
    cancelarQuadro: (id) => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id)
    },
  }
}

let ambiente: AmbienteDoOlhar =
  typeof window === "undefined" ? AMBIENTE_INERTE : ambienteDaJanela()

type Ouvinte = () => void

const ouvintes = new Set<Ouvinte>()
let posicao: PosicaoDoPonteiro | null = null
let pendente: PosicaoDoPonteiro | null = null
let quadro: number | null = null
let ligado = false

/**
 * O olhar está DISPONÍVEL nesta máquina? Fail-closed em três casos, e nenhum
 * deles é erro: movimento reduzido, tela sem apontador fino, e ausência de
 * janela. Quem pergunta é o rastreador, uma vez, ao ligar — os componentes não
 * repetem esta decisão.
 */
export function olharDisponivel(): boolean {
  return ambiente.aceita()
}

function despachar() {
  quadro = null
  posicao = pendente
  for (const ouvinte of ouvintes) ouvinte()
}

function agendar(proxima: PosicaoDoPonteiro | null) {
  pendente = proxima
  if (quadro !== null) return
  const id = ambiente.agendarQuadro(despachar)
  if (id === null) {
    despachar()
    return
  }
  quadro = id
}

function aoMover(e: unknown) {
  const p = e as PointerEvent
  // Toque e caneta não têm cursor pairando: um `pointermove` de toque é um
  // arrasto, e seguir o dedo faria a cara "olhar" durante o scroll.
  if (p.pointerType !== "mouse") return
  agendar({ x: p.clientX, y: p.clientY })
}

function aoSair() {
  agendar(null)
}

function ligar() {
  if (ligado) return
  // A decisão de "esta máquina tem olhar?" mora AQUI e em nenhum outro lugar.
  // Se cada componente perguntasse, seria um `matchMedia` por render e três
  // cópias da mesma regra; assim o rastreador simplesmente nunca publica
  // posição, e toda cara degrada pra estática de graça.
  if (!ambiente.aceita()) return
  ligado = true
  ambiente.ouvir("pointermove", aoMover)
  // O ponteiro saiu da janela (ou o app perdeu o foco): não há mais para onde
  // olhar. Sem isto a última posição fica congelada e a cara mira num cursor
  // que não está mais lá — teatro, que é justamente o que não fazemos.
  ambiente.ouvir("pointerleave", aoSair)
  ambiente.ouvir("blur", aoSair)
}

function desligar() {
  if (ligado) {
    ligado = false
    ambiente.parar("pointermove", aoMover)
    ambiente.parar("pointerleave", aoSair)
    ambiente.parar("blur", aoSair)
  }
  if (quadro !== null) ambiente.cancelarQuadro(quadro)
  quadro = null
  pendente = null
  posicao = null
}

/**
 * Assina a posição do ponteiro. Devolve o cancelamento (contrato do
 * `useSyncExternalStore`). O primeiro assinante liga o ouvinte; o último a sair
 * o desliga, porque ouvinte que sobrevive à tela é vazamento.
 */
export function subscribeOlhar(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte)
  ligar()
  return () => {
    ouvintes.delete(ouvinte)
    if (ouvintes.size === 0) desligar()
  }
}

/**
 * Última posição conhecida do ponteiro, ou `null` quando não há para onde
 * olhar. É ESTÁVEL entre quadros de propósito: o `useSyncExternalStore` compara
 * o snapshot por identidade, e devolver um objeto novo a cada chamada faria o
 * React re-renderizar em laço.
 */
export function olharAgora(): PosicaoDoPonteiro | null {
  return posicao
}

/** Só para teste: troca o ambiente e devolve a função que restaura o real. */
export function _setAmbienteDoOlhar(a: AmbienteDoOlhar): () => void {
  _resetOlhar()
  ambiente = a
  return () => {
    _resetOlhar()
    ambiente = typeof window === "undefined" ? AMBIENTE_INERTE : ambienteDaJanela()
  }
}

/** Só para teste: derruba o ouvinte, os assinantes e a posição. */
export function _resetOlhar(): void {
  ouvintes.clear()
  desligar()
}

/** Quantos assinantes o rastreador tem agora (diagnóstico e teste). */
export function _assinantesDoOlhar(): number {
  return ouvintes.size
}
