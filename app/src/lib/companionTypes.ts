// O CONTRATO do Companion: a forma exata do que o celular recebe.
//
// Só tipos e a constante vazia — zero comportamento, zero import de store. Saiu
// de lib/companion.ts pela catraca, e o corte é o mais barato que existe: tipo
// não tem efeito colateral, então ninguém precisa se perguntar em que ordem
// este módulo carrega.
//
// Vale como fronteira além do tamanho: este arquivo é o que o cliente do
// aparelho (`src-tauri/companion/index.html`, HTML estático sem bundler)
// PRECISA respeitar sem conseguir importar. Tendo o contrato num arquivo só,
// "o que o telefone recebe" tem uma resposta que se lê de uma sentada, em vez
// de estar espalhada no meio de quem monta.

import type { MissionPhaseStatus, MissionStatus } from "@/lib/missionTypes"
import type { LedgerEntry, RecentDelivery } from "@/lib/db"
import type { UnpricedSpend } from "@/lib/panel"

// Nunca inclui paths absolutos do disco (worktree/projectPath ficam fora).

/** Item que PRECISA de você: gate de missão, aprovação de comando, pergunta
 *  estruturada do agente ou turno MUDO (watchdog P2). `agent` é o ID do
 *  registry (a página rotula). */
export interface CompanionAttention {
  /** gate → "gate:<convId>"; approval/question → id do request (responder usa);
   *  stalled → "stalled:<convId>" (parar usa stop_turn com o convId). */
  id: string
  kind: "gate" | "approval" | "question" | "stalled"
  /** null = dono irresolvível (pedido sem run_id, ou run já morto). Vale para os
   *  dois kinds: pergunta TAMBÉM carrega run_id (o backend anexa em toda
   *  emissão), então ela chega com conversa e projeto como a aprovação. */
  convId: string | null
  projectId: string | null
  projectName: string | null
  /** ID do agent dono (fase da missão ou conversa); "" se desconhecido. */
  agent: string
  /** Índice da fase (missão); null fora de missão. */
  phase: number | null
  phaseLabel: string | null
  /** gate: perguntas abertas · question: enunciados das perguntas. */
  questions?: string[]
  /** question COM opções estruturadas (C2): a página renderiza a ESCOLHA de
   *  verdade (radio/checkbox + texto livre), não só textarea. Omitido quando
   *  nenhuma pergunta tem opções (o fluxo de texto livre segue). */
  choices?: CompanionQuestion[]
  /** approval: comando extraído (Bash) e a tool pedida. */
  command?: string
  toolName?: string
  /** stalled: minutos de silêncio ("mudo há X min"). */
  minutes?: number
}

/** Pergunta estruturada com opções (espelho compacto do Question do
 *  lib/interaction — o snapshot nunca carrega o input cru do agente). */
export interface CompanionQuestion {
  header: string
  question: string
  multiSelect: boolean
  options: { label: string; description: string }[]
}

/** Atividade em execução agora (turno linear OU missão). */
export interface CompanionRunning {
  convId: string
  projectId: string | null
  projectName: string | null
  kind: "turno" | "missão"
  /** ID do agent (turno: o da conversa; missão: o da fase corrente). */
  agent: string
  /** Título da conversa (turno) ou task (missão). */
  label: string
  /** Etapa humana ("Executando comando…", "Planejar…"). */
  detail: string
  startedAt: number | null
  /** Só p/ kind "missão": resumo compacto das fases. */
  missionPhases?: { label: string; status: MissionPhaseStatus }[]
  /** C2 — turno FINALIZANDO (o CLI está fechando; runId já foi embora): a
   *  página mostra o estado honesto e o Parar não finge que interrompe. */
  finalizing?: boolean
}

export interface CompanionMissionPhase {
  label: string
  agent: string
  status: MissionPhaseStatus
  costUsd: number
}

export interface CompanionMission {
  convId: string
  projectId: string | null
  projectName: string | null
  task: string
  status: MissionStatus
  phases: CompanionMissionPhase[]
  /** Índice da fase corrente (além do fim quando done). */
  current: number
  costTotal: number
  maxCostUsd: number | null
  /** Gate pendente (responder via ação answer_gate). null = nada pendente. */
  gate: { phase: number; questions: string[] } | null
}

export interface CompanionDelivery {
  projectId: string
  projectName: string | null
  task: string
  agent: string
  costUsd: number | null
  createdAt: number
}

export interface CompanionCosts {
  /** US$ de HOJE (ledger + missões vivas) — SÓ o que tem preço (ADR-047). */
  totalUsd: number
  byProject: Record<string, number>
  /** O que ficou de fora de `totalUsd` por falta de preço. O cliente decide
   *  como avisar; o app não some com o consumo. */
  unpriced: UnpricedSpend
}

/** Agent utilizável num projeto + a conversa de MESA dele (quando já existe).
 *  `deskConvId` é o que devolve o histórico ao celular: sem ele a página só
 *  reencontrava a conversa enquanto o turno estava em running[] — sair e
 *  voltar depois do turno perdia o histórico (gap G2 do Companion). */
export interface CompanionProjectAgent {
  agent: string
  /** Conversa "Mesa · {agent}" mais recente do projeto (histórico via
   *  GET /api/conv). Ausente = a mesa nunca conversou neste projeto. */
  deskConvId?: string
  deskTitle?: string
}

/** R3 — conversa recente de um projeto, para o celular abrir pelo chat. */
export interface CompanionConversa {
  convId: string
  title: string
  /** Motor persistido da conversa; null = nunca rodou. */
  agent: string | null
  updatedAt: number
  running: boolean
  /** Há algo em `attention` para esta conversa: aprovação, pergunta, gate ou
   *  turno parado sem notícia. */
  pedeVoce: boolean
  /** Prévia da linha no celular: a frase PRONTA do último turno encerrado
   *  (mesma regra de `CompanionTurn.frase`). Ausente quando o feed do sino não
   *  guarda turno desta conversa; a página não inventa texto no lugar. */
  frase?: string
}

export interface CompanionProject {
  id: string
  name: string
  /** Agents utilizáveis nesta máquina (ready/instalado) + conversa da mesa. */
  agents: CompanionProjectAgent[]
  /** R3 — conversas mais recentes (teto por projeto; quem roda ou pede você
   *  entra sempre). Ordem: mais recente primeiro. */
  recent: CompanionConversa[]
}

/** Especialista GLOBAL utilizável em qualquer projeto (C2 · lançar tarefa).
 *  Só os globais viajam: um preset de escopo-projeto só existe no projeto do
 *  desktop carregado e confundiria o celular ("por que sumiu?"). */
export interface CompanionSpecialist {
  id: string
  name: string
  /** Agent (CLI) que encarna a persona — a página mostra e o executor valida. */
  backend: string
  category: string
}

/**
 * Turno que ACABOU (R2 do recibo-nos-canais). Irmão de `CompanionDelivery`, não
 * substituto: entrega é o momento que o AGENTE marcou como entrega; turno é
 * todo turno que terminou, com o recibo quando existe. No celular as duas
 * perguntas são diferentes — "o que ele considerou pronto" e "o que aconteceu
 * enquanto eu não estava".
 */
export interface CompanionTurn {
  convId: string
  projectId: string
  projectName: string | null
  title: string
  /** `null` quando não houve recibo (turno de primeiro plano, helper
   *  desligado, prazo estourado — ADR-055). O cliente cai no desfecho. */
  receipt: string | null
  ok: boolean
  /** A frase JÁ PRONTA (recibo, ou o desfecho como fallback). Vai montada
   *  daqui porque o cliente do celular é HTML estático servido pelo Rust —
   *  sem bundler, ele não importa `lib/`, e reimplementar a regra lá foi
   *  exatamente a duplicação que o R3 veio desfazer. `receipt` e `ok` seguem
   *  no payload: quem quiser tratar erro diferente ainda consegue. */
  frase: string
  at: number
}

export interface CompanionSnapshot {
  attention: CompanionAttention[]
  running: CompanionRunning[]
  missions: CompanionMission[]
  /** Os últimos turnos encerrados. Vem do FEED do sino, que já guarda o
   *  recibo — sem evento novo nem tabela. */
  lastTurns: CompanionTurn[]
  deliveries: CompanionDelivery[]
  costs: CompanionCosts
  projects: CompanionProject[]
  /** Especialistas globais (C2): opcional no shape, o builder sempre emite. */
  specialists?: CompanionSpecialist[]
}

/** Dados assíncronos (DB) que temperam o snapshot; cacheados pelo bridge. */
export interface CompanionExtras {
  ledger: LedgerEntry[]
  deliveries: RecentDelivery[]
}

export const EMPTY_EXTRAS: CompanionExtras = { ledger: [], deliveries: [] }
