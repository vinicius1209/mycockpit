// O vigia de PEDIDO SEM RESPOSTA em run desassistido: quem estourou o prazo é
// respondido fail-closed, e o desfecho fica VISÍVEL.
//
// Saiu de lib/watchdog.ts, que está 100+ linhas acima do teto e cresceu de novo
// com o gate de plano. O recorte é fechado: os outros vigias observam SILÊNCIO
// (turno mudo, fase parada, card parado); este observa uma PERGUNTA sem
// resposta, tem memória própria (`pendingMarks`) e é o único que RESPONDE por
// você.

import { summarizeApproval } from "@/lib/approvalSummary"
import {
  failClosedAnswer,
  type ApprovalData,
  type InteractionRequest,
  type QuestionData,
} from "@/lib/interaction"
import { notifyUnattendedTimeout } from "@/lib/notify"
import {
  expiredUnattended,
  unattendedConvOf,
  unattendedRunIds,
  type PendingMark,
} from "@/lib/unattendedRuns"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import {
  currentOriginAnyKind,
  questionHeadline,
  runIdOf,
  useInteractions,
} from "@/store/interactions"

const pendingMarks = new Map<string, PendingMark>()

/** (testes) zera a memória deste vigia. */
export function _resetPendingMarks(): void {
  pendingMarks.clear()
}


/** Fecha UM pedido que estourou o prazo do run desassistido: responde
 *  fail-closed (o turno destrava e termina) e deixa o desfecho VISÍVEL. */
/** Gate de PLANO fica de fora do vigia: não trava run nenhum (nasce com o turno
 *  já encerrado), e auto-negar seria descartar o plano em silêncio — o sumiço
 *  que ele veio consertar (lib/planGate). O pedido de RECURSO também (ADR-261):
 *  o backend espera no máximo 90 s e avisa quando desiste (`pedido_encerrado`).
 *  O predicado ESTREITA o tipo pra que quem consome (notify) não precise fingir
 *  que sabe lidar com os locais. */
function naoEhPlano(
  r: InteractionRequest,
): r is InteractionRequest & { kind: "approval" | "question" } {
  return r.kind !== "plan" && r.kind !== "recurso"
}

function answerUnattended(
  req: InteractionRequest & { kind: "approval" | "question" },
  mark: PendingMark,
  minutes: number,
): void {
  const headline =
    req.kind === "question"
      ? questionHeadline(req.data as QuestionData | undefined)
      : summarizeApproval((req.data ?? {}) as ApprovalData).headline
  // origem ANTES de responder: `answer` tira o pedido da fila e o run termina
  // logo em seguida — depois disso o dono não é mais resolvível pelos stores.
  const origin = currentOriginAnyKind(req)

  // 1. FAIL-CLOSED pelo mesmo caminho do dismiss manual (store.answer: remove
  //    da fila + answerInteraction). O motivo vai HONESTO pro modelo: ninguém
  //    dispensou nada, ninguém estava lá.
  useInteractions
    .getState()
    .answer(
      req.id,
      failClosedAnswer(
        req.kind,
        `negado automaticamente: execução desassistida (automação) e ninguém respondeu em ${minutes} min`,
      ),
    )

  // 2. rastro NO FIO (kind "notice", linha discreta): é o que sobrevive ao
  //    turno e explica, quando você abrir a conversa, por que a automação
  //    terminou sem fazer o que pediu. O convId registrado no disparo é o
  //    fallback quando o dono já não resolve.
  const convId = origin?.convId ?? unattendedConvOf(mark.runId)
  if (convId) {
    useChat.getState().handleEvent(convId, {
      type: "notice",
      message:
        req.kind === "question"
          ? `Pergunta devolvida sem resposta: "${headline}" esperou ${minutes} min numa execução desassistida.`
          : `Permissão negada automaticamente: ${headline} esperou ${minutes} min sem resposta numa execução desassistida.`,
    })
  }

  // 3. feed do sino (a conversa da automação nasce em background: sem isto o
  //    desfecho só existiria numa tela que você não abriu).
  notifyUnattendedTimeout({
    projectId:
      origin?.projectId ??
      (convId ? (useChat.getState().byId[convId]?.projectId ?? "") : ""),
    convId: convId ?? undefined,
    projectName: origin?.projectName ?? "",
    convTitle: origin?.convTitle ?? "Automação",
    kind: req.kind,
    headline,
    minutes,
  })
}

/** UMA passada do vigia de PEDIDO SEM RESPOSTA em run desassistido
 *  (determinística dado stores + memória; `now` injetável p/ teste). */
export function checkUnattendedInteractions(now: number = Date.now()): void {
  // Gate de PLANO fica de fora: não trava run nenhum (nasce com o turno já
  // encerrado), e auto-negar seria descartar o plano em silêncio (lib/planGate).
  const queue = useInteractions.getState().queue.filter(naoEhPlano)
  // sincroniza a memória com a fila ANTES de decidir: pedido novo ganha o
  // carimbo de 1ª vista (âncora do prazo) e pedido que saiu da fila (você
  // respondeu, ou o run morreu e o Drop do backend resolveu) some daqui. É
  // isto que substitui "cancelar o timer": não existe timer por pedido, existe
  // memória podada contra a realidade a cada passada.
  const alive = new Set<string>()
  const marks: PendingMark[] = []
  for (const req of queue) {
    alive.add(req.id)
    let mark = pendingMarks.get(req.id)
    if (!mark) {
      mark = { id: req.id, kind: req.kind, runId: runIdOf(req), since: now }
      pendingMarks.set(req.id, mark)
    }
    marks.push(mark)
  }
  for (const id of [...pendingMarks.keys()]) {
    if (!alive.has(id)) pendingMarks.delete(id)
  }

  const afterMin = useApp.getState().settings.unattendedAnswerAfterMin
  const expired = expiredUnattended(marks, unattendedRunIds(), afterMin, now)
  if (expired.length === 0) return
  const byId = new Map(queue.map((r) => [r.id, r]))
  for (const mark of expired) {
    const req = byId.get(mark.id)
    if (!req) continue
    // some da memória ANTES de responder: um pedido só é cobrado UMA vez. Não
    // há retentativa de propósito — o envio é best-effort e falha dele significa
    // que o run já morreu (o Drop do backend fail-closed cobre o lado de lá).
    pendingMarks.delete(mark.id)
    const minutes = Math.max(afterMin, Math.round((now - mark.since) / 60_000))
    // ruidoso mas NÃO fatal: sem o catch, um pedido problemático derrubava a
    // passada inteira e os outros expirados só seriam cobrados no tick seguinte.
    try {
      answerUnattended(req, mark, minutes)
    } catch (e) {
      console.error("[vigia] falha ao negar pedido desassistido", mark.id, e)
    }
  }
}
