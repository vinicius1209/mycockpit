/**
 * Núcleo puro da guarda de escala tipográfica (STYLEGUIDE §3).
 *
 * A escala é FECHADA: 4 tamanhos de corpo (11/12/13/14) e 3 paradas hero
 * declaradas (20/30/38). A passada de 12/08/2026 trouxe o app de 19 tamanhos
 * distintos pra esses 7; sem guarda, os meio-pixel voltam.
 *
 * Duas famílias de violação, pela lição do Buzz:
 *   1. px arbitrário fora da escala (`text-[15px]`, `font-size: 15px`);
 *   2. rem/em arbitrário (`text-[0.9rem]`) — re-fragmenta igual, e ainda por
 *      cima esconde o valor atrás de uma conversão.
 * rem é aceito só quando cai EXATAMENTE numa parada da escala (16px de raiz):
 * é assim que `.label-mono` (0.6875rem = 11px) vive em `index.css`.
 *
 * Terceira família, que o §3 também fecha: classe de tamanho do Tailwind
 * (`text-xs`, `text-sm`, …) só existe dentro de `components/ui/` (primitives
 * shadcn). Componente do app usa px da escala.
 */

import { lineAt } from "./spans.mjs";

/** As 7 paradas. Corpo + hero, em px. */
export const ESCALA = [11, 12, 13, 14, 20, 30, 38];

/** Raiz assumida pra converter rem/em em px. */
export const RAIZ_PX = 16;

const ARBITRARIO_RE = /\btext-\[(\d+(?:\.\d+)?)(px|rem|em)\]/g;
const FONT_SIZE_RE = /(?<!-)\bfont-size:\s*(\d+(?:\.\d+)?)(px|rem|em)/g;
const CLASSE_TAILWIND_RE = /\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/g;

/**
 * Converte um literal de tamanho pra px. `null` quando a unidade é
 * desconhecida.
 *
 * @param {string|number} valor
 * @param {string} unidade
 * @returns {number|null}
 */
export function paraPx(valor, unidade) {
  const numero = typeof valor === "number" ? valor : Number.parseFloat(valor);
  if (!Number.isFinite(numero)) return null;
  if (unidade === "px") return numero;
  if (unidade === "rem" || unidade === "em") return numero * RAIZ_PX;
  return null;
}

/**
 * O mapa de migração do §3, literal. É a régua que a passada de 12/08/2026
 * usou; a guarda repete a MESMA resposta em vez de inventar a dela.
 */
export const MAPA_DE_MIGRACAO = new Map([
  [9, 11],
  [9.5, 11],
  [10, 11],
  [10.5, 11],
  [11.5, 12],
  [12.5, 13],
  [13.5, 14],
  [15, 14],
  [16, 14],
  [17, 14],
  [19, 20],
  [34, 30],
]);

/**
 * A parada de destino de um valor em px: o que o §3 mandar, e fora do mapa a
 * parada mais próxima (empate desce, porque ênfase acima de 14 se faz com
 * peso e não com tamanho).
 *
 * @param {number} px
 * @returns {number}
 */
export function paradaMaisProxima(px) {
  const doMapa = MAPA_DE_MIGRACAO.get(px);
  if (doMapa != null) return doMapa;
  return maisProximaPorDistancia(px);
}

function maisProximaPorDistancia(px) {
  let melhor = ESCALA[0];
  let menorDistancia = Number.POSITIVE_INFINITY;
  for (const parada of ESCALA) {
    const distancia = Math.abs(parada - px);
    if (distancia < menorDistancia || (distancia === menorDistancia && parada < melhor)) {
      melhor = parada;
      menorDistancia = distancia;
    }
  }
  return melhor;
}

/** @param {number} px */
export function estaNaEscala(px) {
  return ESCALA.includes(px);
}

/**
 * @param {string} relPath
 * @returns {boolean} true quando o arquivo é primitive shadcn (§3 permite
 * classe nomeada do Tailwind lá dentro).
 */
export function isPrimitiveUi(relPath) {
  return relPath.startsWith("components/ui/");
}

/**
 * Acha as violações de escala num fonte.
 *
 * @param {string} source
 * @param {string} relPath posix, relativo à raiz varrida
 * @returns {Array<{linha: number, trecho: string, px: number|null, alvo: number|null, tipo: string}>}
 */
export function acharViolacoesDeEscala(source, relPath) {
  const hits = [];
  const push = (index, trecho, px, tipo) => {
    hits.push({
      linha: lineAt(source, index),
      trecho,
      px,
      alvo: px == null ? null : paradaMaisProxima(px),
      tipo,
    });
  };

  for (const match of source.matchAll(ARBITRARIO_RE)) {
    const px = paraPx(match[1], match[2]);
    // No utilitário do Tailwind a unidade é px e ponto: rem/em ali é a
    // fragmentação disfarçada que o Buzz apanhou, então cai mesmo quando o
    // valor bate numa parada.
    if (match[2] === "px" && px != null && estaNaEscala(px)) continue;
    push(match.index, match[0], px, match[2] === "px" ? "px-fora-da-escala" : "unidade-arbitraria");
  }

  // Em CSS, rem é a forma canônica (`.label-mono` é 0.6875rem = 11px), então
  // aqui o que manda é o px equivalente cair numa parada.
  for (const match of source.matchAll(FONT_SIZE_RE)) {
    const px = paraPx(match[1], match[2]);
    if (px != null && estaNaEscala(px)) continue;
    push(match.index, match[0], px, "css");
  }

  if (!isPrimitiveUi(relPath)) {
    for (const match of source.matchAll(CLASSE_TAILWIND_RE)) {
      push(match.index, match[0], null, "classe-tailwind");
    }
  }

  return hits.sort((a, b) => a.linha - b.linha);
}

/**
 * Mensagem de uma violação, no formato `arquivo:linha`.
 *
 * @param {{relPath: string} & ReturnType<typeof acharViolacoesDeEscala>[number]} v
 */
export function explicarViolacao(v) {
  const onde = `${v.relPath}:${v.linha}`;
  if (v.tipo === "classe-tailwind") {
    return `${onde}: \`${v.trecho}\` — classe de tamanho do Tailwind só vale em components/ui/ (§3); use px da escala`;
  }
  if (v.px == null) {
    return `${onde}: \`${v.trecho}\` — unidade fora da escala; use px de {${ESCALA.join(", ")}}`;
  }
  const equivalente = v.trecho.includes("px") ? "" : ` (= ${arredondar(v.px)}px)`;
  if (v.tipo === "unidade-arbitraria") {
    return `${onde}: \`${v.trecho}\`${equivalente} — utilitário de texto usa px da escala; troque por text-[${v.alvo}px]`;
  }
  return `${onde}: \`${v.trecho}\`${equivalente} — fora da escala; a parada mais próxima é ${v.alvo}px`;
}

function arredondar(px) {
  return Number.isInteger(px) ? px : Math.round(px * 100) / 100;
}
