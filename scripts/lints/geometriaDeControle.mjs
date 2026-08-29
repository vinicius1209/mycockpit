/**
 * GUARDA (catraca): controle tem altura da ESCADA, não altura inventada
 * (§13 do STYLEGUIDE).
 *
 * ── O QUE ELA MEDIU ANTES DE EXISTIR (29/08/2026) ──────────────────────────
 * 75 arquivos escreviam geometria de controle à mão, em 43 combinações
 * distintas de altura/padding/fonte. E o app já tinha convergido numa escada de
 * 4px sem saber: `px-2.5 py-1` (39×), `px-2 py-1.5` (17×), `px-3 py-1.5` (16×)
 * e `px-2 py-1` (13×) dão 24, 28 e 32px de altura final. Faltava o nome.
 *
 * ── O QUE ELA CONTA ────────────────────────────────────────────────────────
 * Um "controle à mão": string de classe com padding horizontal E vertical (ou
 * um lado quadrado) mais um sinal de interatividade (`hover:` ou `transition`),
 * cuja geometria não vem de `controle()` nem de `<Button size>`.
 *
 * Não é erro por si. É DÉBITO, e por isso é catraca: o número por arquivo só
 * desce, e arquivo NOVO nasce em zero — que é a metade que importa, porque é
 * por onde a divergência entra. Proibir de uma vez quebraria 75 arquivos, e
 * ninguém migra 75 arquivos numa tarde; guarda que pede o impossível ensina a
 * ignorar guarda.
 *
 * ── O QUE NÃO CONTA ────────────────────────────────────────────────────────
 * `components/ui/` fica fora: é lá que a escada é DECLARADA, e contar as
 * classes dela seria contar a solução como se fosse o problema. Teste idem.
 * Ícone puro (`size-3`, `size-3.5`, `size-4`) também: 12 a 16px é glifo, não
 * controle, e cobrar degrau de um `<svg>` é a guarda pedindo a coisa errada.
 */

/** Abaixo disto é glifo, não controle: `size-4` = 16px. */
const MENOR_CONTROLE = 5;

const RE_STRING = /"((?:[^"\\]|\\.)*)"/g;
const RE_PX = /\bpx-(?:\[[^\]]+\]|\d+(?:\.\d+)?)\b/;
const RE_PY = /\bpy-(?:\[[^\]]+\]|\d+(?:\.\d+)?)\b/;
const RE_QUADRADO = /\bsize-(\d+(?:\.\d+)?)\b/;
const RE_ALTURA = /\bh-(?:\[[^\]]+\]|\d+(?:\.\d+)?)\b/;
const RE_INTERATIVO = /\bhover:|\btransition\b/;

const FORA = [/^components\/ui\//, /\.test\.[cm]?[jt]sx?$/];

/** @param {string} relPath */
export function foraDoAlcance(relPath) {
  return FORA.some((re) => re.test(relPath));
}

/**
 * A string descreve a geometria de um controle?
 * @param {string} cls
 */
export function ehGeometriaDeControle(cls) {
  if (!RE_INTERATIVO.test(cls)) return false;

  const quadrado = cls.match(RE_QUADRADO);
  if (quadrado) return Number(quadrado[1]) >= MENOR_CONTROLE;

  if (RE_ALTURA.test(cls)) return true;
  return RE_PX.test(cls) && RE_PY.test(cls);
}

/**
 * Conta os controles à mão por arquivo.
 *
 * Arquivo que importa `controle` de `components/ui/controle` continua sendo
 * contado no que ele ainda NÃO migrou: adotar a escada em um botão e deixar
 * outros cinco à mão é meio caminho, e a catraca precisa enxergar o resto.
 *
 * @param {Array<{relPath: string, source: string}>} arquivos
 * @returns {Record<string, number>}
 */
export function contarControlesAMao(arquivos) {
  /** @type {Record<string, number>} */
  const contagem = {};
  for (const { relPath, source } of arquivos) {
    if (foraDoAlcance(relPath)) continue;
    let n = 0;
    RE_STRING.lastIndex = 0;
    for (const m of source.matchAll(RE_STRING)) {
      if (ehGeometriaDeControle(m[1])) n++;
    }
    if (n > 0) contagem[relPath] = n;
  }
  return contagem;
}

/**
 * Compara com a baseline: só reclama de quem SUBIU ou é novo.
 *
 * @param {Record<string, number>} atual
 * @param {Record<string, number>} baseline
 */
export function compararComBaseline(atual, baseline) {
  /** @type {Array<{relPath: string, de: number, para: number, novo: boolean}>} */
  const piorou = [];
  /** @type {Array<{relPath: string, de: number, para: number}>} */
  const folgou = [];

  for (const [relPath, n] of Object.entries(atual)) {
    const antes = baseline[relPath];
    if (antes === undefined) {
      piorou.push({ relPath, de: 0, para: n, novo: true });
    } else if (n > antes) {
      piorou.push({ relPath, de: antes, para: n, novo: false });
    } else if (n < antes) {
      folgou.push({ relPath, de: antes, para: n });
    }
  }
  for (const [relPath, antes] of Object.entries(baseline)) {
    if (atual[relPath] === undefined) folgou.push({ relPath, de: antes, para: 0 });
  }

  return { piorou, folgou };
}
