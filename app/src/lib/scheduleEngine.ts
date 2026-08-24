// F6 — MOTOR das automações agendadas (tick no FRONT, v1). O App.tsx roda
// tickSchedules() no boot (tick imediato = catch-up) e a cada 60s, só no
// Tauri. Limitação honesta e documentada: app fechado = não roda; o que
// venceu há >5min (CATCHUP_GRACE_MS) NÃO dispara sozinho — vira UMA
// notificação agrupada no sino e o next_run recalcula pro futuro.
//
// SEM retry automático na v1: uma execução que falha marca 'failed' + sino;
// re-rodar é decisão humana ("Rodar agora" na view Agendado).
//
// O disparo usa o caminho NORMAL de envio: conversa nova no projeto (via
// registerConversation — sem roubar a seleção), start/handleEvent/finish/
// persist do useChat e runAgent — aparece no sidebar como run vivo, custo
// contabilizado nos items. Permissão da automação: 'leitura' (default) ou
// 'padrao'; 'liberado' é clampado fora AQUI além do tipo.

import { runAgent } from "@/lib/agent"
import { buildDoctrineBlock, readDoctrine } from "@/lib/doctrine"
import { dispatchBlockReason, normalizeModelValue } from "@/lib/agents"
import {
  insertScheduleRun,
  listSchedules,
  markScheduleCompleted,
  markScheduleRun,
  setScheduleEnabled,
  setScheduleNextRun,
  type ScheduleRecord,
} from "@/lib/db"
import {
  computeNextRun,
  parseRecurrence,
  splitDueAndMissed,
} from "@/lib/schedules"
import { clearUnattendedRun, markUnattendedRun } from "@/lib/unattendedRuns"
import { useApp } from "@/store/app"
import { useChat, type ChatItem } from "@/store/chat"
import { useNotifs } from "@/store/notifications"

/** Guarda in-memory anti-duplo-disparo (tick de 60s × run longo × "Rodar
 *  agora"). O next_run já avança no disparo, isto cobre a janela async. */
const inFlight = new Set<string>()

export function isScheduleRunning(id: string): boolean {
  return inFlight.has(id)
}

/** "14/07 08:00" — o sufixo do título da conversa da automação. */
function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d)
}

/** Desfecho do turno lido dos items reduzidos pelo caminho normal do chat:
 *  ok = o último item "terminal" é um result com ok=true; o custo vem do
 *  último result (que carrega o total do turno — results consecutivos já
 *  foram colapsados pelo reduceItems). */
export function turnOutcome(items: ChatItem[]): {
  ok: boolean
  cost: number | null
} {
  let cost: number | null = null
  let ok = false
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === "result") {
      cost = it.costUsd ?? null
      ok = it.ok
      break
    }
    if (it.kind === "error" || it.kind === "cancelled" || it.kind === "limit") {
      ok = false
      // segue procurando um result anterior só pra recuperar o custo gasto.
      for (let j = i - 1; j >= 0; j--) {
        const prev = items[j]
        if (prev.kind === "result") {
          cost = prev.costUsd ?? null
          break
        }
      }
      break
    }
  }
  return { ok, cost }
}

/** Dispara UMA automação agora. `manual=true` ("Rodar agora") não mexe no
 *  next_run — o calendário regular segue intacto. Fail-soft de ponta a ponta:
 *  nada aqui pode derrubar o tick. */
export async function dispatchSchedule(
  s: ScheduleRecord,
  opts: { manual?: boolean } = {},
): Promise<void> {
  if (inFlight.has(s.id)) return
  inFlight.add(s.id)
  try {
    // Avança o next_run JÁ no disparo agendado: um run longo não re-dispara no
    // próximo tick, e o horário seguinte fica correto mesmo se o app fechar
    // no meio da execução.
    const rec = parseRecurrence(s.recurrence)
    if (rec?.kind === "once") {
      // "Uma vez" ENCERRA aqui, antes do run — inclusive no "Rodar agora": o
      // botão normalmente não mexe no calendário, mas um disparo de uma vez que
      // sobrevivesse ao clique rodaria DE NOVO no horário (o merge da release
      // sairia duas vezes). Ela some do calendário, não da lista: fica
      // desabilitada, marcada como concluída e com "Reagendar".
      await markScheduleCompleted(s.id, Date.now())
    } else if (!opts.manual) {
      const next = rec ? computeNextRun(rec, new Date()) : null
      await setScheduleNextRun(s.id, next)
    }

    // ── Automação LEGADA do tipo "lead" ──────────────────────────────
    // O tipo saiu (ADR-078): ele lia os cards abertos de um board que não tem
    // mais como criar card, então rodava, não produzia nada e reportava OK —
    // um no-op vestido de sucesso, pior que um erro.
    //
    // A linha salva no banco NÃO é convertida em automação de agent. Converter
    // seria o pior desfecho possível: uma automação que não fazia nada passaria
    // a DESPACHAR um agent de código, com prompt vazio, sem você ter pedido.
    // Ela é desligada uma vez, com a causa escrita, e fica na lista até você
    // excluir — some da vista só por gesto seu.
    if (s.kind === "lead") {
      const startedAt = Date.now()
      const motivo =
        "O tipo \u201cProposta do lead\u201d foi removido: ele dependia do board, que não existe mais. Esta automação foi desligada e não vai rodar."
      await insertScheduleRun({
        id: crypto.randomUUID(),
        scheduleId: s.id,
        startedAt,
        status: "failed",
        cost: null,
        convId: null,
      })
      await markScheduleRun(s.id, startedAt, "failed")
      // next_run null junto: desligar sem limpar o calendário deixaria a
      // automação com um horário futuro que nunca chega.
      await setScheduleEnabled(s.id, false, null)
      useNotifs.getState().push({
        kind: "run_error",
        title: `Automação desligada: ${s.name}`,
        subtitle: motivo,
        projectId: s.projectId,
      })
      return
    }

    const startedAt = Date.now()
    const project = useApp
      .getState()
      .projects.find((p) => p.id === s.projectId)
    if (!project) {
      await insertScheduleRun({
        id: crypto.randomUUID(),
        scheduleId: s.id,
        startedAt,
        status: "failed",
        cost: null,
        convId: null,
      })
      await markScheduleRun(s.id, startedAt, "failed")
      useNotifs.getState().push({
        kind: "run_error",
        title: `Automação falhou: ${s.name}`,
        subtitle: "Projeto não encontrado (arquivado?).",
        projectId: s.projectId,
      })
      return
    }

    // F-A (D2 do review) — preflight de availability ANTES do spawn: CLI
    // ausente/deslogada às 3h não ganha conversa nem run gasto; a falha entra
    // no histórico com o MOTIVO real. O next_run já avançou lá em cima, então
    // não retenta em loop — re-rodar segue decisão humana ("Rodar agora").
    const dispatchBlock = dispatchBlockReason(
      s.agent,
      useApp.getState().settings.detected ?? {},
    )
    if (dispatchBlock) {
      await insertScheduleRun({
        id: crypto.randomUUID(),
        scheduleId: s.id,
        startedAt,
        status: "failed",
        cost: null,
        convId: null,
      })
      await markScheduleRun(s.id, startedAt, "failed")
      useNotifs.getState().push({
        kind: "run_error",
        title: `Automação falhou: ${s.name}`,
        subtitle: dispatchBlock,
        projectId: s.projectId,
      })
      return
    }

    // conversa NOVA no projeto, em background (não rouba a seleção).
    const convId = crypto.randomUUID()
    const title = `⏰ ${s.name} — ${shortDate(new Date(startedAt))}`
    await useChat.getState().registerConversation(s.projectId, convId, title)

    const runId = crypto.randomUUID()
    // normaliza id persistido: modelo que SAIU do CLI (ex. gpt-5.3-codex) não
    // pode condenar a automação a falhar em todo disparo até alguém editar.
    const model = normalizeModelValue(
      s.agent,
      s.model && s.model !== "default" ? s.model : null,
    )
    // Regra dura do F6: automação NUNCA roda 'liberado'. Clamp além do tipo.
    // Clamp explícito: "liberado" NUNCA passa (bypass sem humano na frente não
    // tem quem segure um erro). "auto" passa — roda sem pedir, mas com o freio
    // de cada CLI: claude classificador, codex sandbox de SO, agy --sandbox.
    // Valor desconhecido cai em "leitura", o mais restrito (fail-closed).
    const permission =
      s.permission === "padrao"
        ? "padrao"
        : s.permission === "auto"
          ? "auto"
          : "leitura"

    // Run DESASSISTIDO: ninguém está na frente da tela pra aprovar nada (nem no
    // "Rodar agora" — a conversa nasce em background, sem roubar a seleção).
    // Sem esta marca, um pedido de permissão ('padrao') ou uma pergunta
    // (`ask_user`, que sobe até em 'leitura') PENDURA o turno pra sempre: o
    // backend bloqueia esperando resposta sem timeout (src-tauri/approval.rs).
    // Marcado, o vigia (lib/watchdog) responde fail-closed passado o limiar. O
    // clear no `finally` é o cancelamento: run que termina antes do prazo não
    // deixa nada pendurado.
    markUnattendedRun(runId, convId)
    useChat.getState().start(convId, s.prompt, runId, s.agent, model, null, [])
    // DOUTRINA do projeto: cada execução é uma sessão FRESCA, e aqui não há
    // ninguém na frente pra corrigir o rumo — as regras do projeto importam
    // mais numa automação das 18:30, não menos. O fio guarda `s.prompt` (o que
    // você escreveu); o bloco vai só pro prompt do CLI.
    const doctrine = buildDoctrineBlock(
      (await readDoctrine(project.path)).content,
    )
    let invokeFailed = false
    try {
      await runAgent(
        runId,
        convId,
        s.agent,
        model,
        null,
        doctrine ? `${doctrine}\n\n${s.prompt}` : s.prompt,
        project.path,
        null, // sessão fresca — cada execução é um turno independente
        permission,
        [],
        (e) => useChat.getState().handleEvent(convId, e),
      )
    } catch {
      invokeFailed = true
    } finally {
      // antes do finish/persist: o turno acabou, nada mais pode expirar por
      // este run (e o notice que o vigia tenha injetado entra no persist final).
      clearUnattendedRun(runId)
      useChat.getState().finish(convId)
      void useChat.getState().persist(convId)
    }

    const items = useChat.getState().byId[convId]?.items ?? []
    const outcome = turnOutcome(items)
    const ok = !invokeFailed && outcome.ok
    await insertScheduleRun({
      id: crypto.randomUUID(),
      scheduleId: s.id,
      startedAt,
      status: ok ? "ok" : "failed",
      cost: outcome.cost,
      convId,
    })
    await markScheduleRun(s.id, startedAt, ok ? "ok" : "failed")
    if (!ok) {
      useNotifs.getState().push({
        kind: "run_error",
        title: `Automação falhou: ${s.name}`,
        subtitle: 'Sem retry automático na v1; use "Rodar agora" em Agendado.',
        projectId: s.projectId,
        convId,
      })
    }
  } catch {
    // fail-soft: uma automação quebrada não derruba o motor nem as próximas.
  } finally {
    inFlight.delete(s.id)
  }
}

/** Um tick do motor (boot imediato + a cada 60s no App.tsx):
 *  - vencidos há ≤5min → disparam agora (entre ticks nunca passa de 60s;
 *    a graça absorve o jitter e a volta de um sleep curto);
 *  - vencidos há >5min (app fechado / máquina dormindo) → catch-up explícito:
 *    NÃO rodam sozinhos, viram UMA notificação agrupada e o next_run avança. */
export async function tickSchedules(): Promise<void> {
  const all = await listSchedules()
  if (!all || all.length === 0) return
  const now = Date.now()
  const { due, missed } = splitDueAndMissed(all, now)

  for (const s of missed) {
    const rec = parseRecurrence(s.recurrence)
    const next = rec ? computeNextRun(rec, new Date(now)) : null
    await setScheduleNextRun(s.id, next)
  }
  if (missed.length > 0) {
    useNotifs.getState().push({
      kind: "run_done",
      title:
        missed.length === 1
          ? "1 execução perdida enquanto o app estava fechado"
          : `${missed.length} execuções perdidas enquanto o app estava fechado`,
      subtitle: "Abra Agendado para rodar manualmente.",
      projectId: missed[0].projectId,
    })
  }

  // roda os vencidos em paralelo; o tick só resolve quando todos terminam
  // (o caller recarrega o store de schedules ao final).
  await Promise.all(due.map((s) => dispatchSchedule(s)))
}
