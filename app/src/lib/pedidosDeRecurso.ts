// O agente pediu um RECURSO (o navegador do projeto ou o computador) e está
// esperando o seu gesto (ADR-261, mock `docs/mocks/avisos.html`).
//
// Até aqui era um toast sem prazo no centro de baixo, em cima do composer, e
// fechá-lo era recusar: dava para dizer "não" sem querer. Agora o pedido entra
// na fila de interações como o kind local `recurso`, irmão do gate de plano, e
// ganha tudo o que um pedido tem: cartão dentro da conversa que pediu (ou no
// canto, se você está noutra), ponto na barra lateral, sino, bandeja,
// notificação do sistema e Companion. "Agora não" é um botão.
//
// Depois do gesto, o cartão ASSENTA numa linha do fio ("Você ligou o navegador
// do Maclan"), que fica como histórico. Nenhum toast de confirmação: o
// resultado aparece onde você olhou.
//
// Este módulo não importa a fila (`store/interactions`), que o importa para
// executar a resposta: quem enfileira é `lib/eventosDeTrabalho`.

import { avisar, mensagemDe } from "@/lib/avisos"
import { recusarPedidoDeNavegador, startProjectBrowser } from "@/lib/browser"
import type { InteractionRequest, RecursoData } from "@/lib/interaction"
import { desktopGrantRun, desktopRecusarPedido } from "@/lib/resources"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

export type Recurso = RecursoData["recurso"]

export function idDoPedido(recurso: Recurso, runId: string): string {
  return `recurso:${recurso}:${runId}`
}

/** O pedido na forma da fila. `run_id` amarra ao turno; a conversa vem no
 *  payload, como no gate de plano. Puro. */
export function pedidoDeRecurso(
  recurso: Recurso,
  e: { runId: string; convId: string; projectPath?: string | null },
): InteractionRequest {
  return {
    id: idDoPedido(recurso, e.runId),
    run_id: e.runId,
    kind: "recurso",
    data: { recurso, convId: e.convId, projectPath: e.projectPath ?? null } satisfies RecursoData,
  }
}

/** Nome do projeto de um caminho, ou `null` se ele não está na lista. */
export function nomeDoProjeto(path: string | null | undefined): string | null {
  if (!path) return null
  return useApp.getState().projects.find((p) => p.path === path)?.name ?? null
}

export interface TextoDoPedido {
  titulo: string
  detalhe: string
  sim: string
  /** O resumo de uma linha, para sino, bandeja e notificação do sistema. */
  resumo: string
  /** O que o agente pediu, para "o turno parou pedindo …". */
  oQue: string
}

/** O que o cartão diz. `projeto` é o nome já resolvido. Puro. */
export function textoDoPedido(data: RecursoData, projeto: string | null): TextoDoPedido {
  if (data.recurso === "navegador") {
    const doProjeto = projeto ? `do ${projeto}` : "do projeto"
    return {
      titulo: `Usar o navegador ${doProjeto}`,
      detalhe:
        "Está desligado. Ligar abre um Chromium da Frota em segundo plano, e o agente segue no mesmo turno. Ele espera até 90 s.",
      sim: "Ligar navegador",
      resumo: `Ligar o navegador ${doProjeto}`,
      oQue: `o navegador ${doProjeto}`,
    }
  }
  return {
    titulo: "Ver a tela e controlar o computador",
    detalhe:
      "Vale só para este turno: ele poderá capturar a tela, mover o mouse e digitar, e você revoga quando quiser. Ele espera até 90 s.",
    sim: "Liberar neste turno",
    resumo: "Liberar o computador neste turno",
    oQue: "o computador",
  }
}

/** A linha que fica no fio depois da decisão. Puro. */
export function registroDaDecisao(data: RecursoData, projeto: string | null, sim: boolean): string {
  const doProjeto = projeto ? `do ${projeto}` : "do projeto"
  if (data.recurso === "navegador")
    return sim ? `Você ligou o navegador ${doProjeto}.` : `Você preferiu não ligar o navegador ${doProjeto}.`
  return sim ? "Você liberou o computador para este turno." : "Você preferiu não liberar o computador."
}

function registrar(convId: string, message: string): void {
  void useChat
    .getState()
    .appendItems(convId, [{ kind: "notice", id: crypto.randomUUID(), message, tom: "decisao", ts: Date.now() }])
    .catch((err) => console.error("[pedido] a decisão não entrou no fio:", err))
}

/**
 * Executa a sua decisão sobre um pedido de recurso. A fila já tirou o pedido
 * da tela; se o gesto falhar (o navegador não subiu), `devolver` põe o pedido
 * de volta, porque o agente continua esperando, e o erro aparece com o dono.
 */
export async function responderRecurso(
  req: InteractionRequest,
  sim: boolean,
  devolver: (req: InteractionRequest) => void,
): Promise<void> {
  const data = req.data as RecursoData
  const runId = req.run_id ?? ""
  const projeto = nomeDoProjeto(data.projectPath)
  const origem = { projeto: data.projectPath ?? null, conversa: data.convId }
  try {
    if (data.recurso === "navegador") {
      if (!data.projectPath) throw new Error("o pedido chegou sem o projeto")
      await (sim ? startProjectBrowser(data.projectPath) : recusarPedidoDeNavegador(data.projectPath))
    } else {
      await (sim ? desktopGrantRun(runId) : desktopRecusarPedido(runId))
    }
    registrar(data.convId, registroDaDecisao(data, projeto, sim))
  } catch (err) {
    console.error("[pedido] a decisão não foi executada:", err)
    devolver(req)
    const doQue = textoDoPedido(data, projeto).oQue
    const falha = sim
      ? `Não consegui ${data.recurso === "navegador" ? "ligar" : "liberar"} ${doQue}.`
      : `Sua recusa de ${doQue} não chegou ao agente.`
    avisar.erro(falha, {
      origem,
      detalhe: `${mensagemDe(err)} O pedido voltou para a conversa.`,
    })
  }
}
