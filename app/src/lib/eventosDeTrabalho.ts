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

/** Liga a escuta uma vez por janela e nunca desliga. Idempotente. */
export function iniciarEventosDeTrabalho(): void {
  if (iniciada || !isTauri()) return
  iniciada = true
  void listenWorkEvents((event) => {
    useChat.getState().handleWorkEvent(event)
    pedidoDeNavegador(event)
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
