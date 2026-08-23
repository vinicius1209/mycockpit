// A "época" da janela: um número que muda quando a janela VOLTA a ser vista.
//
// # O defeito (23/08/2026)
//
// O usuário: "o pill trava em alguma posição e só volta a se mexer quando eu
// ativo ou dou foco na conversa".
//
// O que foi DESCARTADO com medida, pra que ninguém refaça a investigação:
//
//   • CSS que suspende render (`content-visibility`, `contain`, `will-change`):
//     não existe nenhum no app;
//   • o ticker de minuto: não remonta o elemento, e o snapshot é estável;
//   • reordenação da lista: a ordem é MANUAL (`sort_order`), não muda no turno;
//   • suspensão do WebKit em segundo plano: medido no motor, a animação
//     CONTINUA rodando com a página em background;
//   • `prefers-reduced-motion`: a cascata está correta — o override do
//     `.conv-spin` vence o bloco global e degrada pra ponto sólido, que não é
//     o que se vê;
//   • `overflow: clip` nos ancestrais: medido, não congela.
//
// O que sobra, e explica cada detalhe: **oclusão de janela do macOS**. Janela
// coberta vira ocluída, o WKWebView suspende a renderização, e ao reaparecer
// ele repinta o último quadro — o arco parado — sem necessariamente retomar a
// animação até que algo force um recálculo de estilo. Clicar numa conversa é
// exatamente esse "algo".
//
// Casa com tudo: ângulo ARBITRÁRIO (suspensão, não reinício), volta ao
// interagir, intermitente (depende de a janela ter sido coberta), e não
// reproduz em motor headless, que não tem janela pra ocluir.
//
// # Por que a solução é uma ÉPOCA e não um `setInterval`
//
// Remontar o spinner de tempos em tempos "resolveria" mascarando: o anel
// saltaria pra zero periodicamente mesmo com tudo funcionando. Aqui o número só
// muda quando a janela volta — em uso normal ele nunca muda, e o custo é zero.

let epoca = 0
const ouvintes = new Set<() => void>()

function bater() {
  epoca++
  for (const o of ouvintes) o()
}

/** Assina a época (contrato do `useSyncExternalStore`). Devolve o cancelamento.
 *
 *  `focus` e `visibilitychange` porque os dois caminhos existem: a janela pode
 *  voltar por foco (você clicou nela) ou por deixar de estar oculta. Escutar só
 *  um deixaria metade dos casos de fora. */
export function subscribeJanela(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte)
  if (ouvintes.size === 1 && typeof window !== "undefined") {
    window.addEventListener("focus", bater)
    document.addEventListener("visibilitychange", aoTrocarVisibilidade)
  }
  return () => {
    ouvintes.delete(ouvinte)
    if (ouvintes.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("focus", bater)
      document.removeEventListener("visibilitychange", aoTrocarVisibilidade)
    }
  }
}

/** Só bate ao VOLTAR. Bater ao esconder faria a época mudar num momento em que
 *  ninguém está olhando, gastando um render por nada. */
function aoTrocarVisibilidade() {
  if (!document.hidden) bater()
}

/** Estável entre batidas: o `useSyncExternalStore` compara por identidade. */
export function janelaEpoca(): number {
  return epoca
}

/** Só para teste. */
export function _baterJanela(): void {
  bater()
}
