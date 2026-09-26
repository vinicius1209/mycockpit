/**
 * Núcleo puro da guarda de avisos (ADR-261).
 *
 * POR QUE EXISTE
 * --------------
 * Em 25/09/2026 havia cerca de 300 `toast(...)` em 90 arquivos, cada um com o
 * seu tempo, texto e ideia de quando avisar. O pedido do agente para ligar o
 * navegador era toast sem prazo em cima do composer, e fechá-lo era recusar;
 * a confirmação dizia "Navegador do projeto ligado" sem dizer qual. A porta
 * única (`lib/avisos.ts`) dá natureza, lugar e identidade a cada aviso, e esta
 * guarda impede que o `sonner` volte a ser chamado direto.
 *
 * A REGRA
 * -------
 * - `sonner` só é importado por `lib/avisos.ts` e `components/ui/sonner.tsx`.
 * - `window.confirm`/`window.alert` não entram: a caixa nativa não segue o
 *   tema e trava a janela. Use `confirm()` de `lib/confirm`.
 * - Teste pode mockar o que quiser (`*.test.*` fica fora).
 */

export const PORTAS = new Set(["lib/avisos.ts", "components/ui/sonner.tsx"])

/** Tira comentários de linha e de bloco (o bastante para esta regra). */
function semComentarios(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/**
 * @param {string} relPath caminho relativo a app/src
 * @param {string} source
 * @returns {string[]} as violações, uma frase cada
 */
export function acharAvisosCrus(relPath, source) {
  if (/\.test\.[cm]?[jt]sx?$/.test(relPath) || relPath.startsWith("test/")) return []
  const codigo = semComentarios(source)
  const falhas = []
  if (!PORTAS.has(relPath) && /from\s+["']sonner["']/.test(codigo))
    falhas.push(`${relPath}: importa "sonner" direto. Use \`avisar\` de "@/lib/avisos".`)
  if (/\bwindow\.(confirm|alert)\s*\(/.test(codigo))
    falhas.push(`${relPath}: usa a caixa nativa do navegador. Use \`confirm()\` de "@/lib/confirm".`)
  return falhas
}
