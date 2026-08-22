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

/**
 * Nome do arquivo + diretório, na ordem em que se lê (nome primeiro).
 *
 * A escada de encolhimento é o conteúdo desta peça, e ela precisou de três
 * tentativas pra ficar certa — cada erro corrigindo o anterior:
 *
 * 1. `dir` truncando e `base` com `shrink-0`: o nome nunca cortava, mas com
 *    nome longo ele TRANSBORDAVA e passava por cima do contador de ±linhas
 *    (visto na tela, `console-2026-08-06T18-49-27-114Z.log`).
 * 2. os dois truncando: nada colidia, mas aí o NOME era cortado numa coluna de
 *    260px — justamente o dado que a linha existe pra mostrar.
 * 3. esta: `dir` cede TUDO antes de o nome perder um pixel (fator de shrink
 *    altíssimo), e o nome só trunca quando o diretório já sumiu. O
 *    `overflow-hidden` no meio é a rede: nada pinta por cima do contador,
 *    aconteça o que acontecer com o conteúdo.
 *
 * Medido nos três casos: nome curto (tudo inteiro), médio (nome inteiro,
 * diretório cortado), longo (nome cortado, diretório em zero, sem colisão).
 */
/** As classes da escada, exportadas para o e2e MEDIR o CSS compilado de
 *  verdade em vez de reescrever as strings e testar a própria cópia
 *  (`e2e/diff-linha-arquivo.spec.ts`). */
export const FILE_LABEL_CLS = {
  host: "flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden font-mono text-[12px]",
  base: "min-w-0 truncate font-medium text-foreground/90",
  /** `shrink-[9999]`: o diretório cede TUDO antes de o nome perder um pixel. */
  dir: "min-w-0 shrink-[9999] truncate text-[11px] text-muted-foreground/55",
} as const

export function FilePathLabel({ path }: { path: string }) {
  const { dir, base } = splitPath(path)
  return (
    <span className={FILE_LABEL_CLS.host} title={path}>
      <span className={FILE_LABEL_CLS.base}>{base}</span>
      {dir && <span className={FILE_LABEL_CLS.dir}>{dir}</span>}
    </span>
  )
}
