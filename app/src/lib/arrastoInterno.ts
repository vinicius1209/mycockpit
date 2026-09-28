// ARRASTAR DENTRO DA JANELA.
//
// Duas tentativas e a prova de por que a primeira não podia funcionar.
//
// 1) HTML5 (`draggable`, `dragover`, `drop`): no app instalado o arrasto COMEÇA
//    (o fantasma segue o cursor) e nada mais acontece. A causa está no código do
//    Tauri, não no nosso: com `dragDropEnabled` (padrão), o `WryWebView` do wry
//    implementa `draggingEntered/Updated/performDragOperation` e só devolve o
//    evento ao WebKit quando o handler diz `false`
//    (`wry-0.55.1/src/wkwebview/drag_drop.rs:35-96`); o handler do Tauri devolve
//    `true` SEMPRE (`tauri-runtime-wry-2.11.3/src/lib.rs:4862-4896`). No macOS,
//    todo arrasto que entra na view passa por aí, inclusive o que nasceu DENTRO
//    da página: `dragover` e `drop` nunca chegam ao DOM, e sem `dragover` nem o
//    último alvo existe para o `dragend` aproveitar.
//
// 2) Ponteiro (`pointerdown` → `pointermove` → `pointerup`): não existe sessão de
//    arrasto do sistema, então não há o que interceptar. É o caminho que o PRD
//    do capricho já previa ("senão arraste por ponteiro") e é o que vale aqui.
//
// Este módulo é a memória do gesto: quem está sendo arrastado e sobre qual alvo,
// entre o começo e o fim. Não é estado de aplicação (não aparece na tela, não
// persiste), por isso módulo e não store. A mecânica de ponteiro mora em
// `components/common/CamadaDeArrasto.tsx`; as regras de destino, em `lib/soltura.ts`.

export type CargaArrastada =
  /** Reordenação na barra lateral. */
  | { tipo: "projeto"; id: string }
  /** Conversa só reordena DENTRO do projeto dela. */
  | { tipo: "conversa"; projectId: string; id: string }
  /** Arquivo ou pasta da árvore do projeto, caminho RELATIVO à raiz. */
  | { tipo: "arquivo"; id: string; caminho: string; pasta: boolean }
  /** Vários itens da árvore selecionados, com o caminho ABSOLUTO. */
  | { tipo: "arquivos"; id: string; itens: readonly { caminho: string; pasta: boolean }[] }
  /** Texto selecionado em qualquer lugar do app (fio, diff, Bastidores). */
  | { tipo: "texto"; id: string; texto: string }
  /** Imagem que já está no fio (anexo de uma mensagem): volta ao rascunho como
   *  anexo, sem passar pelo disco de novo. */
  | { tipo: "imagem"; id: string; anexo: AnexoArrastado }

/** Onde a pessoa está soltando. Alvo é TIPADO porque os dois consumidores não
 *  podem se atropelar: a barra lateral só conclui o que é dela, e o composer
 *  só o que é dele. */
/** O anexo, só com o que o rascunho precisa (evita importar o tipo inteiro de
 *  anexos aqui, que é camada de disco). */
export interface AnexoArrastado {
  path: string
  name: string
  kind: string
  mime?: string | null
  bytes?: number
}

export type AlvoDoArrasto =
  | { tipo: "reordenar"; id: string }
  | { tipo: "composer" }
  /** A coluna da conversa inteira (fio e composer): só arquivo solta aí. */
  | { tipo: "conversa" }

export interface ArrastoConcluido {
  carga: CargaArrastada
  alvo: AlvoDoArrasto
}

let carga: CargaArrastada | null = null
let ultimoAlvo: AlvoDoArrasto | null = null

export function comecarArrasto(nova: CargaArrastada): void {
  carga = nova
  ultimoAlvo = null
}

export function cargaArrastada(): CargaArrastada | null {
  return carga
}

/** Chamado a cada `dragover` de um alvo válido: é ele que sobrevive quando o
 *  `drop` não chega. `null` esquece o alvo (saiu de cima de tudo). */
export function pairarSobre(alvo: AlvoDoArrasto | null): void {
  if (!carga) return
  ultimoAlvo = alvo
}

/** Encerra o gesto e diz o que fazer. `alvoExplicito` é o que estava sob o
 *  ponteiro ao soltar; sem ele vale o último alvo pairado. Devolve `null`
 *  quando não há arrasto, quando o gesto acabou no vazio ou quando soltou em
 *  cima de si mesmo. Em qualquer caso o gesto se limpa: um arrasto não se
 *  conclui duas vezes, e carga velha nunca sobra para o próximo. */
export function concluirArrasto(
  alvoExplicito?: AlvoDoArrasto | null,
): ArrastoConcluido | null {
  const atual = carga
  const alvo = alvoExplicito ?? ultimoAlvo
  cancelarArrasto()
  if (!atual || !alvo) return null
  if (alvo.tipo === "reordenar" && alvo.id === atual.id) return null
  return { carga: atual, alvo }
}

/** O alvo escrito no DOM (`data-arrasto-alvo="composer"` ou
 *  `data-arrasto-alvo="reordenar:<id>"`). Atributo ausente ou estranho vira
 *  `null`: alvo desconhecido nunca recebe nada. */
export function alvoDoAtributo(valor: string | null | undefined): AlvoDoArrasto | null {
  if (!valor) return null
  if (valor === "composer") return { tipo: "composer" }
  if (valor === "conversa") return { tipo: "conversa" }
  const [tipo, ...resto] = valor.split(":")
  const id = resto.join(":")
  return tipo === "reordenar" && id ? { tipo: "reordenar", id } : null
}

/** Some com o gesto sem concluir (troca de tela, teste). */
export function cancelarArrasto(): void {
  carga = null
  ultimoAlvo = null
}
