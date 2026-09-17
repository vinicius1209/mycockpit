// Abas do painel principal (docs/abas-no-principal-plan.md, F1.1).
//
// Mora fora do componente pelo mesmo motivo do `titleBarModes.ts`: é dado puro
// — quais abas existem é arquitetura de informação, e dá pra travar em teste
// sem montar React.
//
// Não existe predicado de "mostrar a tira": ela é ÂNCORA FIXA da superfície
// Trabalho, por decisão de produto. Houve uma versão em que a tira só aparecia
// com 2+ abas; virou sempre-visível pra que Alterações pudesse entrar e sair
// sem a navegação inteira piscar, e pra que o + de ações tivesse um lugar
// estável. Um `showMainTabs()` que devolve `true` fixo seria dívida fingindo
// configurabilidade — a decisão vive no comentário, não num if morto.
//
// A forma é união discriminada porque foi a que o Paseo provou aguentar: lá o
// `WorkspaceTabTarget` tem 12 variantes hoje e nasceu com poucas, sem
// retrabalho no meio. Aqui a leitura de arquivo entra como a terceira variante
// depois de o diff provar a fronteira entre índice e leitor.

/** Ícone fica com o componente; aqui é só identidade e rótulo. */
export type MainTab =
  | { kind: "conversa" }
  | { kind: "arquivo"; path: string }
  | {
      kind: "diff"
      focusPath?: string
      /** Selo do PEDIDO, não do alvo. Clicar duas vezes no mesmo arquivo tem
       *  que rolar duas vezes; com `focusPath` sozinho, o segundo clique não
       *  mudava nada e quem rolou pra longe não voltava. */
      focusSeq?: number
    }
  /** O navegador do projeto ativo, ao vivo (navegador PRD R1). */
  | { kind: "navegador" }

export interface MainTabEntry {
  kind: MainTab["kind"]
  label: string
  /** Dá pra fechar? A conversa é a superfície-base, não fecha. */
  closable: boolean
}

/**
 * As abas visíveis agora. A conversa está SEMPRE aberta — ela é o fundo, não
 * um item que entra e sai; o que a lista diz é o que mais está aberto além dela.
 */
export function mainTabEntries(
  tab: MainTab,
  contexto: { navegadorAberto?: boolean } = {},
): MainTabEntry[] {
  const base: MainTabEntry[] = [
    { kind: "conversa", label: "Conversa", closable: false },
  ]
  // O navegador FICA na tira enquanto estiver aberto: ele tem trabalho em
  // andamento (página, login, análise), e voltar pra conversa é trocar de
  // vista, não fechar. Diff e arquivo seguem transitórios: são leitura.
  if (contexto.navegadorAberto || tab.kind === "navegador") {
    base.push({ kind: "navegador", label: "Navegador", closable: true })
  }
  if (tab.kind === "diff") {
    base.push({ kind: "diff", label: "Alterações", closable: true })
  } else if (tab.kind === "arquivo") {
    base.push({
      kind: "arquivo",
      label: tab.path.split("/").pop() || tab.path,
      closable: true,
    })
  }
  return base
}

/**
 * Ponto implícito do fork disparado pela barra: o último TURNO concluído.
 * Itens posteriores (nota/notice/advice) não inventam uma nova fronteira; para
 * escolher um turno antigo com precisão, o gesto continua no próprio output.
 */
export function latestCompletedTurnId(
  items: readonly { id: string; kind: string }[],
): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "result") return items[i].id
  }
  return null
}
