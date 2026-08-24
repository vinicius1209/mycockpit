/**
 * GUARDA (catraca): cartão e selo das Configurações vêm do VOCABULÁRIO, não de
 * string solta.
 *
 * ── O QUE ELA MEDIU ANTES DE EXISTIR (24/08/2026) ──────────────────────────
 * Em `components/settings`, para dois conceitos:
 *
 *   19 strings distintas de "cartão" (rounded + border)
 *   17 strings distintas de selo/rótulo caixa-alta
 *   raio em `rounded-md`, `-lg` e `-xl`; borda em `/50`, `/60` e sem opacidade
 *
 * Nenhuma delas errada sozinha. O problema é o que acontece na próxima seção:
 * sem um lugar onde se ancorar, ela inventa a vigésima — e foi exatamente o que
 * eu fiz ao escrever o selo do rail duplicando um que já existia dois arquivos
 * ao lado.
 *
 * ── POR QUE CATRACA, E NÃO PROIBIÇÃO ───────────────────────────────────────
 * Proibir hoje quebraria 15 seções de uma vez, e ninguém migra 15 seções numa
 * tarde. A baseline congela o que existe: o número por arquivo **só desce**.
 * Cada seção que adota `Card`/`Row`/`Selo` aperta a catraca sozinha, e arquivo
 * NOVO nasce em zero — que é a metade que realmente importa, porque é por onde
 * a divergência entrava.
 *
 * Mesma mecânica da catraca de tamanho (`check-file-size-ratchet`), e pelo
 * mesmo motivo: o débito conhecido fica visível e limitado, em vez de proibido
 * e portanto ignorado.
 *
 * ── O QUE NÃO CONTA ────────────────────────────────────────────────────────
 * `components/ui/` fica fora: é lá que o primitivo do shadcn mora, e ele tem o
 * direito de escrever a classe crua. `parts.tsx` também fica fora — é o próprio
 * vocabulário; contar as classes DELE seria contar a solução como se fosse o
 * problema. Teste idem.
 */

/** Uma superfície de cartão: raio GRANDE + borda no mesmo `className`.
 *
 *  `rounded-md` fica FORA, e a distinção não é arbitrária — foi medida. Naquele
 *  raio o que existe no repo é CONTROLE: input de custo, chip de agent, bloco
 *  de código copiável, alerta de uma linha. Exigir primitivo de cartão para um
 *  campo de texto é a guarda pedindo a coisa errada, e guarda que pede errado
 *  ensina a ignorar guarda.
 *
 *  A régua é a do §4: raio pequeno é controle, raio grande é superfície.
 *  (Descoberto sendo a primeira vítima dela: a versão anterior acusou o
 *  `ServicosSettings` por ter um `<code>` copiável e dois botões.) */
const CARTAO = /className="[^"]*\brounded-(?:lg|xl)\b[^"]*\bborder\b[^"]*"/g;

/** Um selo: caixa alta + espaçamento de letra, a forma do rótulo de estado. */
const SELO = /className="[^"]*\btracking-wide\b[^"]*\buppercase\b[^"]*"/g;

/** O alcance é `components/settings`, e SÓ ele — é lá que o vocabulário mora.
 *  O fio e o painel têm superfícies com outras necessidades; arrastá-los pra cá
 *  seria impor um vocabulário que não foi desenhado pra eles. */
const DENTRO = /^components\/settings\//;
const FORA = [/parts\.tsx$/, /\.test\.[cm]?[jt]sx?$/];

/** @param {string} relPath */
export function foraDoAlcance(relPath) {
  return !DENTRO.test(relPath) || FORA.some((re) => re.test(relPath));
}

/**
 * Conta superfícies escritas à mão num arquivo.
 * @param {string} source
 * @returns {{cartoes: number, selos: number, total: number}}
 */
export function contarSuperficies(source) {
  const cartoes = (source.match(CARTAO) ?? []).length;
  const selos = (source.match(SELO) ?? []).length;
  return { cartoes, selos, total: cartoes + selos };
}

/**
 * Compara o repo com a baseline congelada.
 *
 * @param {Map<string,string>} fontes relPath -> source
 * @param {Record<string,number>} baseline
 * @returns {{estouros: Array<{arquivo: string, agora: number, teto: number}>,
 *            frouxos: Array<{arquivo: string, agora: number, teto: number}>,
 *            atual: Record<string,number>}}
 */
export function auditarSuperficies(fontes, baseline) {
  const estouros = [];
  const frouxos = [];
  /** @type {Record<string,number>} */
  const atual = {};
  for (const [rel, source] of fontes) {
    if (foraDoAlcance(rel)) continue;
    const { total } = contarSuperficies(source);
    if (total > 0) atual[rel] = total;
    const teto = baseline[rel] ?? 0;
    // Arquivo NOVO nasce com teto 0: é a metade que importa.
    if (total > teto) estouros.push({ arquivo: rel, agora: total, teto });
    else if (total < teto) frouxos.push({ arquivo: rel, agora: total, teto });
  }
  // Arquivo que sumiu da baseline (renomeado/apagado) também é folga.
  for (const [rel, teto] of Object.entries(baseline)) {
    if (!fontes.has(rel)) frouxos.push({ arquivo: rel, agora: 0, teto });
  }
  return { estouros, frouxos, atual };
}
