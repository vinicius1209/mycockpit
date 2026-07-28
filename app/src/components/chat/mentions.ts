// Split de MENÇÕES no texto renderizado do fio (Especialistas): um token `@nome`
// que casa com uma persona CONHECIDA (nome de um especialista da lista) vira um
// segmento `mention` (o render veste de chip brass); o resto fica texto puro.
// Puro e testável — nada de React aqui, pra não estragar o fast-refresh nem
// mexer no messageNodes (que cuida da fragmentação da prosa do agente).

export type MentionSeg =
  | { type: "text"; text: string }
  | { type: "mention"; text: string; name: string }

// caractere de "palavra" (letra/número, unicode) — delimita o token do `@`.
const WORD = /[\p{L}\p{N}]/u
const isWord = (c: string | undefined) => !!c && WORD.test(c)

/** Quebra `text` em segmentos, marcando cada `@nome` que casa (case-insensitive)
 *  com um dos `names` conhecidos. Regras pra não pegar falso positivo:
 *  - o `@` precisa estar no começo ou após um não-palavra (evita `email@x.com`);
 *  - logo após o nome casado NÃO pode vir letra/número (evita `@Ali` casar dentro
 *    de `@Aline`);
 *  - nomes mais longos têm prioridade (longest-match), então `@Ana Paula` casa o
 *    nome inteiro mesmo que exista uma persona "Ana". */
export function splitMentions(text: string, names: string[]): MentionSeg[] {
  const known = [...new Set(names.filter((n) => n.trim().length > 0))].sort(
    (a, b) => b.length - a.length,
  )
  if (!text) return []
  if (known.length === 0) return [{ type: "text", text }]
  const segs: MentionSeg[] = []
  let buf = ""
  let i = 0
  while (i < text.length) {
    if (text[i] === "@" && !isWord(text[i - 1])) {
      let matched: string | null = null
      for (const name of known) {
        const slice = text.slice(i + 1, i + 1 + name.length)
        if (
          slice.toLowerCase() === name.toLowerCase() &&
          !isWord(text[i + 1 + name.length])
        ) {
          matched = slice // preserva o casing como o usuário digitou
          break
        }
      }
      if (matched) {
        if (buf) {
          segs.push({ type: "text", text: buf })
          buf = ""
        }
        segs.push({ type: "mention", text: `@${matched}`, name: matched })
        i += 1 + matched.length
        continue
      }
    }
    buf += text[i]
    i++
  }
  if (buf) segs.push({ type: "text", text: buf })
  return segs
}
