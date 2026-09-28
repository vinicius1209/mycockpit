// O QUE É UM ITEM DO FIO.
//
// A união saiu do `store/chat.ts` quando a catraca de tamanho disparou, e é um
// recorte fechado: a forma de cada coisa que aparece na conversa, sem nenhuma
// regra de estado junto. A porta continua sendo `@/store/chat`, que re-exporta
// `ChatItem` — nenhum call site mudou.

import type { CostSource } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import type { CausaDoCorte } from "@/lib/corte"
import type { DeferredWork, ManagedProcess } from "@/lib/work"

/** Um parecer levado num pedido: o bastante para a linha "↳ parecer da Íris"
 *  achar o parecer no fio e dizer de quem é. */
/** Papel de uma fala do agente no turno. */
export type FaseDaFala = "narracao" | "resposta"

export interface ParecerLevado {
  itemId: string
  personaId: string
  personaNome: string
}

type ChatItemBody =
  | {
      kind: "user"
      id: string
      text: string
      attachments?: Attachment[]
      /** Fala ENDEREÇADA a um conselheiro (`@aline …`, Especialistas E1), não ao
       *  executor. O pedido é seu e aparece no fio como seu — mas não é turno de
       *  executor: não trava agent/preset e não rouba a injeção de
       *  persona/doutrina do turno-1 (ver `executorItems`). Ausente = fala com
       *  quem pilota, o caso normal. */
      advisorTo?: { id: string; name: string }
      /** O texto é do APP: a retomada automática depois de um limite (ADR-250).
       *  Vai ao motor como pedido, mas não foi você que escreveu, e a régua e
       *  o histórico dizem isso em vez de pôr na sua boca. */
      retomada?: true
      /** Os pareceres que ESTE pedido levou ao executor (ADR-267): o bloco sai
       *  do rascunho no envio, e sem isto a mensagem enviada não dizia nada. */
      pareceres?: ParecerLevado[]
    }
  | {
      kind: "text"
      id: string
      text: string
      /** O motor disse que esta fala é narração do meio do turno ou a resposta.
       *  Ausente = não disse; o fio decide pela posição (`lib/vozDoTurno`). */
      fase?: FaseDaFala
    }
  | {
      kind: "tool"
      id: string
      name: string
      input: unknown
      /** tool_use_id do CLI (liga o tool_result à linha). */
      toolId?: string
      /** O motor do turno que fez a ação: é quem aparece em "quem alterou"
       *  mesmo depois de a conversa trocar de motor (ADR-280). */
      agent?: string
      /** Tool `Task`/agent que originou esta ação. Preservado do provider para
       *  reconstruir a árvore do Fio Vivo após restart. */
      parentToolId?: string
      /** Síntese final do subagente, mantida dentro do nó que o criou em vez de
       *  virar uma fala solta do executor principal. */
      agentSummary?: string
      /** Processo externo cujo ciclo de vida pertence à Frota. */
      managedProcess?: ManagedProcess
      /** Trabalho DIFERIDO do provider (tool Workflow/background task): nó com
       *  ciclo de vida PRÓPRIO, assíncrono ao turno (deferred-work-plan D1.2). */
      deferred?: DeferredWork
      /** Último evento observável desta ação (resultado/retorno do subagente).
       * `ts` continua sendo o nascimento, usado na cronologia do transcript. */
      activityAt?: number
      /** Resumo do resultado (texto truncado + nº de linhas do output).
       *  `interrupted`: fechada por um corte seu, não falhou (ADR-180). */
      result?: { ok: boolean; text: string; lines: number; interrupted?: true }
      /** Evidência VISUAL do resultado (browser-plan B1): paths relativos ao
       *  app_data_dir ("evidence/<convId>/<toolId>-<idx>.<ext>"). Persistem no
       *  snapshot (replay-safe); arquivo sumido do disco vira placeholder na
       *  UI, nunca imagem quebrada. */
      images?: string[]
    }
  | {
      kind: "result"
      id: string
      ok: boolean
      text?: string
      costUsd?: number
      costSource?: CostSource
      model?: string | null
      usage?: {
        input: number
        output: number
        cacheRead: number
        cacheCreation: number
      }
      /** Duração total do turno em ms (start→result). */
      durationMs?: number
      /** Reações do usuário ao RESULTADO consolidado deste turno. Persistem no
       *  próprio transcript e são agnósticas ao provider que o executou. */
      reactions?: string[]
    }
  | { kind: "error"; id: string; message: string }
  /** Nota do HUMANO ancorada num item (`anchorId`). Modelo A: viaja SEMPRE —
   *  recap + transcript (docs/notas-no-fio-plan.md), senão é decoração. */
  | { kind: "note"; id: string; text: string; anchorId: string; sent?: boolean }
  /** Plano proposto num turno `plan_first`. `decision` ausente = ainda na mesa.
   *  Por que é item e não campo: store/chat/planGate.ts. */
  | { kind: "planGate"; id: string; text: string; decision?: "approved" | "discarded" | "superseded" }
  | { kind: "cancelled"; id: string; cause?: CausaDoCorte }
  | {
      kind: "notice"
      id: string
      message: string
      /** `decisao`: registro de um gesto seu sobre um pedido do agente
       *  ("Você ligou o navegador do Maclan", ADR-261). Ausente: aviso do
       *  sistema. */
      tom?: "decisao"
    }
  /** Limite de uso/cota do agent atingido: cartão acionável (revezamento). */
  | { kind: "limit"; id: string; message: string; resetHint?: string }
  /** Parecer de um CONSELHEIRO (Especialistas E1): uma persona chamada inline
   *  (`@aline`) opinou sobre o contexto atual, read-only. Item ADITIVO — não é
   *  turno de executor. Carimba persona id+version+digest (auditoria/drift). */
  | {
      kind: "advice"
      id: string
      personaId: string
      personaName: string
      personaVersion: number
      digest: string
      /** A pergunta que originou o parecer (rastro). */
      question: string
      text: string
      /** "mensagem": o parecer nasceu depois da ADR-267 e se desenha como
       *  mensagem (balão, rodapé de ações). Ausente: o cartão de antes, que
       *  os pareceres antigos mantêm. */
      estilo?: "mensagem"
    }

/** Todo item do fio carrega o instante em que NASCEU (epoch ms), carimbado na
 *  criação com Date.now() (estilo Slack: a hora vira cabeçalho do grupo).
 *  Opcional: itens gravados antes deste campo não têm carimbo — a UI tolera
 *  `undefined` e omite a hora nesses casos (sem "undefined" fantasma). A
 *  intersecção sobre a união preserva o discriminante `kind` (narrowing e
 *  Extract<> seguem funcionando) sem repetir o campo em cada variante. */
export type ChatItem = ChatItemBody & { ts?: number }
