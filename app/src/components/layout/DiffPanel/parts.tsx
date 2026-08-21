// Peças compartilhadas entre a COLUNA (índice) e a ABA (leitura) do diff.
//
// Existe desde que o diff ganhou aba própria (F1.1/F1.3): os dois lados
// desenham a mesma linha de arquivo — mesma letra de status, mesma cor, mesmo
// corte de diretório — e duas cópias divergiriam em silêncio na primeira
// mudança de estilo.

/** Letra + cor do status do arquivo no diff. `renamed` é o único brass aqui, e
 *  é BADGE de estado, não ícone ilustrativo (§2 do STYLEGUIDE). */
export const STATUS_META: Record<
  string,
  { label: string; title: string; cls: string }
> = {
  modified: { label: "M", title: "modificado", cls: "text-st-warning" },
  added: { label: "A", title: "novo", cls: "text-st-success" },
  deleted: { label: "D", title: "removido", cls: "text-st-error" },
  renamed: { label: "R", title: "renomeado", cls: "text-brass" },
}

/** Quebra o caminho em pasta + nome: o nome fica legível quando o caminho
 *  trunca, que é o caso comum numa coluna estreita. */
export function splitPath(path: string): { dir: string; base: string } {
  const cut = path.lastIndexOf("/")
  return cut >= 0
    ? { dir: path.slice(0, cut + 1), base: path.slice(cut + 1) }
    : { dir: "", base: path }
}
