// O nome da conversa no fim do primeiro turno: o QUANDO, o SE e o efeito.
//
// Molde de `store/chat/suggestions.ts` (token de invalidação por conversa,
// anticoncorrência, fire-and-forget). Duas diferenças que importam:
//
// 1. **Não é ação do store.** `store/chat.ts` está congelado no ratchet de
//    tamanho (2150 linhas), então isto é uma função de módulo que lê
//    `useChat.getState()`. Quem chama é `lib/notify.ts`, no `notifyTurnEnd`,
//    que é o funil de fim de turno que TODOS os cinco caminhos já atravessam.
// 2. **Roda uma vez na vida da conversa.** A condição não é um contador
//    persistido: é `title === deriveTitle(items)`. Título que ninguém apropriou
//    satisfaz isso; assim que o helper (ou a pessoa) renomeia, a igualdade
//    quebra e nunca mais volta. Dispensa coluna, flag e migração, e sobrevive a
//    replay — o estado vive nos próprios items.
//
// O título que a PESSOA escreveu nunca é tocado (ADR-142: nada de autocorrigir
// texto humano). Isso inclui o `Nome (fork)` de um ramo, que também não bate
// com `deriveTitle`.

import { deriveTitle } from "@/lib/convTitle"
import { helperDoProjeto } from "@/lib/helperDoProjeto"
import { generateUtilityText } from "@/lib/utility"
import {
  contextoDoTitulo,
  parseTitulo,
  TITULO_DEADLINE_MS,
  TITULO_PROMPT,
} from "@/lib/tituloDaConversa"
import { isTauri } from "@/lib/db"
import { useApp } from "@/store/app"
import { useChat, type ChatItem } from "@/store/chat"
import type { WorkEvent } from "@/lib/work"

/** Até que turno ainda vale tentar. O caso de projeto é o turno 1; 2 e 3 só
 *  existem para a conversa cujo primeiro turno pegou o helper fora do ar. Passou
 *  disso, a conversa fica com o nome cru e ninguém mais gasta chamada com ela. */
export const TITULO_MAX_TURNOS = 3

/** Token de geração por conversa: descarta a resposta atravessada por um run
 *  novo. Memória de MÓDULO, como nas sugestões. */
const gen: Record<string, number> = {}

export function invalidarTitulo(convId: string) {
  gen[convId] = (gen[convId] ?? 0) + 1
}

/** A conversa ainda pode ser nomeada pelo helper? Pura, e é a regra inteira. */
export function podeNomear(
  title: string | null | undefined,
  items: readonly ChatItem[],
): boolean {
  const turnos = items.filter((it) => it.kind === "user").length
  if (turnos === 0 || turnos > TITULO_MAX_TURNOS) return false
  // `null` = nunca nomeada. Igual ao derivado = nomeada pelo app, não por gente.
  return !title || title === deriveTitle(items)
}

/**
 * Nomeia a conversa pelo helper, se ela ainda não tem nome de gente.
 *
 * Fire-and-forget de propósito: a notificação de fim de turno NÃO espera por
 * isto. ADR-142 já faz HUD, bandeja e Companion resolverem o título pelo
 * `convId`, então o nome novo aparece nos três assim que cai, sem reescrever o
 * evento que já foi congelado no feed.
 */
export async function nomearConversa(convId: string): Promise<void> {
  if (!isTauri()) return
  const chat = useChat.getState()
  const c = chat.byId[convId]
  if (!c || c.running || c.finalizing) return
  const meta = (chat.conversationsByProject[c.projectId] ?? chat.conversations).find(
    (cv) => cv.id === convId,
  )
  if (!podeNomear(meta?.title, c.items)) return
  const helperModel = helperDoProjeto(c.projectId)
  if (!helperModel) return // sem inteligência aqui: fica o nome cru, sem teatro
  const proj = useApp.getState().projects.find((p) => p.id === c.projectId)
  const cwd = c.worktreePath ?? proj?.path ?? ""
  if (!cwd) return // o one-shot precisa de um diretório que exista

  const meuGen = gen[convId] ?? 0
  let bruto: string
  try {
    bruto = await generateUtilityText({
      task: "conversation_title",
      model: helperModel,
      cwd,
      prompt: `${TITULO_PROMPT}\n\n${contextoDoTitulo(c.items)}`,
      deadlineMs: TITULO_DEADLINE_MS,
    })
  } catch (e) {
    // Sem nome novo a conversa continua com o texto que a pessoa escreveu, que
    // é um desfecho honesto. Não silencia: o warn é o rastro de quem investiga.
    console.warn("[título] helper não respondeu:", e)
    return
  }
  if ((gen[convId] ?? 0) !== meuGen) return // um run novo começou: descarta

  const nome = parseTitulo(bruto)
  if (!nome) return // resposta sem nome usável → fica o nome cru

  // Re-checa DEPOIS da chamada: a pessoa pode ter renomeado na mão durante os
  // 4 segundos, e a mão dela vence sempre.
  const agora = useChat.getState()
  const depois = agora.byId[convId]
  const metaDepois = (
    agora.conversationsByProject[depois?.projectId ?? ""] ?? agora.conversations
  ).find((cv) => cv.id === convId)
  if (!depois || !podeNomear(metaDepois?.title, depois.items)) return

  await agora.renameConversation(convId, nome)
}

/**
 * O título que o PRÓPRIO agente deu no primeiro turno (ADR-246), pela tool
 * `conversation_title` do `frota-work`. Sem helper configurado a conversa ficava
 * com a primeira frase crua para sempre; o agente já leu o pedido e sabe dizer
 * o assunto. Mesma régua do helper: `parseTitulo` limpa e recusa o que não é
 * nome, e `podeNomear` garante que o nome que a pessoa deu nunca é tocado.
 * Chegando antes, ele também dispensa o helper no fim do turno (o título deixa
 * de ser o derivado, e `podeNomear` fecha a porta).
 */
export async function tituloDoAgente(event: WorkEvent): Promise<void> {
  if (event.kind !== "conversation_title") return
  const convId = event.data.convId
  const nome = parseTitulo(event.data.title ?? "")
  if (!convId || !nome) return
  const chat = useChat.getState()
  const c = chat.byId[convId]
  if (!c) return
  const meta = (chat.conversationsByProject[c.projectId] ?? chat.conversations).find(
    (cv) => cv.id === convId,
  )
  if (!podeNomear(meta?.title, c.items)) return
  await chat.renameConversation(convId, nome)
}
