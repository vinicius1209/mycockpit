import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

/** Padrão unificado de "interação pendente": o agente pede input no meio do turno
 *  (aprovar comando, responder pergunta estruturada, aprovar plano — futuro). Uma
 *  abstração, N `kind`s. O turno FICA PAUSADO até `answerInteraction`. Espelha o
 *  §Contrato de docs/interactive-input.md. */
export type InteractionKind = "approval" | "question" | "plan"

/** Pedido normalizado emitido pelo backend no evento `interaction://request`.
 *  `data` varia por `kind` (ver ApprovalData / QuestionData). */
export interface InteractionRequest {
  /** id do pedido (correlaciona com a resposta). */
  id: string
  /** Run que está pausado esperando a decisão — IRMÃO de `data`, é assim que o
   *  backend serializa (approval.rs, struct InteractionRequest). É o que amarra
   *  o pedido à conversa dona (store/interactions: ownerByRunId); sem ele o
   *  pedido cai no host global e não acende nada na sidebar. Vem em TODO kind
   *  (o campo é `String` no Rust, preenchido pelo handle_conn tanto p/ approval
   *  quanto p/ question); opcional aqui só porque o canal de compat legado
   *  (`approval://request`) o traz dentro de `data`. */
  run_id?: string
  /** tipo da interação → escolhe o card na UI. */
  kind: InteractionKind
  /** payload específico do kind (ApprovalData | QuestionData). */
  data: unknown
}

/**
 * `data` de um gate de plano (kind="plan") — o "aprovar plano" que este arquivo
 * já previa como futuro.
 *
 * DIFERENTE dos outros dois em uma coisa que muda o código: ele é LOCAL. Não há
 * run pausado do outro lado esperando — em headless (`-p`) o turno de plano
 * termina antes de existir alguém pra perguntar, e o `ExitPlanMode` interativo
 * do Claude não existe nesse modo (ver o comentário no adapters.rs). Então
 * quem pergunta e quem responde são o app; nada é enviado ao backend.
 *
 * Por que mesmo assim entra NA FILA: é aqui que mora tudo que faz uma decisão
 * pendente ser vista — ponto na sidebar, sino, tray, nativa, Companion,
 * fail-closed. O gate de plano ficou fora disso desde sempre, e por isso podia
 * te esperar em silêncio. O Paseo chegou na mesma conclusão: lá o plano é um
 * `AgentPermissionRequestKind`, irmão de `tool` e `question`.
 */
export interface PlanData {
  /** Conversa dona — o `run_id` não serve aqui: o run já terminou. */
  convId: string
  /** Item `planGate` do fio que este pedido representa (o registro histórico). */
  gateId: string
  /** O plano proposto, pra quem mostra o pedido fora da conversa (sino,
   *  Companion) poder dizer do que se trata. */
  text: string
}

/** Resposta a um gate de plano. `keepPlanning` = recusa que CONTINUA o
 *  planejamento (opção 3 do Claude Code), com o motivo indo pro agente. */
export interface PlanAnswer {
  decision: "approved" | "keepPlanning"
  /** Motivo da recusa, mandado ao agente. Vazio = recusa sem explicação. */
  reason?: string
}

/** `data` de um pedido de aprovação granular (kind="approval"). Mantém o shape que
 *  já vinha em `approval://request` (movido de lib/agent.ts). */
export interface ApprovalData {
  /** LEGADO: o run vinha aqui no canal `approval://request`. O backend atual
   *  manda no TOPO do request (InteractionRequest.run_id) e NÃO repete aqui —
   *  quem precisa do run lê `req.run_id ?? data.run_id`, nunca só este. */
  run_id?: string
  /** tool que o Claude quer usar (ex. "Bash", "Write"). */
  tool_name: string
  /** comando extraído do input p/ Bash (vazio p/ outras tools). */
  command: string
  /** input cru da tool (a UI mostra o detalhe). */
  input: unknown
  /** Origem de HOOK (H2 do hooks-plan): pedido de permissão de uma sessão
   *  EXTERNA (terminal), não de um run do app — sem run_id/conversa dona.
   *  O card, o sino e o Companion usam isto pra dizer DE ONDE veio. */
  hook?: {
    /** id do agent no registry ("claude-code" | "codex" | "agy"). */
    engine: string
    sessionId: string
    cwd: string
  }
}

/** Resposta de uma aprovação (kind="approval"). `updated_input` sanitiza o input
 *  antes de aprovar; `message` vira o motivo do deny mostrado ao Claude. */
export interface ApprovalAnswer {
  allow: boolean
  updated_input?: unknown
  message?: string
}

/** Uma opção de resposta a uma pergunta (espelha AskUserQuestion). */
export interface QuestionOption {
  label: string
  description: string
}

/** Uma pergunta estruturada dentro do pedido (kind="question"). */
export interface Question {
  /** rótulo curto (≤12) — agrupa a resposta. */
  header: string
  /** o enunciado, título do bloco. */
  question: string
  /** true = checkboxes (múltipla), false = radios (única). */
  multiSelect: boolean
  options: QuestionOption[]
}

/** `data` de um pedido de pergunta (kind="question"). Espelha o input do `ask_user`. */
export interface QuestionData {
  questions: Question[]
}

/** Resposta a um pedido de pergunta (kind="question"). Uma entrada por pergunta, com
 *  os `label`s selecionados (inclui texto livre de "Outro" se preenchido). */
export interface QuestionAnswer {
  answers: { header: string; selected: string[] }[]
}

/** Qualquer resposta (por kind). */
export type InteractionAnswer = ApprovalAnswer | QuestionAnswer | PlanAnswer

/** Escuta os pedidos de interação pendente (evento global do backend). Retorna o
 *  unlisten. O turno do agente fica bloqueado até responder via `answerInteraction`.
 *
 *  COMPAT: além do canônico `interaction://request`, escuta o legado
 *  `approval://request` (mapeando pro kind "approval"), assim funciona qualquer que
 *  seja o estado do backend durante a migração. */
export async function onInteractionRequest(
  cb: (req: InteractionRequest) => void,
): Promise<UnlistenFn> {
  const un1 = await listen<InteractionRequest>("interaction://request", (e) =>
    cb(e.payload),
  )
  // Compat: o backend antigo emite ApprovalRequest cru em `approval://request`
  // ({ id, run_id, tool_name, command, input }) — normaliza pro shape unificado.
  // O run_id vai nos DOIS lugares (topo e data): o topo é o contrato atual, o
  // data mantém quem ainda lê o shape legado.
  const un2 = await listen<Record<string, unknown>>(
    "approval://request",
    (e) => {
      const p = e.payload
      const runId = typeof p.run_id === "string" ? p.run_id : undefined
      cb({
        id: String(p.id),
        run_id: runId,
        kind: "approval",
        data: {
          run_id: runId,
          tool_name: p.tool_name,
          command: p.command,
          input: p.input,
        } as ApprovalData,
      })
    },
  )
  return () => {
    un1()
    un2()
  }
}

/** Escuta as resoluções FEITAS PELO BACKEND (fail-closed no fim/cancel do run):
 *  o card daquele id morreu junto com o run → a UI deve removê-lo (senão ficava
 *  travado dizendo "turno pausado" sobre um turno já morto — achado da revisão). */
export async function onInteractionResolved(
  cb: (id: string) => void,
): Promise<UnlistenFn> {
  return listen<{ id: string }>("interaction://resolved", (e) =>
    cb(e.payload.id),
  )
}

/** Resposta fail-closed por kind (o que o dismiss manual envia): nega a
 *  aprovação / devolve pergunta sem respostas.
 *
 *  `reason` é o motivo que o MODELO lê no deny. O default descreve o dismiss
 *  manual; quem fecha o pedido por outro motivo passa o seu — o timeout de run
 *  desassistido (lib/watchdog) precisa disso, senão o modelo ouviria
 *  "dispensado pelo usuário" justo no caso em que não havia usuário nenhum. */
export function failClosedAnswer(
  kind: InteractionRequest["kind"],
  reason = "dispensado pelo usuário",
): InteractionAnswer {
  return kind === "question" ? { answers: [] } : { allow: false, message: reason }
}

/** Entrega a resposta do usuário ao backend, que destrava o turno.
 *
 *  COMPAT: tenta o comando canônico `answer_interaction`; se ele não existir ainda
 *  (backend legado) e a resposta for de aprovação, cai em `answer_approval`. */
export async function answerInteraction(
  id: string,
  answer: InteractionAnswer,
): Promise<void> {
  try {
    await invoke("answer_interaction", { id, answer })
  } catch (err) {
    // Fallback só faz sentido p/ aprovação (o legado não conhece "question").
    if (isApprovalAnswer(answer)) {
      await invoke("answer_approval", {
        id,
        allow: answer.allow,
        updatedInput: answer.updated_input ?? null,
        message: answer.message ?? null,
      })
      return
    }
    throw err
  }
}

function isApprovalAnswer(a: InteractionAnswer): a is ApprovalAnswer {
  return typeof (a as ApprovalAnswer).allow === "boolean"
}
