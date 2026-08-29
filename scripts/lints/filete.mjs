/**
 * GUARDA (catraca): o filete tem DOIS papéis, não oito opacidades
 * (§4 e §14 do STYLEGUIDE).
 *
 * ── O QUE ELA MEDIU ANTES DE EXISTIR (29/08/2026) ──────────────────────────
 * 14 cores de borda distintas em `app/src`, sendo OITO degraus de opacidade da
 * mesma cor: /30, /40, /45, /50, /55, /60, /70, /80. Ninguém escolheu oito
 * degraus; cada um escolheu um, perto de onde estava.
 *
 * Separando por uso, os oito viram dois papéis limpos:
 *
 *   `border-t` / `border-l` (divisor DENTRO de uma superfície) → /30 /40 /45
 *   `border`   (a ARESTA de uma superfície)                    → /50 /55 /60 /70 /80
 *
 * E o app já tem um vencedor por larga margem no segundo: `border` cheia, 327
 * usos, que é justamente a receita que o §4 escreveu. As opacidades são deriva,
 * não decisão.
 *
 * ── O SET FECHADO ──────────────────────────────────────────────────────────
 *   ARESTA  = `border` / `border-border`   (cheia)
 *   DIVISOR = `border-border/40`
 *
 * /40 não é gosto: entre os divisores é a pluralidade (14 usos contra 5 e 3).
 *
 * ── POR QUE CATRACA ────────────────────────────────────────────────────────
 * Colapsar os 112 usos de /50 a /80 pra borda cheia de uma vez escureceria
 * meia tela de Configurações num commit sem ninguém ter olhado. O débito entra
 * congelado, só desce, e arquivo novo nasce em zero.
 */

/** O que pode, e só. */
export const FILETES_CANONICOS = ["border-border", "border-border/40"];

/** Qualquer `border-<token>/<opacidade>` ou token de borda fora do canônico. */
const RE_BORDA =
  /\bborder-(?:border|input|foreground|muted|secondary|accent|card|popover)(?:\/\d+)?\b/g;

const RE_STRING = /"((?:[^"\\]|\\.)*)"/g;

const FORA = [/^components\/ui\//, /\.test\.[cm]?[jt]sx?$/];

/** @param {string} relPath */
export function foraDoAlcance(relPath) {
  return FORA.some((re) => re.test(relPath));
}

/** @param {string} classe */
export function ehCanonico(classe) {
  return FILETES_CANONICOS.includes(classe);
}

/**
 * Conta filetes fora do set canônico, por arquivo.
 *
 * @param {Array<{relPath: string, source: string}>} arquivos
 * @returns {Record<string, number>}
 */
export function contarFiletesDerivados(arquivos) {
  /** @type {Record<string, number>} */
  const contagem = {};
  for (const { relPath, source } of arquivos) {
    if (foraDoAlcance(relPath)) continue;
    let n = 0;
    for (const m of source.matchAll(RE_STRING)) {
      RE_BORDA.lastIndex = 0;
      for (const b of m[1].matchAll(RE_BORDA)) {
        if (!ehCanonico(b[0])) n++;
      }
    }
    if (n > 0) contagem[relPath] = n;
  }
  return contagem;
}

/** Quais tokens aparecem, e quantas vezes: pra saída dizer o que migrar.
 *  @param {Array<{relPath: string, source: string}>} arquivos */
export function inventario(arquivos) {
  /** @type {Record<string, number>} */
  const uso = {};
  for (const { relPath, source } of arquivos) {
    if (foraDoAlcance(relPath)) continue;
    for (const m of source.matchAll(RE_STRING)) {
      RE_BORDA.lastIndex = 0;
      for (const b of m[1].matchAll(RE_BORDA)) {
        if (!ehCanonico(b[0])) uso[b[0]] = (uso[b[0]] ?? 0) + 1;
      }
    }
  }
  return uso;
}
