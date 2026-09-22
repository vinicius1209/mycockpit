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

import { toast } from "sonner"
import { startProjectBrowser } from "@/lib/browser"
import { desktopGrantRun, desktopRevokeRun } from "@/lib/resources"
import { isTauri } from "@/lib/db"
import { listenWorkEvents, type WorkEvent } from "@/lib/work"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

let iniciada = false

/** O agente pediu o navegador do projeto e ele está desligado (ADR-224 §1).
 *  Ligar é gesto da pessoa: um aviso com o botão, nunca um navegador que sobe
 *  sozinho. O Rust já limita a um pedido por run a cada 30 s. */
export function pedidoDeNavegador(event: WorkEvent): void {
  // O navegador ligou (por aqui ou por Configurações): o pedido já foi
  // atendido e sai da tela sozinho.
  if (event.kind === "browser_state" && event.data.session) {
    toast.dismiss(`browser-needed:${event.data.session.projectPath}`)
    return
  }
  if (event.kind !== "browser_needed") return
  const path = event.data.projectPath
  if (!path) return
  const projeto = useApp.getState().projects.find((p) => p.path === path)
  // Pedido que espera uma decisão humana não expira sozinho: visto em
  // 22/09/2026, com 30 s o aviso já tinha sumido quando a pessoa olhou, e
  // "nada mudou na tela". Fica até ela ligar ou fechar.
  toast(`O agente quer usar o navegador do projeto${projeto ? ` ${projeto.name}` : ""}.`, {
    id: `browser-needed:${path}`,
    description: "Ele está desligado. Ligar abre um Chromium da Frota em segundo plano; o agente tenta de novo sozinho.",
    duration: Infinity,
    closeButton: true,
    action: {
      label: "Ligar navegador",
      onClick: () => {
        void startProjectBrowser(path)
          .then(() => {
            toast.dismiss(`browser-needed:${path}`)
            toast.success("Navegador do projeto ligado")
          })
          .catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
      },
    },
  })
}

function erroEmAviso(err: unknown): void {
  toast.error(err instanceof Error ? err.message : String(err))
}

/** O agente pediu o computador (ADR-225). Mesmo idioma do pedido de navegador:
 *  aviso que espera a pessoa, com o gesto no botão. Fechar é não liberar.
 *  Liberado, o aviso vira o de "pode controlar", com o Revogar à mão até o
 *  turno acabar; quem recolhe é o Rust (`desktop_state`), nunca um timer. */
export function pedidoDeDesktop(event: WorkEvent): void {
  const runId = event.data.runId
  if (!runId) return
  const pedido = `desktop-needed:${runId}`
  const liberado = `desktop-granted:${runId}`
  if (event.kind === "desktop_needed") {
    toast("O agente quer ver a tela e controlar o computador.", {
      id: pedido,
      description: "Liberar vale só para este turno: ele poderá capturar a tela, mover o mouse e digitar. Você pode revogar a qualquer momento.",
      duration: Infinity,
      closeButton: true,
      action: {
        label: "Liberar neste turno",
        onClick: () => void desktopGrantRun(runId).catch(erroEmAviso),
      },
    })
    return
  }
  if (event.kind !== "desktop_state") return
  toast.dismiss(pedido)
  if (!event.data.granted) {
    toast.dismiss(liberado)
    return
  }
  toast("O agente pode controlar o computador neste turno.", {
    id: liberado,
    description: "A liberação acaba sozinha quando o turno termina.",
    duration: Infinity,
    action: {
      label: "Revogar",
      onClick: () => void desktopRevokeRun(runId).catch(erroEmAviso),
    },
  })
}

/** Liga a escuta uma vez por janela e nunca desliga. Idempotente. */
export function iniciarEventosDeTrabalho(): void {
  if (iniciada || !isTauri()) return
  iniciada = true
  void listenWorkEvents((event) => {
    useChat.getState().handleWorkEvent(event)
    pedidoDeNavegador(event)
    pedidoDeDesktop(event)
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
