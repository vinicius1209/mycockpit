/**
 * GUARDA: número de ADR é IDENTIDADE, e o núcleo testável dela mora aqui.
 *
 * ── POR QUE EXISTE ─────────────────────────────────────────────────────────
 * Colidiu DUAS vezes em dois dias. Em 16/09/2026 duas frentes escreveram
 * ADR-202 ("imagem na aba Alterações" e "Configurações: um chrome só") e
 * ninguém notou por três dias; em 18/09 repetiu com o 214 (nome da conversa e
 * arrasto por ponteiro), aí já com quatro arquivos de código citando um deles.
 *
 * Não é descuido de uma pessoa: é o que acontece quando duas frentes abrem a
 * mesma lista, leem a mesma última linha e somam um. Guarda resolve; atenção
 * não.
 *
 * ── POR QUE O ESTRAGO É CARO ───────────────────────────────────────────────
 * É silencioso. `grep ADR-202` passa a devolver duas decisões diferentes, e o
 * comentário no código que cita o número perde o referente sem nada quebrar.
 * Quando aparece, o número já está espalhado e renumerar custa.
 *
 * ── POR QUE TAMBÉM COBRA BURACO ────────────────────────────────────────────
 * Buraco quase sempre é ADR pulada por engano — o mesmo erro de leitura que
 * produz a colisão, só que com sinal trocado. Pegar o buraco pega o hábito.
 */

/** Cabeçalho de ADR: aceita `##` e `###`, que o arquivo usa em épocas diferentes. */
const CABECALHO = /^#{2,3} ADR-(\d+)\b/

/** Puro: número → linhas (1-based) onde ele aparece como cabeçalho. */
export function numerosPorLinha(texto) {
  const mapa = new Map()
  texto.split("\n").forEach((linha, i) => {
    const m = CABECALHO.exec(linha)
    if (!m) return
    const n = Number(m[1])
    mapa.set(n, [...(mapa.get(n) ?? []), i + 1])
  })
  return mapa
}

/** Puro: os números usados mais de uma vez, em ordem. */
export function repetidos(mapa) {
  return [...mapa]
    .filter(([, ondes]) => ondes.length > 1)
    .sort((a, b) => a[0] - b[0])
    .map(([n, ondes]) => ({ numero: n, linhas: ondes }))
}

/** Puro: números ausentes entre o menor e o maior. Lista vazia → sem buracos. */
export function buracos(mapa) {
  const nums = [...mapa.keys()].sort((a, b) => a - b)
  if (nums.length === 0) return []
  const faltando = []
  for (let n = nums[0]; n < nums[nums.length - 1]; n++) {
    if (!mapa.has(n)) faltando.push(n)
  }
  return faltando
}

/** Puro: o próximo número livre. `0` para arquivo sem nenhuma ADR. */
export function proximoLivre(mapa) {
  const nums = [...mapa.keys()]
  return nums.length ? Math.max(...nums) + 1 : 1
}

/** Puro: avalia um texto inteiro e devolve os problemas em linguagem de gente. */
export function avaliar(texto) {
  const mapa = numerosPorLinha(texto)
  const problemas = []
  for (const { numero, linhas } of repetidos(mapa)) {
    problemas.push(
      `ADR-${numero} aparece ${linhas.length}x (linhas ${linhas.join(", ")})` +
        ` — renumere a MENOS citada no código e deixe nota dizendo que mudou`,
    )
  }
  const faltando = buracos(mapa)
  if (faltando.length) {
    problemas.push(
      `faltam na sequência: ${faltando.join(", ")}` +
        ` — buraco costuma ser ADR pulada por engano, que é o que antecede a colisão`,
    )
  }
  return { mapa, problemas, proximo: proximoLivre(mapa) }
}
