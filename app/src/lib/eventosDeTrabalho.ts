// A escuta dos eventos do canal de trabalho (`work://event`: plano publicado,
// etapa atualizada, processo gerenciado) pertence ao BOOT da janela, não a uma
// tela.
//
// Até 21/09/2026 ela morava num `useEffect` do `ChatPanel`. Às 18:22 desse dia
// uma exceção desmontou a árvore do React (a tela preta da ADR-223) e a escuta
// foi embora junto. O turno seguiu rodando, o gateway respondeu
// `{"accepted":true}` a cinco `work_update`, e NENHUM virou item do fio: o plano
// ficou parado em 2/5 para sempre, com as etapas marcadas como "sem conclusão
// registrada". Ingestão de estado não pode depender de um componente estar
// montado, ainda mais agora que a conversa tem fronteira de erro própria.

import { avisar } from "@/lib/avisos"
import type { InteractionRequest, RecursoData } from "@/lib/interaction"
import { idDoPedido, nomeDoProjeto, pedidoDeRecurso } from "@/lib/pedidosDeRecurso"
import { announceArrival, useInteractions } from "@/store/interactions"
import { useLiberacoes } from "@/store/liberacoes"
import { isTauri } from "@/lib/db"
import { listenWorkEvents, type WorkEvent } from "@/lib/work"
import { vistaDoAgenteNoNavegador } from "@/lib/navegadorAoVivo"
import { useChat } from "@/store/chat"
import { tituloDoAgente } from "@/store/chat/titulo"

let iniciada = false

/** Conversa de cada run que pediu o computador: o `desktop_state` do backend
 *  não repete a conversa, e a faixa do Revogar precisa dela. */
const conversaDoRun = new Map<string, string>()

/** Enfileira um pedido de recurso e avisa a chegada (sino, nativa), como o
 *  ouvinte de `interaction://request` faz com os pedidos do backend. */
function enfileirar(req: InteractionRequest): void {
  const fila = useInteractions.getState()
  const antes = fila.queue
  fila.push(req)
  if (useInteractions.getState().queue.length > antes.length) announceArrival(req, antes)
}

/** O pedido saiu da tela sem a sua decisão (o navegador ligou por outro
 *  caminho, o turno acabou, o agente desistiu). `true` se ele estava lá. */
function recolher(id: string): boolean {
  const estava = useInteractions.getState().queue.some((r) => r.id === id)
  useInteractions.getState().resolve(id)
  return estava
}

/** O agente pediu o navegador do projeto e ele está desligado (ADR-224 §1,
 *  ADR-228). Ligar é gesto da pessoa, e o agente ESPERA por ele (até 90 s):
 *  ligou, ele segue no mesmo turno; "Agora não", ele recebe na hora que você
 *  preferiu não ligar. Desde a ADR-261 o pedido é cartão na conversa que
 *  pediu, não toast (`lib/pedidosDeRecurso`). */
export function pedidoDeNavegador(event: WorkEvent): void {
  // O navegador ligou (por aqui ou por Configurações): o pedido já foi
  // atendido e sai da tela sozinho. Não é recusa.
  if (event.kind === "browser_state" && event.data.session) {
    const path = event.data.session.projectPath
    for (const r of useInteractions.getState().queue) {
      if (r.kind === "recurso" && (r.data as RecursoData).projectPath === path) recolher(r.id)
    }
    return
  }
  if (event.kind === "browser_autostarted" && event.data.projectPath) {
    const path = event.data.projectPath
    avisar.evento(`O agente ligou o navegador do ${nomeDoProjeto(path) ?? "projeto"}.`, {
      origem: { projeto: path, conversa: event.data.convId ?? null },
      detalhe: "Você autorizou isso em Configurações › Navegador, no projeto. Dá para revogar lá.",
    })
    return
  }
  if (event.kind !== "browser_needed") return
  const { runId, convId, projectPath } = event.data
  if (!runId || !convId || !projectPath) return
  enfileirar(pedidoDeRecurso("navegador", { runId, convId, projectPath }))
}

/** O agente pediu o computador (ADR-225). Mesmo idioma do pedido de navegador:
 *  cartão que espera a pessoa. Liberado, o cartão sai e a faixa do Revogar
 *  fica até o turno acabar; quem recolhe é o Rust (`desktop_state`), nunca um
 *  timer. */
export function pedidoDeDesktop(event: WorkEvent): void {
  const runId = event.data.runId
  if (!runId) return
  if (event.kind === "desktop_needed") {
    const convId = event.data.convId
    if (!convId) return
    conversaDoRun.set(runId, convId)
    enfileirar(pedidoDeRecurso("computador", { runId, convId }))
    return
  }
  if (event.kind !== "desktop_state") return
  // O pedido que sai porque o estado mudou (liberado, revogado, turno acabou)
  // não é recusa: sai sem responder.
  recolher(idDoPedido("computador", runId))
  if (!event.data.granted) {
    useLiberacoes.getState().encerrar(runId)
    conversaDoRun.delete(runId)
    return
  }
  const convId =
    event.data.convId ??
    conversaDoRun.get(runId) ??
    Object.entries(useChat.getState().byId).find(([, c]) => c.runId === runId)?.[0]
  if (convId) useLiberacoes.getState().liberar(runId, convId)
}

/** O agente parou de esperar por um recurso (teto de 90 s, recusa, fim do
 *  turno). Se o cartão ainda estava na tela, ninguém decidiu: ele sai e o fio
 *  guarda que o agente deixou de esperar. Antes o aviso ficava dizendo que ele
 *  esperava, para sempre (ADR-261). */
export function pedidoEncerrado(event: WorkEvent): void {
  if (event.kind !== "pedido_encerrado") return
  const { runId, convId, recurso } = event.data
  if (!runId || !recurso) return
  if (!recolher(idDoPedido(recurso, runId)) || !convId) return
  const peloQue = recurso === "navegador" ? "pelo navegador" : "pelo computador"
  void useChat
    .getState()
    .appendItems(convId, [
      {
        kind: "notice",
        id: crypto.randomUUID(),
        message: `O agente deixou de esperar ${peloQue} e seguiu sem ele.`,
        ts: Date.now(),
      },
    ])
    .catch((err) => console.error("[pedido] o fim da espera não entrou no fio:", err))
}

/** Liga a escuta uma vez por janela e nunca desliga. Idempotente. */
export function iniciarEventosDeTrabalho(): void {
  if (iniciada || !isTauri()) return
  iniciada = true
  void listenWorkEvents((event) => {
    useChat.getState().handleWorkEvent(event)
    pedidoDeNavegador(event)
    vistaDoAgenteNoNavegador(event)
    pedidoDeDesktop(event)
    pedidoEncerrado(event)
    void tituloDoAgente(event).catch((err) => console.error("[título] o do agente não entrou:", err))
  }).catch((erro) => {
    // Sem escuta o plano e os processos ficam mudos: tem que aparecer no log,
    // e a próxima chamada pode tentar de novo.
    iniciada = false
    console.error("[eventos de trabalho] não consegui ligar a escuta:", erro)
  })
}

/** Só para teste: volta ao estado de boot. */
export function _resetEventosDeTrabalho(): void {
  iniciada = false
}
