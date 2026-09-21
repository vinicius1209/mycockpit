/**
 * Núcleo puro da catraca de marca: o produto se chama Frota, e "mycockpit" só
 * pode DIMINUIR no repositório (ADR-222).
 *
 * Mecânica, a mesma do ratchet de tamanho (`fileSizeRatchet.mjs`): a baseline
 * congela quantas ocorrências cada arquivo tem hoje, nenhum arquivo pode subir,
 * arquivo fora da baseline nasce em zero, e quando um arquivo baixa o número
 * novo vira o teto dele. A catraca só gira num sentido.
 *
 * Por que contar OCORRÊNCIA e não "tem ou não tem": o rename é entregue em
 * camadas, e um arquivo com 40 menções vai perdê-las aos poucos. Booleano só
 * apertaria no último minuto de cada arquivo, e é justamente no meio do caminho
 * que o nome antigo volta por imitação.
 */

/** Qualquer casing. `MyCockpit`, `mycockpit`, `MYCOCKPIT` e `Mycockpit`. */
export const MARCA_VELHA = /mycockpit/gi;

/**
 * Quantas vezes o nome antigo aparece num conteúdo.
 *
 * @param {string} source
 * @returns {number}
 */
export function contarOcorrencias(source) {
  const achados = source.match(MARCA_VELHA);
  return achados ? achados.length : 0;
}

/**
 * As linhas com o nome antigo, para a mensagem de erro apontar onde.
 *
 * @param {string} source
 * @returns {Array<{linha: number, texto: string}>}
 */
export function linhasComMarca(source) {
  const out = [];
  source.split(/\r?\n/).forEach((texto, i) => {
    if (contarOcorrencias(texto) > 0) out.push({ linha: i + 1, texto: texto.trim() });
  });
  return out;
}

/**
 * Compara o estado atual com a baseline.
 *
 * `janela` são os arquivos da JANELA DE COMPATIBILIDADE: os que precisam citar
 * o nome antigo porque é o trabalho deles (a leitura dupla). Entrar ali não é
 * conveniência, é declaração com motivo escrito na baseline, e sai quando a
 * janela fechar. Sem esse mecanismo, o módulo que faz a leitura dupla seria
 * barrado pela própria guarda que ele existe para permitir aposentar.
 *
 * @param {Array<{relPath: string, ocorrencias: number}>} arquivos
 * @param {Record<string, number>} baseline
 * @param {Set<string>|null} [janela]
 * @returns {{violacoes: Array<object>, encolheram: Array<object>, obsoletos: string[], baselineNova: Record<string, number>, total: number}}
 */
export function avaliarMarca(arquivos, baseline, janela = null) {
  const violacoes = [];
  const encolheram = [];
  /** @type {Record<string, number>} */
  const baselineNova = {};
  let total = 0;

  for (const { relPath, ocorrencias } of arquivos) {
    if (ocorrencias === 0) continue;
    total += ocorrencias;

    // Sem entrada na baseline, o teto é ZERO: arquivo novo (ou arquivo que já
    // tinha sido limpo) não pode reintroduzir o nome antigo.
    const base = Object.hasOwn(baseline, relPath) ? baseline[relPath] : 0;

    const naJanela = janela?.has(relPath) ?? false;
    if (ocorrencias > base && !naJanela) {
      violacoes.push({ relPath, ocorrencias, base, novo: !Object.hasOwn(baseline, relPath) });
    }
    if (ocorrencias < base) {
      encolheram.push({ relPath, de: base, para: ocorrencias });
    }
    // A baseline nova nunca sobe: quem violou fica congelado no teto antigo,
    // senão um `--update` distraído legitimaria a reintrodução.
    // Arquivo da janela entra pelo valor de hoje; os demais nunca sobem.
    baselineNova[relPath] = naJanela ? ocorrencias : Math.min(ocorrencias, base);
  }

  // Entrada que não corresponde mais a arquivo com ocorrência é folga a recolher.
  const vistos = new Set(arquivos.filter((a) => a.ocorrencias > 0).map((a) => a.relPath));
  const obsoletos = Object.keys(baseline).filter((relPath) => !vistos.has(relPath));

  for (const relPath of Object.keys(baselineNova)) {
    if (baselineNova[relPath] === 0) delete baselineNova[relPath];
  }

  return { violacoes, encolheram, obsoletos, baselineNova: ordenar(baselineNova), total };
}

/** @param {Record<string, number>} mapa */
function ordenar(mapa) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const chave of Object.keys(mapa).sort()) out[chave] = mapa[chave];
  return out;
}

/**
 * A baseline em disco precisa ser regravada?
 *
 * @param {Record<string, number>} baseline
 * @param {Record<string, number>} baselineNova
 */
export function baselineDesatualizada(baseline, baselineNova) {
  const chaves = new Set([...Object.keys(baseline), ...Object.keys(baselineNova)]);
  for (const chave of chaves) {
    if (baseline[chave] !== baselineNova[chave]) return true;
  }
  return false;
}
