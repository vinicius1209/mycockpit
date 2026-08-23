// COMO você chegou no elemento: mouse ou teclado.
//
// Existe porque o `:focus-visible` do navegador NÃO resolve o nosso caso, e a
// medição mostra: abrir um dropdown do Radix com o mouse e fechar com o mouse
// deixa o gatilho com `:focus-visible = true`. Medido em 23/08/2026, no
// `dist/` buildado, com clique puro dos dois lados.
//
// O motivo é o Radix devolver o foco ao gatilho por código quando o menu
// fecha. Foco programático herda o "modo teclado" da navegação que aconteceu
// DENTRO do menu — e aí o anel acende depois de uma interação em que o usuário
// não tocou no teclado uma vez.
//
// O resultado é um anel dourado piscando em botão que você acabou de clicar,
// que é o que o usuário descreveu como "aplicação web disfarçada de desktop":
// app nativo não acende contorno quando você clica, só quando você TABULA.
//
// A saída é não perguntar ao navegador e sim rastrear a última intenção real.
// `pointerdown` marca mouse; só as teclas de NAVEGAÇÃO marcam teclado — digitar
// num campo de texto não é navegar, e trocaria o modo sem que ninguém tivesse
// saído do lugar.

const NAVEGACAO = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Enter",
  " ",
  "Escape",
])

/** A tecla move o foco pela interface? Puro, pra ser testável sem DOM. */
export function navega(key: string): boolean {
  return NAVEGACAO.has(key)
}

/** Liga o rastreador. Devolve o desligamento (padrão da casa: registro é
 *  efeito reversível). Idempotente por chamada — quem chama guarda o retorno. */
export function rastrearModalidade(doc: Document = document): () => void {
  const marcar = (m: "mouse" | "teclado") => {
    if (doc.documentElement.dataset.modalidade !== m) {
      doc.documentElement.dataset.modalidade = m
    }
  }
  const down = () => marcar("mouse")
  const key = (e: KeyboardEvent) => {
    if (navega(e.key)) marcar("teclado")
  }
  // `capture` nos dois: o Radix chama `stopPropagation` em várias teclas dentro
  // do menu, e sem captura o rastreador perderia justamente a navegação que
  // deveria acender o anel depois.
  doc.addEventListener("pointerdown", down, true)
  doc.addEventListener("keydown", key, true)
  marcar("mouse") // boot: ninguém tabulou ainda
  return () => {
    doc.removeEventListener("pointerdown", down, true)
    doc.removeEventListener("keydown", key, true)
  }
}
