// ARRASTAR DENTRO DA JANELA.
//
// Spike S2, respondido em 18/09/2026 com o app instalado: arrastar um projeto na
// barra lateral MOSTRA o arrasto (o fantasma segue o cursor) e não reordena
// nada. Ou seja, o `dragstart` acontece; o que se perde é o resto.
//
// A causa está no `dataTransfer`: os dois pontos que decidiam o gesto liam um
// tipo PRÓPRIO (`application/x-mycockpit-project`, `…-conv-<projeto>`), e esse
// tipo não sobrevive à travessia pelo pasteboard do sistema — do outro lado ele
// chega com outro nome. Com `types.includes(…)` falso, o `dragover` nunca
// chamava `preventDefault`, e sem isso o `drop` nem é entregue.
//
// A saída é não depender do `dataTransfer` para NADA além do visual: o que está
// sendo arrastado mora aqui, em memória, enquanto o gesto dura. E o gesto se
// conclui também no `dragend`, que é do elemento de ORIGEM e acontece mesmo
// quando o `drop` se perde no caminho — é o que torna isto robusto sem depender
// de como cada webview trata o arrasto.
//
// Módulo, e não store, porque isto não é estado de aplicação: vive entre o
// `dragstart` e o `dragend`, não aparece na tela e não persiste.

export type CargaArrastada =
  | { tipo: "projeto"; id: string }
  /** Conversa só reordena DENTRO do projeto dela. */
  | { tipo: "conversa"; projectId: string; id: string }

export interface ArrastoConcluido {
  carga: CargaArrastada
  /** Sobre quem soltou. */
  alvo: string
}

let carga: CargaArrastada | null = null
let ultimoAlvo: string | null = null

export function comecarArrasto(nova: CargaArrastada): void {
  carga = nova
  ultimoAlvo = null
}

export function cargaArrastada(): CargaArrastada | null {
  return carga
}

/** Chamado a cada `dragover` de um alvo válido: é ele que sobrevive quando o
 *  `drop` não chega. `null` esquece o alvo (saiu de cima de tudo). */
export function pairarSobre(alvo: string | null): void {
  if (!carga) return
  ultimoAlvo = alvo
}

/** Encerra o gesto e diz o que fazer. `alvoExplicito` é o do `drop`, quando ele
 *  chega; sem ele vale o último alvo pairado. Devolve `null` quando não há nada
 *  a fazer (sem arrasto, sem alvo, ou soltou em cima de si mesmo), e SEMPRE
 *  limpa: um gesto não pode ser concluído duas vezes. */
export function concluirArrasto(alvoExplicito?: string | null): ArrastoConcluido | null {
  const atual = carga
  const alvo = alvoExplicito ?? ultimoAlvo
  carga = null
  ultimoAlvo = null
  if (!atual || !alvo || alvo === atual.id) return null
  return { carga: atual, alvo }
}

/** Some com o gesto sem concluir (troca de tela, teste). */
export function cancelarArrasto(): void {
  carga = null
  ultimoAlvo = null
}
