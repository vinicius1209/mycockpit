// ADR-161 — automação de PLANO DE VOO: o disparo agendado de uma missão
// multi-fase (o "loop agêntico"), em vez de um prompt só.
//
// Por que ele mora AQUI e não dentro do store/mission: a régua de "tem alguém
// olhando?" é de QUEM DISPARA, nunca de quem recebe — a mesma decisão que o
// lib/unattendedRuns já documenta. A missão lançada pelo botão tem uma pessoa
// na frente e PODE pausar pedindo o que precisar; a mesma missão às 3h da
// manhã não pode. Então é o disparador que fecha as três portas de pausa antes
// de largar, e o store/mission segue igual para os dois.
//
// AS TRÊS PORTAS QUE PENDURARIAM A MISSÃO PARA SEMPRE
//
//  1. GATE humano — a fase deixa perguntas e a missão espera `answerGate`.
//     Fechada trocando a política do preset efetivo por "nunca": as perguntas
//     viram notice no fio (a informação não some), a missão segue.
//  2. RECUPERAÇÃO — uma falha recuperável abre o card "escolha outro motor" e
//     espera `resolveRecovery`. Fechada por um observador do store: recovery
//     aberto numa missão agendada é abortado fail-closed, e a missão termina
//     em erro com a causa real (melhor um desfecho honesto que uma missão
//     viva pra sempre em memória).
//  3. WORKTREE — se a criação falha, o `ensureMissionCwd` PERGUNTA se pode
//     rodar na pasta do projeto sem isolamento. Fechada respondendo NÃO por
//     construção: o cwd é resolvido aqui, antes do launch, com `ask` fixo em
//     false. Automação desassistida não escreve no repositório real por um
//     modal que ninguém viu.

import { ensureMissionCwd } from "@/lib/missionWorktree"
import type { MissionPreset } from "@/lib/missionTypes"
import type { ScheduleRecord } from "@/lib/db"
import type { Project } from "@/lib/types"
import { oneLine, type ScheduleOutcome } from "@/lib/scheduleOutcome"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useMission } from "@/store/mission"

/** O Plano de voo agendado, resolvido dos settings. null = o plano foi apagado
 *  depois do agendamento — e aí a automação FALHA com a causa escrita, nunca
 *  degrada pra "roda o prompt solto" (seria despachar um agent que ninguém
 *  configurou). */
export function findPlan(planId: string | null): MissionPreset | null {
  if (!planId) return null
  return (
    useApp.getState().settings.missionPresets.find((p) => p.id === planId) ??
    null
  )
}

/** O preset EFETIVO de um disparo agendado: o plano do usuário com a política
 *  de gate trocada por "nunca". Puro, pra o teste poder afirmar a troca sem
 *  subir missão nenhuma. */
export function unattendedPreset(plan: MissionPreset): MissionPreset {
  return { ...plan, gatePolicy: "nunca" }
}

/** Desfecho da missão lido do store DEPOIS do launch: `done` é o único ok.
 *  A causa do erro sai da fase que falhou (nunca inventada); sem ela, o texto
 *  diz só o que se sabe. */
export function missionOutcome(
  run:
    | {
        status: string
        costTotal: number
        phases: { status: string; error?: string; def: { label: string } }[]
      }
    | undefined,
  convId: string,
): ScheduleOutcome {
  if (!run) {
    return {
      status: "failed",
      cost: null,
      convId,
      error: "A missão não chegou a largar.",
    }
  }
  if (run.status === "done") {
    return { status: "ok", cost: run.costTotal, convId, error: null }
  }
  const falha = run.phases.find((p) => p.status === "error")
  const motivo = falha?.error
    ? `Fase “${falha.def.label}”: ${oneLine(falha.error)}`
    : run.status === "aborted"
      ? "Missão interrompida."
      : "A missão terminou em erro."
  return { status: "failed", cost: run.costTotal, convId, error: motivo }
}

/** Fecha a porta 2: enquanto a missão desta conversa estiver no ar, qualquer
 *  recuperação que abrir é desistida na hora. Devolve o cancelamento do
 *  observador (o caller chama no `finally` — assinatura viva depois do fim da
 *  missão abortaria a recuperação de uma missão MANUAL na mesma conversa). */
function autoAbortRecovery(convId: string): () => void {
  return useMission.subscribe((s) => {
    const run = s.byConv[convId]
    if (run?.recovery) useMission.getState().abortRecovery(convId)
  })
}

/** Dispara a missão agendada na conversa recém-criada e devolve o desfecho
 *  normalizado. Fail-soft: nada aqui pode derrubar o tick do motor. */
export async function dispatchMissionSchedule(
  s: ScheduleRecord,
  ctx: { convId: string; project: Project; permission: string },
): Promise<ScheduleOutcome> {
  const { convId, project, permission } = ctx
  const plan = findPlan(s.planId)
  if (!plan) {
    return {
      status: "failed",
      cost: null,
      convId,
      error:
        "O Plano de voo desta automação não existe mais. Edite a automação e escolha outro.",
    }
  }

  // Porta 3: resolve o cwd ANTES do launch, sem perguntar nada a ninguém.
  const ensured = await ensureMissionCwd(
    {
      convId,
      projectPath: project.path,
      worktreePath: useChat.getState().byId[convId]?.worktreePath ?? null,
      resume: false,
    },
    { ask: async () => false },
  )
  if (!ensured.ok) {
    return {
      status: "failed",
      cost: null,
      convId,
      error:
        "Não consegui criar o worktree da missão, e automação não roda na pasta do projeto sem isolamento.",
    }
  }
  if (ensured.created) {
    // liga o worktree na conversa: o launch encontra o cwd pronto e não tenta
    // criar de novo (nem cai no modal).
    useChat.getState().setWorktree(convId, ensured.cwd)
  }

  const unsubscribe = autoAbortRecovery(convId)
  try {
    await useMission
      .getState()
      .launch(
        convId,
        unattendedPreset(plan),
        s.prompt,
        project.id,
        project.path,
        permission,
      )
  } catch (e) {
    return {
      status: "failed",
      cost: useMission.getState().byConv[convId]?.costTotal ?? null,
      convId,
      error:
        (e instanceof Error ? oneLine(e.message) : "") ||
        "A missão falhou ao largar.",
    }
  } finally {
    unsubscribe()
  }
  return missionOutcome(useMission.getState().byConv[convId], convId)
}
