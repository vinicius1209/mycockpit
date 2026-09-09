// A MEMÓRIA QUE VIAJA NESTE TURNO.
//
// Extraído do `ChatPanel.despacharEnvio` quando a catraca de tamanho disparou
// (a regra da casa é DIVIDIR, nunca subir o teto). Não é um recorte arbitrário:
// as duas portas abaixo respondem a mesma pergunta — "o que o motor precisa
// saber do fio, e por qual canal?" — e já compartilhavam o export do transcript
// e o orçamento por janela de modelo.
//
// AGNÓSTICO POR CONSTRUÇÃO. Qual porta se abre depende de CAPABILITY
// (`sessionResume`, consultada dentro de `shouldInlineMemory` /
// `shouldAttachResumeFallback` em `lib/transcript`), nunca de nome de motor:
//
//  • motor SEM resume nativo → todo turno é sessão fresca, então a memória entra
//    no CORPO do prompt (recap + ponteiro pro transcript pleno em disco);
//  • motor COM resume nativo → o prompt não muda, e o recap vai como FALLBACK,
//    que o backend só usa se o resume falhar.
//
// Best-effort de ponta a ponta: falha no export vira só recap, falha no recap
// vira nada. O turno nunca morre por causa da memória — mas também nunca finge
// ter exportado o que não exportou (o ponteiro só entra se o arquivo existe).

import {
  buildMemoryPrompt,
  buildResumeFallback,
  exportConvContext,
  renderTranscript,
  shouldAttachResumeFallback,
  shouldInlineMemory,
} from "@/lib/transcript"
import { contextWindowFor } from "@/lib/contextWindow"
import type { ChatItem } from "@/store/chat"

export interface AlvoDaMemoria {
  convId: string
  /** Itens do fio, na ordem. */
  items: ChatItem[]
  /** Motor EFETIVO deste turno (preset/revezamento já resolvidos). */
  agent: string
  /** Motor do FIO — é o rótulo que o transcript exportado carrega. */
  agentDoFio: string
  /** cwd efetivo: worktree da conversa, senão a pasta do projeto. O caminho do
   *  ponteiro é relativo a ele, pra resolver de onde o agent roda. */
  cwd: string
  sessionId: string | null
  hasReply: boolean
  wheelSwitch: boolean
  /** Modelo resolvido vence o pedido: é o que o CLI de fato abriu (G1). */
  modelo: string | null
}

/** Exporta o transcript pleno e devolve o caminho RELATIVO, ou `null` se não deu.
 *  `null` não é erro: é a diferença entre citar um arquivo que existe e citar um
 *  que não existe. */
async function exportarPonteiro(alvo: AlvoDaMemoria): Promise<string | null> {
  try {
    const md = renderTranscript(alvo.items, { agent: alvo.agentDoFio })
    return await exportConvContext(alvo.cwd, alvo.convId, md)
  } catch {
    return null
  }
}

/**
 * Memória no CORPO do prompt, para motor sem resume nativo. Devolve o prompt
 * já montado (ou o original, quando esta porta não se aplica).
 */
export async function comMemoriaNoCorpo(
  promptText: string,
  alvo: AlvoDaMemoria,
): Promise<string> {
  const precisa = shouldInlineMemory({
    agent: alvo.agent,
    items: alvo.items,
    sessionId: alvo.sessionId,
    hasReply: alvo.hasReply,
    wheelSwitch: alvo.wheelSwitch,
  })
  if (!precisa) return promptText
  const pointer = await exportarPonteiro(alvo)
  return buildMemoryPrompt(
    alvo.items,
    pointer,
    promptText,
    contextWindowFor(alvo.modelo),
  )
}

/**
 * Recap de FALLBACK, para motor com resume nativo: o prompt não muda, e o
 * backend só usa isto se o resume falhar. `null` = sem fallback (não se aplica,
 * ou nem o recap deu pra montar).
 */
export async function fallbackDeResume(
  alvo: AlvoDaMemoria,
): Promise<string | null> {
  if (!shouldAttachResumeFallback(alvo.agent, alvo.items, alvo.sessionId)) {
    return null
  }
  try {
    const pointer = await exportarPonteiro(alvo)
    return buildResumeFallback(alvo.items, pointer, contextWindowFor(alvo.modelo))
  } catch {
    return null
  }
}
