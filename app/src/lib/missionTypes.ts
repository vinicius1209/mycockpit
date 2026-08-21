// CONTRATO do modo Mission (docs/mission-mode.md): time configurável
// papel→agent/modelo rodando como pipeline SEQUENCIAL dentro do Linear.
// Feature independente do SDD (decisão de produto 2026-07-12).
// Este arquivo é a fonte de verdade dos tipos — UI, store e settings
// importam daqui; NÃO importar componentes/stores aqui (sem ciclos).
// (só `import type` — apagados na compilação, sem ciclo em runtime.)

import type { CostSource } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import type { ChatItem } from "@/store/chat"
import { modeFromAutonomy, type PermissionVocab } from "@/lib/sessionMode"

export type MissionPersona = "planner" | "executor" | "reviewer"

/** Forma de autoria do plano. Ausente = "linear" para manter todos os
 *  presets persistidos antes do canvas executáveis sem migração. */
export type MissionPlanMode = "linear" | "graph"

/** O canvas persiste somente coordenadas e topologia. A configuração do agent
 *  continua em `MissionPhaseDef`, fonte única para lista, launcher e runtime. */
export interface MissionPlanNode {
  id: string
  phaseId: string
  position: { x: number; y: number }
}

/** Condições já fazem parte do contrato exportável. O executor v1 cria apenas
 *  arestas `success` numa linha única; failure/always e limites de travessia
 *  ficam reservados para ramificações e loops do motor de grafo. */
export type MissionPlanEdgeCondition = "success" | "failure" | "always"

export interface MissionPlanEdge {
  id: string
  source: string
  target: string
  condition: MissionPlanEdgeCondition
  label?: string
  /** Obrigatório no futuro quando uma aresta fechar um ciclo. */
  maxTraversals?: number
}

/** Schema canônico do canvas, independente do React Flow e dos CLIs. */
export interface MissionPlanGraph {
  version: 1
  entryNodeId: string | null
  nodes: MissionPlanNode[]
  edges: MissionPlanEdge[]
}

/** Definição de UMA fase do pipeline (parte do preset, editável). */
export interface MissionPhaseDef {
  /** Identificador estável dentro do preset (ex.: "plan", "ui", "review"). */
  id: string
  /** Rótulo humano exibido na timeline (ex.: "Planejar"). */
  label: string
  /** Persona → template de prompt (planner/executor/reviewer). */
  persona: MissionPersona
  /** Agent do registry (lib/agents.ts): "claude-code" | "codex" | "agy". */
  agent: string
  /** Modelo (value do registry) ou null = default do agent. */
  model: string | null
  /** Effort ou null = default. */
  effort: string | null
  /** Instrução específica da fase (opcional; soma ao template da persona). */
  instructions?: string
  /** Condições que o agent deve conferir antes de começar. No motor linear v1
   *  são guardrails semânticos injetados no prompt; não mudam a topologia. */
  entryCriteria?: string[]
  /** Checklist explícito que a fase precisa satisfazer antes do handoff. */
  exitCriteria?: string[]
  /** Tentativas máximas da fase (1 = sem retry). */
  maxRetries: number
  /** PROCEDÊNCIA: esta fase NÃO estava no plano que decolou — o motor a
   *  acrescentou durante o voo (rodada de correção do revisor, `round`, no
   *  instante `at`). Ausente = fase do plano lançado. Viaja no def → sobrevive
   *  ao run-state e à retomada sem migração (mesma regra do `autonomy`). */
  appendedInFlight?: { round: number; at: number }
  /** Autonomia DESTA fase (por membro do time). "auto" = roda sem pedir
   *  permissão, com o freio de segurança do CLI (claude classificador, codex
   *  sandbox+approval=never, agy --sandbox). Ausente/"inherit" = usa a permissão
   *  do PROJETO (comportamento atual). Viaja no def → sobrevive a resume e a
   *  presets salvos sem migração. */
  autonomy?: "auto" | "inherit"
}

/** Permissão EFETIVA de uma fase. A permissão do PROJETO é o TETO — "auto" é a
 *  versão SEM-PAUSA do Padrão, nunca uma escalada acima do que o projeto libera:
 *  - projeto Padrão + auto → "auto" (autônomo-com-freio; o caso que resolve o
 *    "me pede o tempo todo").
 *  - projeto Leitura + auto → "leitura" (auto NÃO concede escrita — leitura já
 *    não pausa porque não escreve; sem escalada de read-only pra workspace).
 *  - projeto Liberado + auto → "liberado" (não rebaixa o bypass que o usuário
 *    escolheu de propósito; auto seria MENOS privilegiado, com freio).
 *  Pura — testável e sem store. Usada no loop da missão por membro. */
export function phasePermission(
  projectPermission: string,
  phase: Pick<MissionPhaseDef, "autonomy">,
): string {
  // Tradução ÚNICA (M4): a régua mora em lib/sessionMode, junto das outras
  // três. Duas cópias divergiam em silêncio — e divergiram: a primeira versão
  // do `modeFromAutonomy` não clampava, e teria soltado escrita em projeto
  // read-only quando esta função passasse a delegar.
  // `""` (projeto sem modo gravado) é `padrao`, como o `Permission::parse`.
  const base = (projectPermission || "padrao") as PermissionVocab
  return modeFromAutonomy(phase.autonomy ?? "inherit", base)
}

/** Ids que o loop de correção gera (`fix-<n>-<missionId>`,
 *  `rereview-<n>-<missionId>`, ver missionEngine.afterPhaseDone). */
const APPENDED_PHASE_ID = /^(?:fix|rereview)-(\d+)-/

/** Procedência de UMA fase: null = veio no plano do lançamento; objeto = foi
 *  acrescentada em voo (rodada + instante, `at` null quando desconhecido).
 *
 *  O fallback pelo ID cobre missão em voo persistida ANTES do campo existir: a
 *  rodada já viajava no id da fase corretiva (é a mesma leitura que
 *  missionState.derivedReviewLoops faz pro clamp). Sem ele, uma missão retomada
 *  mostraria fase acrescentada no meio do voo como se sempre tivesse estado
 *  lá. */
export function phaseProvenance(
  def: Pick<MissionPhaseDef, "id" | "appendedInFlight">,
): { round: number; at: number | null } | null {
  if (def.appendedInFlight) {
    return { round: def.appendedInFlight.round, at: def.appendedInFlight.at }
  }
  const m = APPENDED_PHASE_ID.exec(def.id)
  return m ? { round: Number(m[1]), at: null } : null
}

/** Contagem HONESTA do plano: quantas fases ele tem agora, com quantas decolou
 *  e quantas entraram durante o voo. O denominador de "fase X de N" cresce
 *  sozinho quando o revisor reprova (o crescimento é correto), e quem mostra o
 *  N precisa poder dizer que ele mudou em vez de trocar calado. */
export function planCounts(
  phases: Pick<MissionPhaseDef, "id" | "appendedInFlight">[],
): { total: number; launched: number; appended: number } {
  const appended = phases.filter((p) => phaseProvenance(p) !== null).length
  return {
    total: phases.length,
    launched: phases.length - appended,
    appended,
  }
}

/** Declaração que acompanha o contador quando o plano cresceu depois da
 *  decolagem ("fase 3 de 6" + "lançou com 4 · 2 fases acrescentadas no voo").
 *  null = o plano é o mesmo que decolou, e não há nada a declarar. */
export function planGrowthNote(counts: {
  launched: number
  appended: number
}): string | null {
  if (counts.appended <= 0) return null
  const n = counts.appended
  return `lançou com ${counts.launched} · ${n} ${n === 1 ? "fase acrescentada" : "fases acrescentadas"} no voo`
}

/** Política de GATE humano do time (MH3.3):
 *  - "agente": comportamento clássico — pausa quando uma fase deixa
 *    open_questions no handoff E há próxima fase.
 *  - "sempre-apos-planejar": gate OBRIGATÓRIO após a fase 1, mesmo sem
 *    perguntas (pergunta padrão "Revise o plano antes de executar"); as demais
 *    fases seguem a regra do "agente".
 *  - "nunca": nunca pausa; perguntas em aberto entram como notice no fio
 *    (informação nunca some).
 *  Ausente = "agente" (fail-open pra presets salvos antes do campo existir). */
export type MissionGatePolicy = "agente" | "sempre-apos-planejar" | "nunca"

/** Um time salvo (global nas Settings; ad-hoc no launch). */
export interface MissionPreset {
  id: string
  name: string
  /** Descrição curta exibida na biblioteca e transportada no export. */
  description?: string
  /** Editor preferido deste template. Ausente = linear (retrocompatível). */
  mode?: MissionPlanMode
  /** Representação visual/versionada. `phases` segue sendo a projeção
   *  executável enquanto o motor aceita apenas uma rota linear. */
  graph?: MissionPlanGraph
  phases: MissionPhaseDef[]
  /** Teto de custo da missão em US$ (null = sem teto). RISCO Nº1 do design. */
  maxCostUsd: number | null
  /** Política de gate humano (MH3.3). Ausente = "agente" (comportamento
   *  clássico) — presets antigos seguem funcionando sem migração. */
  gatePolicy?: MissionGatePolicy
}

export type MissionPhaseStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "aborted"

/** Estado de execução de UMA fase (runtime, não persiste no preset). */
export interface MissionPhaseRun {
  def: MissionPhaseDef
  status: MissionPhaseStatus
  /** Tentativa corrente (1-based; > 1 = houve retry). */
  attempt: number
  costUsd: number
  /** PROCEDÊNCIA do custo desta fase (o `cost_source` do result, agent.ts):
   *  "reported" = dólar do motor · "estimated" = conta por tokens · "unknown"
   *  = veio número sem fonte. Ausente = a fase ainda não fechou NENHUM result.
   *  Sem isto, `costUsd: 0` de um motor que não mede é indistinguível de um
   *  turno que custou zero de verdade, e a tela pintava `US$ 0,000` (R3). */
  costSource?: CostSource
  startedAt: number | null
  /** Fim da fase (epoch ms), congelado no primeiro desfecho terminal
   *  (done/error/aborted). null/ausente = a fase não terminou, ou terminou
   *  antes deste campo existir — e aí a duração não é exibida em vez de ser
   *  inventada a partir do "agora". Fica no run-state (JSON tolerante), não no
   *  SQLite: nenhuma migração. */
  endedAt?: number | null
  /** Itens ao vivo da fase (stream reduzido pelo runPhase/onProgress) — a
   *  matéria-prima da atividade em tempo real e do resumo final. */
  items?: ChatItem[]
  /** ÚLTIMA VEZ que este motor disse alguma coisa (epoch ms), carimbada a cada
   *  evento do stream. É o "último byte" do R5: o que decide alarme é o tempo
   *  desde a última saída, não o tempo da fase — silêncio só assusta em relação
   *  à última vez que se ouviu algo. Não vem do `ts` dos itens de propósito: um
   *  bloco de texto que recebe deltas por 5 min mantém o `ts` do primeiro byte,
   *  e a conta acusaria silêncio com o motor falando.
   *  NÃO PERSISTE (não está no run-state): estado vivo restaurado seria um
   *  relógio de um processo que já morreu. */
  lastOutputAt?: number
  /** Mensagem de erro da última tentativa (se status error/aborted). */
  error?: string
}

export type MissionStatus = "running" | "done" | "error" | "aborted"

/** Gate humano: a fase `phase` terminou deixando perguntas em aberto — a
 *  missão PAUSA e só continua depois de answerGate() (as respostas são
 *  injetadas no prompt da próxima fase). */
export interface MissionGate {
  phase: number
  questions: string[]
}

/** Resposta RICA de UMA pergunta do gate: texto (em branco = o agente decide)
 *  + anexos opcionais (imagem/PDF). Os textos viram diretriz no prompt da fase
 *  seguinte; os anexos agregados vão pro runPhase dela (filtrados pelo caps do
 *  agent — anexo não suportado é descartado com notice, nunca erro).
 *  answerGate também aceita string[] legado (normalizado p/ cá). */
export interface GateAnswer {
  text: string
  attachments?: Attachment[]
}

/** Recuperação de missão: a fase `phase` falhou de forma RECUPERÁVEL (limite de
 *  uso / rate limit / crédito) — a missão PAUSA (espelha o gate) e só continua
 *  depois de resolveRecovery() (troca de agent/modelo/effort e re-roda a MESMA
 *  fase) ou abortRecovery() (desiste → a missão vai a error). */
export interface MissionRecovery {
  /** Índice da fase que falhou (a que será re-rodada com o novo agent). */
  phase: number
  /** Mensagem de erro crua da última tentativa (do PhaseResult.error). */
  error: string
  /** Mensagem humana pro card da UI (explica a pausa + o que fazer). */
  message: string
}

/** Escolha do usuário na recuperação: novo agent/modelo/effort p/ re-rodar a
 *  fase corrente. null (em resolveRecovery/abortRecovery) = desistir. */
export interface RecoveryChoice {
  agent: string
  model: string | null
  effort: string | null
}

/** MH1.1 — desfecho honesto: a missão terminou "done" mas o revisor NÃO
 *  aprovou (rodadas de correção esgotadas, ou nenhum executor pra corrigir).
 *  A entrega ACONTECEU (arquivos no worktree, delivery gravada); a ressalva
 *  registra que ela não passou no gate do revisor — nunca um "done" seco. */
export interface MissionReviewCaveat {
  /** Rodadas de correção executadas antes de esgotar (0 = nenhuma possível). */
  rounds: number
  /** Parecer final do revisor (feedback da última revisão reprovada). */
  feedback: string
}

/** Resumo estruturado da conclusão (do handoff da última fase que emitiu). */
export interface MissionDoneSummary {
  intent: string | null
  openQuestions: string[]
  filesTouched: string[]
}

/** Uma missão em execução/terminada numa conversa. */
export interface MissionRun {
  id: string
  convId: string
  presetName: string
  task: string
  /** Pasta RELATIVA (sob o cwd) desta missão: `.mycockpit/missions/<slug>`.
   *  Isola os handoffs/run-state/relatórios — sem colisão entre missões. */
  dir: string
  phases: MissionPhaseRun[]
  /** Índice da fase corrente (aponta além do fim quando done). */
  current: number
  costTotal: number
  maxCostUsd: number | null
  status: MissionStatus
  startedAt: number
  /** Gate pendente (precisa de você). null/undefined = nada pendente. */
  gate?: MissionGate | null
  /** R7 — a missão SEGURANDO: você pediu ("pedido", e a fase corrente ainda
   *  termina normal) ou interrompeu a fase ("interrompida", e ela ficou
   *  incompleta). Nos dois casos a PRÓXIMA não começa sem você. Não persiste no
   *  run-state: pausa é estado vivo (mesma régua do gate). */
  hold?: { phase: number; reason: "pedido" | "interrompida" } | null
  /** Recuperação pendente: uma fase falhou de forma recuperável e a missão
   *  aguarda a escolha de agent (resolveRecovery) ou a desistência
   *  (abortRecovery). null/undefined = nada pendente. */
  recovery?: MissionRecovery | null
  /** Resumo estruturado quando done/error (best-effort dos handoffs). */
  doneSummary?: MissionDoneSummary | null
  /** MH1.1 — done COM RESSALVA: o revisor não aprovou e as rodadas de correção
   *  esgotaram. null/undefined = sem ressalva (aprovado ou sem reviewer). */
  reviewCaveat?: MissionReviewCaveat | null
  /** MH3.3 — política de gate do preset EFETIVO do launch (viaja no run pra
   *  o run-state serializar e a retomada preservar). Ausente = "agente". */
  gatePolicy?: MissionGatePolicy
}

/** Presets de fábrica (espelham categorias do OMO, sem keyword-magic). */
export const DEFAULT_MISSION_PRESETS: MissionPreset[] = [
  {
    id: "feature",
    name: "Feature completa",
    maxCostUsd: 25,
    phases: [
      {
        id: "plan",
        label: "Planejar",
        persona: "planner",
        agent: "claude-code",
        model: "opus",
        effort: null,
        maxRetries: 1,
      },
      {
        id: "build",
        label: "Executar",
        persona: "executor",
        agent: "codex",
        model: null,
        effort: null,
        maxRetries: 2,
      },
      {
        id: "review",
        label: "Revisar",
        persona: "reviewer",
        agent: "claude-code",
        model: "opus",
        effort: null,
        maxRetries: 1,
      },
    ],
  },
  {
    id: "ui-first",
    name: "UI-first",
    maxCostUsd: 15,
    phases: [
      {
        id: "plan",
        label: "Planejar",
        persona: "planner",
        agent: "claude-code",
        model: "sonnet",
        effort: null,
        maxRetries: 1,
      },
      {
        id: "ui",
        label: "Executar UI",
        persona: "executor",
        agent: "agy",
        model: null,
        effort: null,
        maxRetries: 2,
      },
      {
        id: "review",
        label: "Revisar",
        persona: "reviewer",
        agent: "claude-code",
        model: "sonnet",
        effort: null,
        maxRetries: 1,
      },
    ],
  },
  {
    id: "barato",
    name: "Econômico",
    maxCostUsd: 5,
    phases: [
      {
        id: "plan",
        label: "Planejar",
        persona: "planner",
        agent: "claude-code",
        model: "sonnet",
        effort: null,
        maxRetries: 1,
      },
      {
        id: "build",
        label: "Executar",
        persona: "executor",
        agent: "codex",
        model: null,
        effort: null,
        maxRetries: 1,
      },
      {
        id: "review",
        label: "Revisar",
        persona: "reviewer",
        agent: "claude-code",
        model: "sonnet",
        effort: null,
        maxRetries: 1,
      },
    ],
  },
]
