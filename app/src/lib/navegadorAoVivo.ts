// O agente usando o navegador do projeto aparece ao vivo, sem a pessoa ter de
// procurar (ADR-229). Pedido de 23/09/2026, olhando o sicredi: o fio mostrava
// `frota-browser · browser_click` e capturas, e a aba Navegador nem estava na
// tira. "Era isso que eu queria, ver em tempo real isso sendo aberto, sendo
// usado."
//
// O que abre é a ABA Navegador, ao lado da Conversa. A janela flutuante é
// escolha da pessoa (o botão na aba), nunca da Frota. Regras:
//  - uma vez por TURNO: voltou para a conversa ou fechou a aba, fica assim até
//    o próximo turno do agente (trocar de aba a cada clique dele seria brigar
//    com a pessoa);
//  - só na conversa que está na tela: o navegador é do projeto, mas quem está
//    em outra conversa não pediu para ver este trabalho;
//  - já vendo (aba Navegador à vista, ou a janela flutuante que a pessoa
//    escolheu), nada muda;
//  - a aba só vai para a frente saindo da Conversa, e não com a pessoa
//    digitando: aí ela entra na tira e espera o clique. Arquivo ou diff à
//    vista foram escolha da pessoa, e o texto no meio não pode ir para outro
//    lugar.
// Abrir a vista é tela, não efeito: o agente não ganha nada com isso, e o
// piloto continua com as regras de sempre (ADR-131).

import type { WorkEvent } from "@/lib/work"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useNavegadorFlutuante } from "@/store/navegadorFlutuante"

/** Turnos em que a aba já abriu (ou em que a pessoa já estava vendo). */
const turnosVistos = new Set<string>()

/** O foco está num campo de texto (composer, busca, nota). */
export function digitandoAgora(): boolean {
  if (typeof document === "undefined") return false
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "INPUT"
}

export function vistaDoAgenteNoNavegador(event: WorkEvent, digitando: () => boolean = digitandoAgora): void {
  if (event.kind !== "browser_agent_active") return
  const { runId, convId, projectPath } = event.data
  if (!runId || !projectPath || turnosVistos.has(runId)) return
  const app = useApp.getState()
  const projeto = app.projects.find((p) => p.path === projectPath)
  if (!projeto || projeto.id !== app.activeProjectId) return
  if (convId && useChat.getState().activeId !== convId) return
  turnosVistos.add(runId)
  if (app.mainTab.kind === "navegador") return
  if (useNavegadorFlutuante.getState().flutuando[projeto.id]) return
  if (app.mainTab.kind === "conversa" && !digitando()) app.openBrowserTab()
  else app.showBrowserTab()
}

/** Só para teste. */
export function _resetNavegadorAoVivo(): void {
  turnosVistos.clear()
}
