// O RIG DA CARA — a persona com olho que se move.
//
// Por que existe, já que `lib/avatar.ts` resolve a cara: o DiceBear entrega um
// PÔSTER. Os olhos vêm assados dentro do SVG, sem alça pra mexer, então nenhum
// estilo dele pode seguir o ponteiro. Rastrear cursor exige um desenho NOSSO,
// com o olho parametrizado.
//
// A regra de identidade NÃO se duplica aqui. Quem decide como a persona aparece
// continua sendo `avatarFor` (estilo + seed + cor da categoria); este módulo é
// só um SEGUNDO RENDERIZADOR do MESMO spec. Cor vem de `categoryColor`, seed vem
// do mesmo lugar, e a mesma persona sai com a mesma cara todas as vezes. Se um
// dia o rig virar o renderizador padrão, `avatarFor` não muda uma linha — é o
// registro de estilos que passa a apontar pra cá.
//
// Tudo aqui é PURO e determinístico: mesma seed, mesma geometria; mesma
// distância do ponteiro, mesmo desvio. É o que permite testar o olhar sem DOM.

/** Geometria da cara, em unidades do viewBox 40×40. */
export interface PlanoDaCara {
  /** Distância horizontal de cada olho até o centro. */
  afastamentoDoOlho: number
  /** Raio vertical do soquete (o horizontal é fixo: olho oval, nunca ovo). */
  alturaDoOlho: number
  /** A boca, por seed. Variedade sem virar carnaval. */
  boca: "sorriso" | "linha" | "aberta"
}

/** Desvio aplicado ao olhar, em unidades do viewBox. */
export interface DesvioDoOlhar {
  /** Pupila dentro do soquete. */
  pupila: { x: number; y: number }
  /** A cabeça inteira se inclina. É ISTO que se enxerga abaixo de ~26px. */
  cabeca: { x: number; y: number }
}

/** Olhar neutro: a cara parada, de frente. Objeto CONGELADO e compartilhado —
 *  o componente compara por identidade pra não re-renderizar à toa. */
export const OLHAR_NEUTRO: DesvioDoOlhar = Object.freeze({
  pupila: Object.freeze({ x: 0, y: 0 }),
  cabeca: Object.freeze({ x: 0, y: 0 }),
}) as DesvioDoOlhar

/** Até onde a cara REPARA no ponteiro, em px de viewport. Fora deste raio ela
 *  volta ao neutro e para de calcular: o gesto é local, não é vigilância. */
export const RAIO_DE_ATENCAO = 180

/** Amplitudes máximas, em unidades do viewBox (40 = lado da cara). Medidas no
 *  mock `docs/mocks/composer-cara-e-modo.html`: acima disto a pupila bate na
 *  borda do soquete e a cara fica vesga. */
const AMPLITUDE_PUPILA_X = 1.9
const AMPLITUDE_PUPILA_Y = 1.6
const AMPLITUDE_CABECA_X = 1.2
const AMPLITUDE_CABECA_Y = 1.0

/** Hash FNV-1a. Determinístico e estável entre execuções — `String.hashCode`
 *  não existe em JS e `Math.random` mataria a premissa do sistema. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Geometria da cara a partir da seed. A variedade é DELIBERADAMENTE pequena
 * (3 afastamentos × 2 alturas × 3 bocas = 18 caras): o time tem que parecer uma
 * família, e a cor da categoria é que carrega o significado. Variedade demais
 * aqui competiria com ela.
 */
export function planoDaCara(seed: string): PlanoDaCara {
  const h = hash(seed || "x")
  const bocas: PlanoDaCara["boca"][] = ["sorriso", "linha", "aberta"]
  return {
    afastamentoDoOlho: 7 + (h % 3),
    alturaDoOlho: (h >>> 3) % 2 === 0 ? 5.2 : 4.4,
    boca: bocas[(h >>> 5) % 3] as PlanoDaCara["boca"],
  }
}

/**
 * Para onde a cara olha, dado o CENTRO dela e a posição do ponteiro (ambos em
 * px de viewport).
 *
 * A intensidade cai linearmente com a distância: colado no cursor a cara olha
 * com tudo, na borda do raio ela já está praticamente neutra. Isso evita o
 * "salto" que um corte binário (dentro/fora) produziria quando o ponteiro passa
 * raspando — e salto é o que faz decoração virar distração.
 *
 * `ponteiro` nulo (cursor fora da janela, movimento reduzido, tela de toque)
 * devolve o neutro. Nunca lança: é caminho de render, e render falha aberto.
 */
export function olharPara(
  centro: { x: number; y: number },
  ponteiro: { x: number; y: number } | null,
  raio: number = RAIO_DE_ATENCAO,
): DesvioDoOlhar {
  if (!ponteiro || raio <= 0) return OLHAR_NEUTRO
  const dx = ponteiro.x - centro.x
  const dy = ponteiro.y - centro.y
  const distancia = Math.hypot(dx, dy)
  if (distancia > raio) return OLHAR_NEUTRO
  // Ponteiro exatamente no centro: o ângulo é indefinido e qualquer direção
  // seria inventada. Olhar de frente é a resposta honesta.
  if (distancia === 0) return OLHAR_NEUTRO
  const forca = 1 - distancia / raio
  const cos = dx / distancia
  const sen = dy / distancia
  return {
    pupila: {
      x: cos * AMPLITUDE_PUPILA_X * forca,
      y: sen * AMPLITUDE_PUPILA_Y * forca,
    },
    cabeca: {
      x: cos * AMPLITUDE_CABECA_X * forca,
      y: sen * AMPLITUDE_CABECA_Y * forca,
    },
  }
}

/** `path` da boca. Separado do componente porque é dado, não marcação. */
export function caminhoDaBoca(boca: PlanoDaCara["boca"]): string {
  switch (boca) {
    case "sorriso":
      return "M14 27q6 5 12 0"
    case "aberta":
      return "M15 27q5 4 10 0q-5 2 -10 0"
    case "linha":
      return "M15 28h10"
  }
}
