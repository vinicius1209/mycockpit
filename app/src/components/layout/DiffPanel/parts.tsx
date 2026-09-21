// Peças compartilhadas entre a COLUNA (índice) e a ABA (leitura) do diff.
//
// Existe desde que o diff ganhou aba própria (F1.1/F1.3): os dois lados
// desenham a mesma linha de arquivo — mesma letra de status, mesma cor, mesmo
// corte de diretório — e duas cópias divergiriam em silêncio na primeira
// mudança de estilo.

/** Letra + cor do status do arquivo no diff. `renamed` é o único brass aqui, e
 *  é BADGE de estado, não ícone ilustrativo (§2 do STYLEGUIDE). */
/** Verde do domínio git (§2) tem UM sentido aqui: arquivo que não existia.
 *  `A` e `U` são esse mesmo estado, preparado ou não, e dividem o token. */
const ARQUIVO_NOVO = "text-st-success"

export const STATUS_META: Record<
  string,
  { label: string; title: string; cls: string }
> = {
  modified: { label: "M", title: "modificado", cls: "text-st-warning" },
  added: { label: "A", title: "novo", cls: ARQUIVO_NOVO },
  deleted: { label: "D", title: "removido", cls: "text-st-error" },
  renamed: { label: "R", title: "renomeado", cls: "text-brass" },
  // Em cinza o `U` parecia linha desabilitada ao lado do `M` âmbar.
  untracked: { label: "U", title: "não rastreado", cls: ARQUIVO_NOVO },
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
 * 3. `dir` com `shrink-[9999]`: cedia tudo antes do nome no Chromium do e2e,
 *    mas no app sobrava um toco ilegível (`a…`, `app…`) ao lado de um nome já
 *    cortado. A ordem dependia da aritmética de shrink de cada motor.
 * 4. esta: a ordem vem da QUEBRA DE LINHA, não de fator. O diretório tem piso
 *    de 8ch; se nome + piso não cabem, ele quebra pra segunda linha, que o
 *    `h-4` + `overflow-hidden` escondem. Ou o diretório aparece legível, ou
 *    some inteiro, e o nome só trunca quando já está sozinho na linha.
 *
 * Medido nos três casos: nome curto (tudo inteiro), médio (nome inteiro,
 * diretório cortado ou fora), longo (nome cortado, diretório fora, sem colisão).
 */
/** As classes da escada, exportadas para o e2e MEDIR o CSS compilado de
 *  verdade em vez de reescrever as strings e testar a própria cópia
 *  (`e2e/diff-linha-arquivo.spec.ts`). */
export const FILE_LABEL_CLS = {
  /** Uma linha de altura fixa: o que quebrar pra segunda fica escondido. */
  host: "flex h-4 min-w-0 flex-1 flex-wrap content-start items-baseline gap-x-1.5 overflow-hidden font-mono text-[12px] leading-4",
  base: "max-w-full min-w-0 truncate font-medium text-foreground/90",
  /** Piso de 8ch: abaixo disso o diretório quebra de linha e some inteiro. */
  dir: "min-w-[8ch] flex-1 basis-[8ch] truncate text-[11px] text-muted-foreground/55",
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
