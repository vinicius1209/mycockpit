// O núcleo PURO do fio: um evento do motor vira itens. Saiu do `store/chat.ts`
// (no teto da catraca) como recorte fechado; não mexe em running/finalizing,
// que é do controlFlow (Linear) e do status da lane (Fusion).

import type { AgentEvent } from "@/lib/agent"
import { reduceContextSnapshot, type ContextSnapshotState } from "@/lib/contextSnapshot"
import { resolutionNotice } from "@/lib/modelResolution"
import type { ConvState } from "@/store/chat"
import { progressTokens } from "@/store/chat/deferredLive"
import type { DeferredWork } from "@/lib/work"
import { reduceTerminalEvent } from "@/store/chat/terminalTools"
import type { FaseDaFala } from "@/store/chat/itens"
import { uid } from "@/store/chat/uid"

/** A fase do contrato do motor no vocabulário do fio; valor desconhecido
 *  não vira fase. */
function faseDoMotor(phase: string): FaseDaFala | null {
  if (phase === "final_answer") return "resposta"
  if (phase === "commentary") return "narracao"
  return null
}

function comFase(fase: FaseDaFala | null | undefined): { fase?: FaseDaFala } {
  return fase ? { fase } : {}
}

/** Campos que o reducer de itens usa no Linear e nas lanes do Fusion. */
export type ItemReducible = Pick<
  ConvState,
  "items" | "streamingTextId" | "faseDaFala" | "model" | "sessionId" | "startedAt"
> & ContextSnapshotState

/** Contexto opcional do run pro reducer validar pedido×resolvido no init da
 *  sessão (lib/modelResolution). Sem ctx, comporta como sempre (sem checagem). */
export interface ReduceCtx {
  agent: string
  reqModel: string | null
}

/** Núcleo PURO de itens (T1.1). NÃO mexe em running/finalizing/runId/startedAt,
 *  o controle fica no controlFlow (Linear) ou no status da lane (Fusion). */
export function reduceItems(
  c: ItemReducible,
  e: AgentEvent,
  ctx?: ReduceCtx,
  /** Instante de nascimento dos itens criados neste reduce (epoch ms).
   *  Injetável nos testes; default Date.now() em produção. */
  now: number = Date.now(),
): Partial<ItemReducible> {
  const contextSnapshot = reduceContextSnapshot(e)
  if (contextSnapshot) return contextSnapshot
  switch (e.type) {
    case "started":
      return {}
    case "startup_failed":
      return {
        items: [
          ...c.items,
          {
            kind: "notice",
            id: uid(),
            message: `Turno não iniciado. ${e.message}`,
            ts: now,
          },
        ],
        streamingTextId: null,
      }
    case "session": {
      // Divergência DURA pedido×resolvido → notice no fio (não bloqueia; a
      // verdade do CLI manda). Dedup por mensagem: cada retomada re-emite
      // `session`, e a mesma divergência não deve virar eco a cada turno.
      const warn = ctx
        ? resolutionNotice(ctx.agent, ctx.reqModel, e.model)
        : null
      const fresh =
        warn != null &&
        !c.items.some((it) => it.kind === "notice" && it.message === warn)
      return {
        sessionId: e.session_id,
        model: e.model,
        ...(fresh
          ? {
              items: [
                ...c.items,
                { kind: "notice", id: uid(), message: warn, ts: now },
              ],
            }
          : {}),
      }
    }
    // H2, texto completo do assistant: se já veio por deltas, descarta (dedup).
    case "text":
      if (c.streamingTextId) return { streamingTextId: null }
      return {
        items: [...c.items, { kind: "text", id: uid(), text: e.text, ts: now, ...comFase(c.faseDaFala) }],
        faseDaFala: null,
      }
    // O motor anunciou o papel da próxima fala: ela nasce item próprio.
    case "text_phase":
      return {
        faseDaFala: faseDoMotor(e.phase),
        ...(c.streamingTextId ? { streamingTextId: null } : {}),
      }
    case "subagent_text":
      return {
        items: c.items.map((it) =>
          it.kind === "tool" && it.toolId === e.parent_tool_id
            ? {
                ...it,
                agentSummary: [it.agentSummary, e.text].filter(Boolean).join("\n"),
                activityAt: now,
              }
            : it,
        ),
        streamingTextId: null,
      }
    // Fim de UM bloco de texto: fecha a bolha corrente pro próximo bloco
    // começar limpo (sem colar no anterior nem no meio da palavra). Genérico.
    case "text_stop":
      return c.streamingTextId ? { streamingTextId: null } : {}
    // H2, delta em streaming: acumula na bolha corrente (cria se não houver).
    case "text_delta": {
      if (c.streamingTextId) {
        // O reducer mais quente do app (roda por token): busca de trás para
        // frente e troca só o índice, preservando a identidade dos outros itens
        // (os memos a jusante dependem disso).
        let alvo = -1
        for (let i = c.items.length - 1; i >= 0; i--) {
          if (c.items[i].id === c.streamingTextId) {
            alvo = i
            break
          }
        }
        const it = alvo >= 0 ? c.items[alvo] : null
        // Bolha ausente: devolve o fio intocado, para ninguém a jusante
        // recalcular.
        if (!it || it.kind !== "text") return {}
        const items = c.items.slice()
        items[alvo] = { ...it, text: it.text + e.text }
        return { items }
      }
      const id = uid()
      return {
        items: [...c.items, { kind: "text", id, text: e.text, ts: now, ...comFase(c.faseDaFala) }],
        streamingTextId: id,
        faseDaFala: null,
      }
    }
    case "tool": {
      const existing = e.id
        ? c.items.findIndex((it) => it.kind === "tool" && it.toolId === e.id)
        : -1
      if (existing >= 0) {
        const item = c.items[existing]
        if (item.kind !== "tool") return { streamingTextId: null }
        const items = c.items.slice()
        // `item.updated` do provider repete o id. Isso é uma atividade real,
        // então renova o relógio sem criar outro cartão nem inventar output.
        items[existing] = {
          ...item,
          name: e.name,
          input: e.input,
          activityAt: now,
        }
        return { items, streamingTextId: null }
      }
      return {
        items: [
          ...c.items,
          {
            kind: "tool",
            id: uid(),
            name: e.name,
            input: e.input,
            toolId: e.id,
            parentToolId: e.parent_tool_id ?? undefined,
            ...(ctx?.agent ? { agent: ctx.agent } : {}),
            ts: now,
            activityAt: now,
          },
        ],
        streamingTextId: null,
      }
    }
    // Trabalho diferido do provider vira um item "DeferredWork" com ciclo de
    // vida próprio, pendurado no `Workflow` de origem (parentToolId). `stopped`
    // vira `interrupted`, e item terminal nunca volta a "rodando".
    case "deferred_work": {
      const terminal = e.status === "completed" || e.status === "stopped"
      const status: DeferredWork["status"] =
        e.status === "completed"
          ? "completed"
          : e.status === "stopped"
            ? "interrupted"
            : "running"
      const existing = c.items.some(
        (it) => it.kind === "tool" && it.deferred?.id === e.id,
      )
      if (!existing) {
        const deferred: DeferredWork = {
          id: e.id,
          toolUseId: e.tool_use_id,
          kind: e.kind,
          name: e.name,
          status,
          summary: e.summary,
          outputFile: e.output_file,
          tokens: progressTokens(e.progress),
          startedAt: now,
          updatedAt: now,
        }
        return {
          items: [
            ...c.items,
            {
              kind: "tool",
              id: `deferred-${e.id}`,
              name: "DeferredWork",
              input: { name: e.name, kind: e.kind, description: e.summary },
              toolId: `deferred:${e.id}`,
              parentToolId: e.tool_use_id ?? undefined,
              deferred,
              ts: now,
              activityAt: now,
              ...(terminal
                ? {
                    result: {
                      ok: status === "completed",
                      text: e.summary ?? "",
                      lines: e.summary ? e.summary.split("\n").length : 0,
                    },
                  }
                : {}),
            },
          ],
        }
      }
      return {
        items: c.items.map((it) => {
          if (it.kind !== "tool" || it.deferred?.id !== e.id) return it
          // terminal é definitivo: um Running atrasado não ressuscita o nó
          if (it.deferred.status !== "running" && !terminal) return it
          const deferred: DeferredWork = {
            ...it.deferred,
            status,
            toolUseId: it.deferred.toolUseId ?? e.tool_use_id,
            kind: it.deferred.kind ?? e.kind,
            name: it.deferred.name ?? e.name,
            summary: e.summary ?? it.deferred.summary,
            outputFile: e.output_file ?? it.deferred.outputFile,
            tokens: progressTokens(e.progress) ?? it.deferred.tokens,
            updatedAt: now,
          }
          const text = deferred.summary ?? ""
          return {
            ...it,
            deferred,
            parentToolId: it.parentToolId ?? deferred.toolUseId ?? undefined,
            activityAt: now,
            ...(terminal
              ? {
                  result: {
                    ok: status === "completed",
                    text,
                    lines: text ? text.split("\n").length : 0,
                  },
                }
              : {}),
          }
        }),
      }
    }
    // resultado resumido de uma tool: anexa à linha correspondente (pelo toolId).
    case "tool_result":
      return {
        items: c.items.map((it) => {
          if (it.kind !== "tool" || it.toolId !== e.id) return it
          if (!it.result) {
            return {
              ...it,
              result: { ok: e.ok, text: e.text, lines: e.lines },
              // evidência visual (B1): preserva os paths no item (persistem
              // no snapshot). Sem imagem → campo ausente, render idêntico.
              ...(e.images?.length ? { images: e.images } : {}),
              activityAt: now,
            }
          }
          // Resultado tardio só com imagens (o agy registra a imagem gerada
          // depois do passo, ADR-277): junta, sem tocar no resultado gravado.
          return e.images?.length && !it.images?.length ? { ...it, images: e.images, activityAt: now } : it
        }),
      }
    case "result": {
      // O CLI pode emitir results intermediários (fases, subagents), cada um com
      // o total até ali: o último é o total real. Colapsa consecutivos, senão o
      // custo da sessão soma parciais.
      const prev = c.items[c.items.length - 1]
      const base =
        prev && prev.kind === "result" ? c.items.slice(0, -1) : c.items
      return {
        items: [
          ...base,
          {
            kind: "result",
            id: uid(),
            ok: e.ok,
            text: e.text ?? undefined,
            costUsd: e.cost_usd ?? undefined,
            costSource: e.cost_source,
            model: c.model,
            usage: {
              input: e.input_tokens,
              output: e.output_tokens,
              cacheRead: e.cache_read,
              cacheCreation: e.cache_creation,
            },
            durationMs:
              c.startedAt != null
                ? Date.now() - c.startedAt
                : prev && prev.kind === "result"
                  ? prev.durationMs
                  : undefined,
            ts: now,
          },
        ],
        streamingTextId: null,
      }
    }
    // limite de uso/cota: cartão ACIONÁVEL no fio (o revezamento mora nele).
    case "limit_reached":
      return {
        items: [
          ...c.items,
          {
            kind: "limit",
            id: uid(),
            message: e.message,
            resetHint: e.reset_hint ?? undefined,
            ts: now,
          },
        ],
        streamingTextId: null,
      }
    // aviso não-fatal (anexo expirado/não-suportado), só adiciona a linha.
    case "notice":
      return {
        items: [
          ...c.items,
          { kind: "notice", id: uid(), message: e.message, ts: now },
        ],
      }
    case "error":
      return {
        items: [
          ...c.items,
          { kind: "error", id: uid(), message: e.message, ts: now },
        ],
        streamingTextId: null,
      }
    // Terminais do runner (corte e EOF): store/chat/terminalTools.ts.
    case "cancelled":
    case "done":
      return reduceTerminalEvent(c.items, e, now)
    default:
      return {}
  }
}
