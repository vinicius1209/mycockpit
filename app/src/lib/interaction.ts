import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

/** Padrão unificado de "interação pendente": o agente pede input no meio do turno
 *  (aprovar comando, responder pergunta estruturada, aprovar plano — futuro). Uma
 *  abstração, N `kind`s. O turno FICA PAUSADO até `answerInteraction`. Espelha o
 *  §Contrato de docs/interactive-input.md. */
export type InteractionKind = "approval" | "question"

/** Pedido normalizado emitido pelo backend no evento `interaction://request`.
 *  `data` varia por `kind` (ver ApprovalData / QuestionData). */
export interface InteractionRequest {
  /** id do pedido (correlaciona com a resposta). */
  id: string
  /** tipo da interação → escolhe o card na UI. */
  kind: InteractionKind
  /** payload específico do kind (ApprovalData | QuestionData). */
  data: unknown
}

/** `data` de um pedido de aprovação granular (kind="approval"). Mantém o shape que
 *  já vinha em `approval://request` (movido de lib/agent.ts). */
export interface ApprovalData {
  /** run que está pausado esperando a decisão. */
  run_id: string
  /** tool que o Claude quer usar (ex. "Bash", "Write"). */
  tool_name: string
  /** comando extraído do input p/ Bash (vazio p/ outras tools). */
  command: string
  /** input cru da tool (a UI mostra o detalhe). */
  input: unknown
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
export type InteractionAnswer = ApprovalAnswer | QuestionAnswer

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
  const un2 = await listen<Record<string, unknown>>(
    "approval://request",
    (e) => {
      const p = e.payload
      cb({
        id: String(p.id),
        kind: "approval",
        data: {
          run_id: p.run_id,
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
 *  aprovação / devolve pergunta sem respostas. */
export function failClosedAnswer(kind: InteractionRequest["kind"]): InteractionAnswer {
  return kind === "question"
    ? { answers: [] }
    : { allow: false, message: "dispensado pelo usuário" }
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
