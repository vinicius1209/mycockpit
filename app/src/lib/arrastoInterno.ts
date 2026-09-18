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
  /** Reordenação na barra lateral. */
  | { tipo: "projeto"; id: string }
  /** Conversa só reordena DENTRO do projeto dela. */
  | { tipo: "conversa"; projectId: string; id: string }
  /** Arquivo ou pasta da árvore do projeto, caminho RELATIVO à raiz. */
  | { tipo: "arquivo"; id: string; caminho: string; pasta: boolean }
  /** Texto selecionado em qualquer lugar do app (fio, diff, Bastidores). */
  | { tipo: "texto"; id: string; texto: string }

/** Onde a pessoa está soltando. Alvo é TIPADO porque os dois consumidores não
 *  podem se atropelar: a barra lateral só conclui o que é dela, e o composer
 *  só o que é dele. */
export type AlvoDoArrasto =
  | { tipo: "reordenar"; id: string }
  | { tipo: "composer" }

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

/** Encerra o gesto e diz o que fazer.
 *
 *  `aceita` é o tipo de alvo de QUEM PERGUNTA: gesto que não é dele volta
 *  `null` e fica intacto, para o dono concluir depois (o `dragend` da origem
 *  chega antes do `drop` do composer em alguns caminhos, e sem isso um
 *  consumidor apagaria o gesto do outro).
 *
 *  `alvoExplicito` é o do `drop`, quando ele chega; sem ele vale o último alvo
 *  pairado. Devolve `null` também quando não há alvo ou quando soltou em cima
 *  de si mesmo. Concluído, o gesto se limpa: não acontece duas vezes. */
export function concluirArrasto(
  aceita: AlvoDoArrasto["tipo"],
  alvoExplicito?: AlvoDoArrasto | null,
): ArrastoConcluido | null {
  const atual = carga
  const alvo = alvoExplicito ?? ultimoAlvo
  if (!atual) return null
  // Sem alvo nenhum o gesto acabou no vazio: ninguém mais vai concluí-lo, e
  // deixá-lo aberto faria o próximo arrasto herdar carga velha.
  if (!alvo) {
    cancelarArrasto()
    return null
  }
  // Alvo de outro consumidor: devolve sem consumir, para o dono concluir.
  if (alvo.tipo !== aceita) return null
  const mesmo = alvo.tipo === "reordenar" && alvo.id === atual.id
  cancelarArrasto()
  return mesmo ? null : { carga: atual, alvo }
}

/** Some com o gesto sem concluir (troca de tela, teste). */
export function cancelarArrasto(): void {
  carga = null
  ultimoAlvo = null
}
