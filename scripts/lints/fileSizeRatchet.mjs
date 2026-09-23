/**
 * Núcleo puro do ratchet de tamanho de arquivo.
 *
 * Mecânica (a do `allowedLineCount` do Buzz, adaptada pra baseline commitada
 * em vez de diff contra base):
 *   - arquivo NOVO nasce abaixo do teto do seu tipo;
 *   - arquivo que JÁ estava acima entra na baseline congelado no tamanho de
 *     hoje e não pode crescer nem uma linha;
 *   - a baseline SÓ ENCOLHE: se um arquivo baixar, o número novo vira o
 *     limite dele (e a guarda cobra a atualização, senão a catraca afrouxa
 *     sozinha).
 */

/**
 * Limite efetivo de um arquivo: o teto do tipo, ou o congelado da baseline
 * quando ele já estava acima.
 *
 * @param {number|null|undefined} baseLines linhas na baseline (null = sem entrada)
 * @param {number} maxLines teto do tipo
 * @returns {number}
 */
export function allowedLineCount(baseLines, maxLines) {
  return baseLines == null || baseLines <= maxLines ? maxLines : baseLines;
}

/**
 * @param {string} content
 * @returns {number}
 */
export function contarLinhas(content) {
  if (content.length === 0) return 0;
  const linhas = content.split(/\r?\n/);
  // Arquivo terminado em \n não ganha uma linha vazia de brinde.
  if (linhas[linhas.length - 1] === "") linhas.pop();
  return linhas.length;
}

/**
 * @param {{baseLines: number|null, atual: number, maxLines: number}} args
 */
export function avaliarArquivo({ baseLines, atual, maxLines }) {
  const limite = allowedLineCount(baseLines, maxLines);
  return { limite, violou: atual > limite };
}

/**
 * A regra (teto) que cobre um arquivo. A primeira que casar ganha, então
 * teste vem antes de fonte.
 *
 * @param {Array<{id: string, maxLines: number, casa: (p: string) => boolean}>} regras
 * @param {string} relPath
 */
export function regraPara(regras, relPath) {
  return regras.find((regra) => regra.casa(relPath)) ?? null;
}

const isTeste = (relPath) => /\.test\.[cm]?[jt]sx?$/.test(relPath);

/**
 * Os tetos. Números calibrados no estado real do repo em 13/08/2026: deixam
 * passar o corpo saudável (a mediana de .ts fica perto de 120 linhas) e
 * pegam exatamente os arquivos que já viraram depósito.
 *
 * @type {Array<{id: string, maxLines: number, casa: (p: string) => boolean}>}
 */
export const REGRAS_PADRAO = [
  { id: "teste", maxLines: 900, casa: (p) => isTeste(p) },
  { id: "tsx", maxLines: 700, casa: (p) => p.endsWith(".tsx") },
  { id: "ts", maxLines: 500, casa: (p) => p.endsWith(".ts") },
  // Rust (ADR-232): 1.000 linhas com os testes do próprio arquivo dentro,
  // calibrado em 23/09/2026 (mediana ~500; 18 de 101 já acima, congelados).
  { id: "rs", maxLines: 1000, casa: (p) => p.endsWith(".rs") },
];

/**
 * Compara o estado atual com a baseline.
 *
 * @param {Array<{relPath: string, linhas: number}>} arquivos
 * @param {Record<string, number>} baseline
 * @param {Array<{id: string, maxLines: number, casa: (p: string) => boolean}>} [regras]
 * @returns {{violacoes: Array<object>, encolheram: Array<object>, obsoletos: string[], baselineNova: Record<string, number>}}
 */
export function avaliarRatchet(arquivos, baseline, regras = REGRAS_PADRAO) {
  const violacoes = [];
  const encolheram = [];
  /** @type {Record<string, number>} */
  const baselineNova = {};

  for (const { relPath, linhas } of arquivos) {
    const regra = regraPara(regras, relPath);
    if (!regra) continue;

    const baseLines = Object.hasOwn(baseline, relPath) ? baseline[relPath] : null;
    const { limite, violou } = avaliarArquivo({
      baseLines,
      atual: linhas,
      maxLines: regra.maxLines,
    });

    if (violou) {
      violacoes.push({
        relPath,
        linhas,
        limite,
        teto: regra.maxLines,
        regra: regra.id,
        baseLines,
        novo: baseLines == null,
      });
    }

    // A baseline nova é o estado atual, quando ele passa do teto — nunca acima
    // do limite vigente. Assim nem um `--update` distraído legitima
    // crescimento: a catraca só gira num sentido.
    if (linhas > regra.maxLines) {
      baselineNova[relPath] = Math.min(linhas, limite);
    }
    if (baseLines != null && linhas < baseLines) {
      encolheram.push({ relPath, de: baseLines, para: Math.max(linhas, regra.maxLines) });
    }
  }

  // Entrada de baseline que não corresponde mais a nenhum arquivo varrido
  // (apagado, renomeado ou já abaixo do teto) é folga a recolher.
  const obsoletos = Object.keys(baseline).filter((relPath) => !Object.hasOwn(baselineNova, relPath));

  return { violacoes, encolheram, obsoletos, baselineNova: ordenar(baselineNova) };
}

function ordenar(mapa) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const chave of Object.keys(mapa).sort()) out[chave] = mapa[chave];
  return out;
}

/**
 * A baseline mudou a ponto de precisar ser regravada?
 *
 * @param {Record<string, number>} baseline
 * @param {Record<string, number>} baselineNova
 */
export function baselineDesatualizada(baseline, baselineNova) {
  const chaves = new Set([...Object.keys(baseline), ...Object.keys(baselineNova)]);
  for (const chave of chaves) {
    // Crescimento não conta aqui: crescer já é violação e tem mensagem
    // própria. Desatualizada é a baseline FROUXA (arquivo encolheu ou sumiu).
    const antes = baseline[chave];
    const agora = baselineNova[chave];
    if (agora == null) return true;
    if (antes == null) continue;
    if (agora < antes) return true;
  }
  return false;
}
