// F6 — MOTOR das automações agendadas (tick no FRONT, v1). O App.tsx roda
// tickSchedules() no boot (tick imediato = catch-up) e a cada 60s, só no
// Tauri. Limitação honesta e documentada: app fechado = não roda; o que
// venceu há >5min (CATCHUP_GRACE_MS) NÃO dispara sozinho — vira UMA
// notificação agrupada no sino e o next_run recalcula pro futuro.
//
// SEM retry automático na v1: uma execução que falha marca 'failed' + sino;
// re-rodar é decisão humana ("Rodar agora" na view Agendado). O que a falha
// PRECISA carregar é o MOTIVO (lib/scheduleOutcome) — sem ele o histórico só
// dizia "falhou" e a pessoa tinha que abrir a conversa pra descobrir o quê.
//
// O disparo usa o caminho NORMAL de envio: conversa nova no projeto (via
// registerConversation — sem roubar a seleção), start/handleEvent/finish/
// persist do useChat e runAgent — aparece no sidebar como run vivo, custo
// contabilizado nos items. Automação de PLANO DE VOO (kind "mission") sai por
// lib/scheduleMission, que roda a missão multi-fase na mesma conversa nova.
// Permissão da automação: 'leitura' (default), 'padrao' ou 'auto'; 'liberado'
// é clampado fora pelo normalizeSchedulePermission, além do tipo.

import { runAgent } from "@/lib/agent"
import { buildDoctrineBlock, readDoctrine } from "@/lib/doctrine"
import { dispatchBlockReason, normalizeModelValue } from "@/lib/agents"
import {
  listSchedules,
  markScheduleCompleted,
  setScheduleEnabled,
  setScheduleNextRun,
  type ScheduleRecord,
} from "@/lib/db"
import {
  computeNextRun,
  parseRecurrence,
  splitDueAndMissed,
} from "@/lib/schedules"
import { dispatchMissionSchedule } from "@/lib/scheduleMission"
import {
  failureNotice,
  recordScheduleOutcome,
  turnOutcome,
  type ScheduleOutcome,
} from "@/lib/scheduleOutcome"
import { normalizeSchedulePermission } from "@/lib/sessionMode"
import { clearUnattendedRun, markUnattendedRun } from "@/lib/unattendedRuns"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useNotifs } from "@/store/notifications"

export { turnOutcome }

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
      const motivo =
        "O tipo “Proposta do lead” foi removido: ele dependia do board, que não existe mais. Esta automação foi desligada e não vai rodar."
      await recordScheduleOutcome(s, Date.now(), {
        status: "failed",
        cost: null,
        convId: null,
        error: motivo,
      })
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
      await finishWith(s, startedAt, {
        status: "failed",
        cost: null,
        convId: null,
        error: "Projeto não encontrado (arquivado?).",
      })
      return
    }

    // F-A (D2 do review) — preflight de availability ANTES do spawn: CLI
    // ausente/deslogada às 3h não ganha conversa nem run gasto; a falha entra
    // no histórico com o MOTIVO real. O next_run já avançou lá em cima, então
    // não retenta em loop — re-rodar segue decisão humana ("Rodar agora").
    // No Plano de voo o agent do registro não manda: quem roda são as fases.
    const dispatchBlock =
      s.kind === "mission"
        ? null
        : dispatchBlockReason(
            s.agent,
            useApp.getState().settings.detected ?? {},
          )
    if (dispatchBlock) {
      await finishWith(s, startedAt, {
        status: "failed",
        cost: null,
        convId: null,
        error: dispatchBlock,
      })
      return
    }

    // Regra dura do F6: automação NUNCA roda 'liberado'. Clamp ÚNICO
    // (lib/sessionMode), o mesmo da escrita e da leitura no banco — foi ter
    // TRÊS cópias desta linha que fez o "Auto" da tela virar 'leitura' no
    // processo (ADR-158). "auto" passa: roda sem pedir, mas com o freio de
    // cada CLI (claude classificador, codex sandbox de SO, agy --sandbox).
    const permission = normalizeSchedulePermission(s.permission)

    // conversa NOVA no projeto, em background (não rouba a seleção).
    const convId = crypto.randomUUID()
    const title = `⏰ ${s.name} — ${shortDate(new Date(startedAt))}`
    await useChat.getState().registerConversation(s.projectId, convId, title)

    // ── PLANO DE VOO: o loop agêntico multi-fase (lib/scheduleMission) ──
    if (s.kind === "mission") {
      const outcome = await dispatchMissionSchedule(s, {
        convId,
        project,
        permission,
      })
      await finishWith(s, startedAt, outcome)
      return
    }

    const runId = crypto.randomUUID()
    // normaliza id persistido: modelo que SAIU do CLI (ex. gpt-5.3-codex) não
    // pode condenar a automação a falhar em todo disparo até alguém editar.
    const model = normalizeModelValue(
      s.agent,
      s.model && s.model !== "default" ? s.model : null,
    )
    // effort: "default" e vazio são a MESMA coisa (nenhuma flag no spawn).
    const effort = s.effort && s.effort !== "default" ? s.effort : null

    // Run DESASSISTIDO: ninguém está na frente da tela pra aprovar nada (nem no
    // "Rodar agora" — a conversa nasce em background, sem roubar a seleção).
    // Sem esta marca, um pedido de permissão ('padrao') ou uma pergunta
    // (`ask_user`, que sobe até em 'leitura') PENDURA o turno pra sempre: o
    // backend bloqueia esperando resposta sem timeout (src-tauri/approval.rs).
    // Marcado, o vigia (lib/watchdog) responde fail-closed passado o limiar. O
    // clear no `finally` é o cancelamento: run que termina antes do prazo não
    // deixa nada pendurado.
    markUnattendedRun(runId, convId)
    // DOUTRINA do projeto: cada execução é uma sessão FRESCA, e aqui não há
    // ninguém na frente pra corrigir o rumo — as regras do projeto importam
    // mais numa automação das 18:30, não menos. O fio guarda `s.prompt` (o que
    // você escreveu); o bloco vai só pro prompt do CLI.
    const doctrine = buildDoctrineBlock(
      (await readDoctrine(project.path)).content,
    )
    let invokeFailed: string | null = null
    let accepted = false
    let preflightBlocked = false
    try {
      await runAgent(
        runId,
        convId,
        s.agent,
        model,
        effort,
        doctrine ? `${doctrine}\n\n${s.prompt}` : s.prompt,
        project.path,
        null, // sessão fresca — cada execução é um turno independente
        permission,
        [],
        (e) => {
          if (e.type === "preflight_blocked") {
            preflightBlocked = true
            return
          }
          if (e.type === "run_manifest" && !accepted) {
            accepted = true
            useChat
              .getState()
              .start(convId, s.prompt, runId, s.agent, model, effort, [])
          }
          if (accepted) useChat.getState().handleEvent(convId, e)
        },
      )
    } catch (e) {
      // o spawn nem chegou a produzir stream: a mensagem do invoke é a ÚNICA
      // pista que existe. Engoli-la deixava o histórico com "falhou" e nada.
      invokeFailed =
        (e instanceof Error ? e.message : typeof e === "string" ? e : "") ||
        "Falha ao iniciar o agent."
    } finally {
      // antes do finish/persist: o turno acabou, nada mais pode expirar por
      // este run (e o notice que o vigia tenha injetado entra no persist final).
      clearUnattendedRun(runId)
      if (accepted) {
        useChat.getState().finish(convId)
        void useChat.getState().persist(convId)
      }
    }

    const items = useChat.getState().byId[convId]?.items ?? []
    const turn = turnOutcome(items)
    const ok = invokeFailed == null && turn.ok
    await finishWith(s, startedAt, {
      status: preflightBlocked ? "blocked" : ok ? "ok" : "failed",
      cost: turn.cost,
      convId,
      error: preflightBlocked
        ? "Uma capacidade exigida não está disponível. Revise os MCPs do projeto."
        : ok
          ? null
          : (invokeFailed ?? turn.error),
    })
  } catch {
    // fail-soft: uma automação quebrada não derruba o motor nem as próximas.
  } finally {
    inFlight.delete(s.id)
  }
}

/** Persiste o desfecho (schedule_runs + last_run) e avisa quando não deu certo.
 *  Um ponto só: antes cada braço de falha repetia insert+mark+push e o motivo
 *  real ficava em três textos diferentes (ou em nenhum). */
async function finishWith(
  s: ScheduleRecord,
  startedAt: number,
  outcome: ScheduleOutcome,
): Promise<void> {
  await recordScheduleOutcome(s, startedAt, outcome)
  const notice = failureNotice(s, outcome)
  if (notice) useNotifs.getState().push(notice)
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
