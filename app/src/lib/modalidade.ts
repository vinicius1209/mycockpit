// Rastreamento da modalidade de entrada (mouse vs teclado).
// Impede que retornos de foco programático em menus disparem estilos de focus-visible
// indevidos após cliques com o mouse. Apenas teclas de navegação ativam o modo teclado.

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
