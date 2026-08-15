/**
 * Núcleo puro da GUARDA DA BARRA DE ACENTO (§2 e §10 do STYLEGUIDE, ADR-043).
 *
 * A REGRA
 * -------
 * Seleção não é cor. Quem está escolhido ganha preenchimento neutro (`--sel`)
 * + peso + pip neutro; NÃO ganha um filete tingido colado na borda. Duas
 * formas do mesmo vício, e as duas já existiram neste app:
 *
 *   · a BARRA vertical de 2,5px em `bg-brass`, colada em `left-0`, que marcava
 *     projeto/conversa/feature na sidebar (removida na Fase 1);
 *   · o SUBLINHADO horizontal de 2px em `bg-brass`, colado em `-bottom-px`,
 *     que marcava a aba ativa do painel direito (removido na Fase 2).
 *
 * O §10 existe porque despoluição sem guarda re-fragmenta em poucos sprints
 * (a lição do Buzz). Esta é a guarda que impede o brass-como-seleção de voltar
 * pela porta dos fundos, agora que a Fase 5 limpou o terreno.
 *
 * O QUE ELA ACUSA (as quatro condições, todas juntas, no MESMO elemento)
 * ---------------------------------------------------------------------
 *   1. posicionado fora do fluxo (`absolute`/`fixed`);
 *   2. ancorado numa aresta (`left-0`, `inset-x`, `-bottom-px`…);
 *   3. filete: uma das dimensões ≤ 3px (`w-px`, `w-[2.5px]`, `h-[2px]`…);
 *   4. tingido: `bg-brass` ou qualquer `bg-st-*`.
 *
 * As quatro juntas só descrevem uma coisa. Régua de fundo neutro (`bg-border`)
 * passa, moldura de risco passa (não é filete), barra de progresso passa (não
 * é absoluta e ancorada). Se disparar, a saída é a receita do §2, não uma
 * exceção aqui.
 */

/** Elemento posicionado fora do fluxo. */
const POSICIONADO = /(?:^|\s)(?:absolute|fixed)(?:\s|$)/;

/** Colado numa aresta do pai. */
const ANCORADO =
  /(?:^|\s)-?(?:left-0|right-0|top-0|bottom-0|inset-x-0|inset-y-0|inset-0|left-px|right-px|top-px|bottom-px)(?:\s|$)/;

/** Tinta de gesto ou de status. */
const TINGIDO = /(?:^|\s)bg-(?:brass|st-)[\w./[\]-]*/;

/**
 * Filete: alguma dimensão ≤ 3px. Cobre a escala do Tailwind (`w-px` = 1px,
 * `w-0.5` = 2px, `w-[2.5px]`) — `w-1` (4px) já não é filete, é barra.
 */
const FILETE = /(?:^|\s)[wh]-(?:px|0\.5|\[(\d+(?:\.\d+)?)px\])(?:\s|$)/;

/** @param {string} classes */
export function ehFilete(classes) {
  const m = classes.match(FILETE);
  if (!m) return false;
  // `w-px`/`w-0.5` já são ≤ 2px; o arbitrário precisa ser medido.
  return m[1] === undefined || Number(m[1]) <= 3;
}

/**
 * Extrai, de um `className=`, TODAS as strings que compõem as classes daquele
 * elemento — inclusive as que vêm de ternário dentro de `cn(...)`. É por
 * elemento de propósito: a barra nasce de um `active && "…"` ao lado de um
 * `absolute` que está na base, e olhar literal por literal perderia o par.
 *
 * @param {string} source
 * @returns {Array<{classes: string, indice: number}>}
 */
export function extrairClassNames(source) {
  const out = [];
  const re = /\bclassName=/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const inicio = match.index + match[0].length;
    const expr = lerExpressao(source, inicio);
    if (expr === null) continue;
    out.push({ classes: juntarLiterais(expr), indice: match.index });
  }
  return out;
}

/** Lê `"…"` ou `{…}` (com chaves balanceadas) a partir de `i`. */
function lerExpressao(source, i) {
  const abre = source[i];
  if (abre === '"' || abre === "'") {
    const fim = source.indexOf(abre, i + 1);
    return fim === -1 ? null : source.slice(i, fim + 1);
  }
  if (abre !== "{") return null;
  let profundidade = 0;
  for (let j = i; j < source.length; j++) {
    const c = source[j];
    if (c === '"' || c === "'" || c === "`") {
      const fim = pularString(source, j, c);
      if (fim === -1) return null;
      j = fim;
      continue;
    }
    if (c === "{") profundidade++;
    else if (c === "}") {
      profundidade--;
      if (profundidade === 0) return source.slice(i, j + 1);
    }
  }
  return null;
}

/** Devolve o índice da aspa de fechamento (ou -1). */
function pularString(source, i, aspas) {
  for (let j = i + 1; j < source.length; j++) {
    if (source[j] === "\\") {
      j++;
      continue;
    }
    if (source[j] === aspas) return j;
  }
  return -1;
}

/** Junta o conteúdo de todos os literais de string da expressão. */
function juntarLiterais(expr) {
  const partes = [];
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c !== '"' && c !== "'" && c !== "`") continue;
    const fim = pularString(expr, i, c);
    if (fim === -1) break;
    partes.push(expr.slice(i + 1, fim));
    i = fim;
  }
  return partes.join(" ");
}

/** @param {string} source @param {number} indice */
function linhaDe(source, indice) {
  let linha = 1;
  for (let i = 0; i < indice && i < source.length; i++) {
    if (source[i] === "\n") linha++;
  }
  return linha;
}

/**
 * @param {Array<{relPath: string, source: string}>} arquivos
 * @returns {Array<{relPath: string, linha: number, trecho: string}>}
 */
export function acharBarrasDeAcento(arquivos) {
  const violacoes = [];
  for (const { relPath, source } of arquivos) {
    if (/\.test\.[cm]?[jt]sx?$/.test(relPath)) continue;
    for (const { classes, indice } of extrairClassNames(source)) {
      if (!POSICIONADO.test(classes)) continue;
      if (!ANCORADO.test(classes)) continue;
      if (!TINGIDO.test(classes)) continue;
      if (!ehFilete(classes)) continue;
      violacoes.push({
        relPath,
        linha: linhaDe(source, indice),
        trecho: classes.length > 120 ? `${classes.slice(0, 117)}…` : classes,
      });
    }
  }
  return violacoes;
}
