// A aba Alterações relê o `git status` sozinha quando algo que ela mostra pode
// ter mudado (pedido de 23/09/2026: "parece congelada, só atualiza quando eu
// clico no refresh").
//
// Antes ela só relia ao montar e depois das ações feitas DENTRO dela. Nada
// avisava que o agente tinha editado um arquivo, que um turno tinha acabado ou
// que você tinha feito commit pelo terminal.
//
// Sem releitura por tempo de propósito: cada leitura roda ~6 comandos git
// (`status -uall`, dois `diff --numstat`, `rev-list`…), e repetir isso a cada
// poucos segundos pesa em repositório grande. Os sinais são os que o app já
// tem:
//  - turno de QUALQUER conversa desta pasta terminando (a de fundo também);
//  - ação que muda arquivo terminando no meio do turno (a mesma classificação
//    do fio, `presentTool(...).category === "change"`; nenhum nome de motor);
//  - a janela voltando ao foco (commit, branch ou edição feitos fora).
// Amortecido: uma rajada de edições vira UMA leitura.

import { useEffect, useRef } from "react"
import { classificarAcao } from "@/lib/acaoDoFio"
import type { ChatItem } from "@/store/chat"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

/** Espera depois do último sinal antes de reler. */
const AMORTECIMENTO_MS = 700

interface ConversaVista {
  projectId: string
  worktreePath: string | null
  running: boolean
  finalizing: boolean
  items: readonly ChatItem[]
}

function acaoQueMudouArquivo(item: ChatItem): boolean {
  return item.kind === "tool" && !!item.result && classificarAcao(item).muda
}

/** Uma assinatura que só muda quando a pasta `cwd` pode ter mudado: quem está
 *  rodando e quantas ações que mudam arquivo já terminaram, por conversa desta
 *  pasta. Token de streaming não mexe nela. Puro. */
export function assinaturaDasMudancas(
  conversas: Record<string, ConversaVista>,
  cwd: string,
  pastaDoProjeto: (projectId: string) => string | null,
): string {
  const partes: string[] = []
  for (const [id, conversa] of Object.entries(conversas)) {
    const pasta = conversa.worktreePath ?? pastaDoProjeto(conversa.projectId)
    if (pasta !== cwd) continue
    let mudancas = 0
    for (const item of conversa.items) if (acaoQueMudouArquivo(item)) mudancas += 1
    const ativa = conversa.running || conversa.finalizing
    partes.push(`${id}:${ativa ? 1 : 0}:${mudancas}`)
  }
  return partes.sort().join("|")
}

export function useAlteracoesVivas(cwd: string, reler: () => void): void {
  const relerRef = useRef(reler)
  relerRef.current = reler

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const agendar = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        relerRef.current()
      }, AMORTECIMENTO_MS)
    }
    const pasta = (projectId: string) =>
      useApp.getState().projects.find((p) => p.id === projectId)?.path ?? null
    // A 1ª assinatura (a que classifica as ações de todas as conversas da
    // pasta) sai do caminho da montagem: abrir a aba não espera por ela.
    let anterior: string | null = null
    const inicial = setTimeout(() => {
      anterior ??= assinaturaDasMudancas(useChat.getState().byId, cwd, pasta)
    }, 0)
    const sair = useChat.subscribe((estado) => {
      const agora = assinaturaDasMudancas(estado.byId, cwd, pasta)
      if (anterior === null || agora === anterior) {
        anterior = agora
        return
      }
      anterior = agora
      agendar()
    })
    const aoVoltar = () => {
      if (document.visibilityState === "visible") agendar()
    }
    window.addEventListener("focus", agendar)
    document.addEventListener("visibilitychange", aoVoltar)
    return () => {
      clearTimeout(inicial)
      sair()
      if (timer) clearTimeout(timer)
      window.removeEventListener("focus", agendar)
      document.removeEventListener("visibilitychange", aoVoltar)
    }
  }, [cwd])
}
