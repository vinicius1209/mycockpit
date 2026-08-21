// A metade de ESCRITA do Companion: o que o celular MANDA fazer.
//
// Saiu de lib/companion.ts pela catraca de tamanho, e a fronteira não foi
// arbitrária — o arquivo já a tinha desenhado com os próprios banners. O que
// ficou lá é LEITURA (montar o snapshot que o aparelho renderiza); o que veio
// pra cá é ESCRITA (lançar tarefa, responder interação, parar turno), que é
// justamente a metade onde o fail-closed do §9 precisa valer: uma ação vinda
// de fora da máquina não pode ser aceita em silêncio nem respondida com
// otimismo. Por isso o veredito (`CompanionActionResult`) mora junto do
// executor, e não do lado que só lê.

import { invoke } from "@tauri-apps/api/core"
import { pingConvUpdated } from "@/lib/companionPing"
import { getAgentDef } from "@/lib/agentDefs"
import { dispatchBlockReason } from "@/lib/agents"
import { hasAssistantReply } from "@/lib/presets"
import { hasExecutorTurn } from "@/store/chat"
import { OFFICE_AGENTS, type OfficeAgentId } from "@/lib/fleet/types"
import type { Attachment, AttachmentKind } from "@/lib/attachments"
import type { InteractionAnswer } from "@/lib/interaction"
import { feedbackLesson } from "@/lib/learning"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import {
  cancelDeskTurn,
  ensureDeskConversation,
  sendFromDesk,
} from "@/lib/fleet/send"

// ───────────────────────────────────────────────── executor (companion://action)

/** Anexos vindos do celular: o upload multipart JÁ salvou os blobs via a mesma
 *  rotina do save_attachment (Rust) e devolveu os metadados — aqui só validamos
 *  o SHAPE e o path relativo esperado ("attachments/…"); nada de path absoluto
 *  ou fora do cache de anexos passa. */
function sanitizeAttachments(v: unknown): Attachment[] {
  if (!Array.isArray(v)) return []
  const out: Attachment[] = []
  for (const raw of v) {
    if (typeof raw !== "object" || raw === null) continue
    const a = raw as Record<string, unknown>
    if (typeof a.path !== "string" || !a.path.startsWith("attachments/")) continue
    if (a.path.includes("..")) continue // nunca escapa do cache de anexos
    const kind: AttachmentKind =
      a.kind === "image" || a.kind === "pdf" ? a.kind : "other"
    out.push({
      path: a.path,
      name: typeof a.name === "string" ? a.name : "anexo",
      kind,
      mime: typeof a.mime === "string" ? a.mime : "application/octet-stream",
      bytes: typeof a.bytes === "number" ? a.bytes : 0,
    })
  }
  return out
}

/** Anexos resolvidos pelo RUST no payload da ação: `attachments` chega como
 *  MAPA {attachmentId → Attachment} (o cache de uploads do celular) + a ordem
 *  escolhida em `attachmentIds`. Array direto (shape do desktop) também passa. */
function uploadedAttachments(p: Record<string, unknown>): Attachment[] {
  if (Array.isArray(p.attachments)) return sanitizeAttachments(p.attachments)
  if (typeof p.attachments !== "object" || p.attachments === null) return []
  const map = p.attachments as Record<string, unknown>
  const ids = Array.isArray(p.attachmentIds)
    ? p.attachmentIds.filter((x): x is string => typeof x === "string")
    : Object.keys(map)
  return sanitizeAttachments(ids.map((id) => map[id]))
}

function isInteractionAnswer(v: unknown): v is InteractionAnswer {
  if (typeof v !== "object" || v === null) return false
  const a = v as Record<string, unknown>
  return typeof a.allow === "boolean" || Array.isArray(a.answers)
}

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

// ─────────────────────────────────────────── resultado de ação (C2, fail-closed)

/** Veredito de uma ação do celular: o 202 do POST é só "aceitei"; ISTO é a
 *  resposta de verdade (lançou / já tinha acabado / projeto sumiu), devolvida
 *  ao aparelho via WS (companion_action_result → {type:"action-result"}). */
export interface CompanionActionResult {
  actionId: string
  kind: string
  ok: boolean
  /** Motivo LEGÍVEL (pt-BR) — obrigatório no fracasso, útil no sucesso. */
  message: string
  /** launch_task ok: a conversa criada (a página navega direto pro fio). */
  convId?: string
  projectId?: string
  agent?: string
}

/** Empurra o veredito pro(s) celular(es). NUNCA silencioso no erro (ADR-017:
 *  o aparelho está esperando a resposta) — sem comando disponível, loga. */
function pushActionResult(result: CompanionActionResult): void {
  invoke("companion_action_result", { result }).catch((e) => {
    console.warn("[companion] não consegui devolver o resultado da ação:", e)
  })
}

/** Veredito HONESTO do stop_turn, computado ANTES do cancelamento: espelha a
 *  semântica do Stop do app (ChatPanel/tray) — disputa Fusion aborta; turno
 *  FINALIZANDO não é interrompível (runId já foi embora); turno morto idem. */
function stopTurnVerdict(convId: string): { ok: boolean; message: string } {
  const fusion = useFusion.getState().byConv[convId]
  if (fusion && (fusion.phase === "running" || fusion.phase === "judging")) {
    return { ok: true, message: "Disputa interrompida." }
  }
  if (fusion?.phase === "promoting") {
    // promoção é one-shot (abort no-opa): não finge que parou — mesma copy do
    // stop da tray.
    return {
      ok: false,
      message: "Disputa promovendo o vencedor, aguarde concluir.",
    }
  }
  const c = useChat.getState().byId[convId]
  if (c?.finalizing) {
    return {
      ok: false,
      message: "O turno já está finalizando, não dá mais para interromper.",
    }
  }
  if (c?.running && c.runId) return { ok: true, message: "Turno interrompido." }
  if (c?.running) {
    return {
      ok: false,
      message:
        "Não consegui interromper este turno pelo celular. Veja o app no Mac.",
    }
  }
  return { ok: false, message: "O turno já não estava em execução." }
}

/** Executa UMA ação vinda do celular (payload do evento `companion://action`).
 *  O Rust já RECONSTRUIU o payload (whitelist fechada, campos extras nunca
 *  passam) com o discriminador `kind` — o mesmo vocabulário do POST /api/action.
 *  Switch FECHADO — ação desconhecida é ignorada com aviso; toda ação passa
 *  pelos stores/bridges existentes (guardas intactas: answerGate no-opa sem
 *  gate, answer no-opa se o id já saiu da fila, sendFromDesk tem TODAS as
 *  guardas de envio). Exportada p/ teste. */
export async function handleCompanionAction(payload: unknown): Promise<void> {
  const p =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {}
  const action = str(p.kind)
  switch (action) {
    case "answer_gate": {
      const convId = str(p.convId)
      if (!convId || !Array.isArray(p.answers)) {
        console.warn("[companion] answer_gate malformado — ignorado", p)
        return
      }
      const answers = p.answers.map((raw) => {
        const a =
          typeof raw === "object" && raw !== null
            ? (raw as Record<string, unknown>)
            : {}
        const attachments = sanitizeAttachments(a.attachments)
        return {
          text: str(a.text),
          attachments: attachments.length ? attachments : undefined,
        }
      })
      // Uploads do celular viajam FORA das answers (attachmentIds + mapa
      // resolvido pelo Rust): anexam à PRIMEIRA resposta — o gate entrega tudo
      // ao agente de uma vez, a posição não muda a semântica.
      const uploaded = uploadedAttachments(p)
      if (uploaded.length) {
        const first = answers[0] ?? { text: "", attachments: undefined }
        answers[0] = {
          text: first.text,
          attachments: [...(first.attachments ?? []), ...uploaded],
        }
      }
      useMission.getState().answerGate(convId, answers)
      return
    }
    case "answer_interaction": {
      const id = str(p.id)
      if (!id || !isInteractionAnswer(p.answer)) {
        console.warn("[companion] answer_interaction malformado — ignorado", p)
        return
      }
      useInteractions.getState().answer(id, p.answer)
      return
    }
    case "stop_mission": {
      const convId = str(p.convId)
      if (!convId) return
      // veredito ANTES do abort (depois o status já mudou); o abort continua
      // incondicional — parar é sempre gesto seguro (no-op se nada roda).
      const wasRunning =
        useMission.getState().byConv[convId]?.status === "running"
      useMission.getState().abort(convId)
      const actionId = str(p.actionId)
      if (actionId) {
        pushActionResult({
          actionId,
          kind: "stop_mission",
          ok: wasRunning,
          message: wasRunning
            ? "Missão interrompida."
            : "A missão já não estava em execução.",
          convId,
        })
      }
      return
    }
    case "stop_turn": {
      const convId = str(p.convId)
      if (!convId) return
      // C2 — mesma semântica/copy do Stop do app, inclusive "finalizando não
      // é interrompível". O veredito sai ANTES (cancelDeskTurn muda o estado);
      // o cancel continua incondicional (comportamento de sempre, é no-op
      // seguro quando não há o que parar).
      const verdict = stopTurnVerdict(convId)
      await cancelDeskTurn(convId)
      const actionId = str(p.actionId)
      if (actionId) {
        pushActionResult({ actionId, kind: "stop_turn", ...verdict, convId })
      }
      return
    }
    case "send_message": {
      // C3 — veredito honesto de volta pro celular (fecha o furo registrado na
      // revisão C2): com actionId, TODO desfecho vira action-result — recusa
      // com motivo legível, aceite com o convId REAL (a página sem conversa
      // resolvida adota o fio na hora). Sem actionId (página antiga), o
      // comportamento pré-existente segue intacto (rejeição sobe pro catch do
      // listener → aviso nativo no desktop).
      const actionId = str(p.actionId)
      const fail = (message: string): void => {
        console.warn("[companion] send_message recusado:", message)
        if (actionId) {
          pushActionResult({ actionId, kind: "send_message", ok: false, message })
        }
      }
      const projectId = str(p.projectId)
      const agent = str(p.agent)
      const text = str(p.text).trim()
      if (!projectId || !text || !OFFICE_AGENTS.includes(agent as OfficeAgentId)) {
        fail("Pedido malformado. Atualize a página do Companion e tente de novo.")
        return
      }
      const proj = useApp.getState().projects.find((pr) => pr.id === projectId)
      if (!proj) {
        fail("O projeto não existe mais no app.")
        return
      }
      const fleetAgent = agent as OfficeAgentId
      // P5: convId explícito ("abrir conversa" não-mesa no celular) SÓ vale se
      // a conversa pertence às metas do projeto — qualquer outro id cai na
      // conversa de MESA (nunca escreve numa conversa alheia/fantasma). As
      // guardas do sendFromDesk cuidam do resto: ensureConversationLoaded,
      // corrupt, missão rodando, e o agent TRAVADO da conversa VENCE o da ação.
      const wanted = str(p.convId)
      const metas = useChat.getState().conversationsByProject[projectId] ?? []
      const useWanted = !!wanted && metas.some((m) => m.id === wanted)
      const convId = useWanted
        ? wanted
        : await ensureDeskConversation(projectId, fleetAgent)
      // F-A (follow-up S0) — guarda de availability ANTES de despachar: CLI
      // ausente/deslogada não recebe turno. O POST /api/action já devolveu 202
      // (fire-and-forget), então a resposta honesta volta pro celular pelo
      // MESMO envelope do histórico: notice persistido na conversa + ping de
      // conv atualizada (a página refetcha e mostra o motivo). D3: a guarda
      // vale pro agent EFETIVO da conversa resolvida — numa conversa travada o
      // agent DELA vence o da ação (regra do sendFromDesk), e sem essa
      // resolução o toast do desktop fechado seria a única resposta. A mesa já
      // saiu carregada do ensureDeskConversation; o alvo explícito carrega
      // aqui antes de ler o estado.
      if (useWanted) {
        await useChat.getState().ensureConversationLoaded(projectId, convId)
      }
      const conv = useChat.getState().byId[convId]
      // pareceres de conselheiro (advice) NÃO travam o agent do 1º turno (E1).
      const locked = conv != null && hasExecutorTurn(conv.items)
      let effectiveAgent: string = locked ? conv.agent : fleetAgent
      // Preset da conversa manda no agent do 1º turno (mesma resolução do
      // sendFromDesk, inclusive a re-injeção D1: travada SEM resposta).
      if (conv?.presetId && (!locked || !hasAssistantReply(conv.items))) {
        try {
          const preset = await getAgentDef(
            useApp.getState().projects.find((p) => p.id === projectId)?.path ??
              null,
            conv.presetId,
          )
          if (preset) effectiveAgent = preset.backend
        } catch {
          // preset ilegível: o preflight fail-closed do sendFromDesk cobre.
        }
      }
      const dispatchBlock = dispatchBlockReason(
        effectiveAgent,
        useApp.getState().settings.detected ?? {},
      )
      if (dispatchBlock) {
        await useChat.getState().ensureConversationLoaded(projectId, convId)
        useChat.getState().handleEvent(convId, {
          type: "notice",
          message: dispatchBlock,
        })
        // D1: o ping só sai DEPOIS do UPSERT commitar — o refetch do celular
        // lê o SQLite, e conversa idle não gera ping novo depois deste.
        await useChat.getState().persist(convId)
        pingConvUpdated(convId)
        // C3 — além do notice no fio, o motivo volta como veredito direto
        // (a página mostra na hora, sem depender do refetch acertar a conversa).
        fail(dispatchBlock)
        return
      }
      // C3 — mesmo padrão do launch_task: o aceite (start/queued) responde o
      // celular na hora; rejeição interna do sendFromDesk NÃO pode escapar
      // quando há actionId (o celular está esperando o veredito). Sem
      // actionId, a exceção sobe como sempre (aviso nativo no desktop).
      let accepted = false
      try {
        await sendFromDesk({
          convId,
          projectId,
          projectPath: proj.path,
          agent: fleetAgent,
          text,
          attachments: uploadedAttachments(p),
          // onAccepted só viaja COM actionId: sem id não há veredito a devolver
          // e o shape da chamada fica idêntico ao pré-C3 (compat).
          ...(actionId
            ? {
                onAccepted: () => {
                  accepted = true
                  pushActionResult({
                    actionId,
                    kind: "send_message",
                    ok: true,
                    message: "Mensagem enviada.",
                    convId,
                    projectId,
                    agent: effectiveAgent,
                  })
                },
              }
            : {}),
        })
      } catch (e) {
        if (!actionId) throw e
        // aceito ⇒ o ok já saiu e o erro do TURNO aparece no próprio fio
        // (refetch do celular); não-aceito ⇒ o fail() abaixo devolve o motivo.
        console.warn("[companion] send_message: envio rejeitou:", e)
      }
      if (actionId && !accepted) {
        fail("O app não conseguiu iniciar o turno. Veja o desktop para detalhes.")
      }
      return
    }
    case "launch_task": {
      // C2 — lançar tarefa do celular: conversa NOVA pelos MESMOS stores do
      // composer (registerConversation → preset opcional → sendFromDesk; a
      // persona do Especialista entra pelo resolveFirstTurnPersona de sempre).
      // Fail-closed com motivo legível: o veredito volta pro aparelho pelo
      // action-result — o 202 do POST nunca vira sucesso fingido.
      const actionId = str(p.actionId)
      const fail = (message: string): void => {
        console.warn("[companion] launch_task recusado:", message)
        if (actionId) {
          pushActionResult({ actionId, kind: "launch_task", ok: false, message })
        }
      }
      const projectId = str(p.projectId)
      const agent = str(p.agent)
      const text = str(p.text).trim()
      if (
        !projectId ||
        !text ||
        !OFFICE_AGENTS.includes(agent as OfficeAgentId)
      ) {
        fail("Pedido malformado. Atualize a página do Companion e tente de novo.")
        return
      }
      const proj = useApp.getState().projects.find((pr) => pr.id === projectId)
      if (!proj) {
        fail("O projeto não existe mais no app.")
        return
      }
      // Especialista opcional: valida JÁ (arquivo legível no projeto) — o
      // preflight fail-closed do sendFromDesk revalida skills/policy depois.
      const presetId = str(p.presetId)
      let preset: { id: string; name: string; backend: string } | null = null
      if (presetId) {
        try {
          const def = await getAgentDef(proj.path, presetId)
          if (!def) {
            fail("O Especialista escolhido não está disponível neste projeto.")
            return
          }
          preset = { id: def.id, name: def.name, backend: def.backend }
        } catch {
          fail("Não consegui carregar o Especialista escolhido.")
          return
        }
      }
      // F-A — guarda de availability ANTES de criar qualquer coisa: o agent
      // EFETIVO é o backend do Especialista quando há um.
      const effectiveAgent = preset?.backend ?? agent
      const block = dispatchBlockReason(
        effectiveAgent,
        useApp.getState().settings.detected ?? {},
      )
      if (block) {
        fail(block)
        return
      }
      // Conversa nova SEM roubar a seleção do desktop (registerConversation é
      // a action feita p/ superfícies fora do ChatPanel). Título derivado do
      // prompt com a MESMA régua do deriveTitle do persist (44 chars).
      const flat = text.replace(/\s+/g, " ")
      const title = flat.length > 44 ? `${flat.slice(0, 44)}…` : flat
      const convId = crypto.randomUUID()
      try {
        await useChat
          .getState()
          .registerConversation(projectId, convId, title, effectiveAgent)
        await useChat.getState().ensureConversationLoaded(projectId, convId)
        if (preset) {
          await useChat.getState().setConversationPreset(convId, preset)
        }
      } catch (e) {
        console.warn("[companion] launch_task: criação da conversa falhou:", e)
        fail("Não consegui criar a conversa no app.")
        return
      }
      // O aceite (start/queued) responde o celular NA HORA; o await segura o
      // turno inteiro (mesmo padrão do send_message). Se o sendFromDesk
      // abortar numa guarda interna (preset quebrado, corrida), o onAccepted
      // nunca dispara e o fracasso volta honesto. Rejeição (ex.: DB falhou no
      // ensureConversationLoaded interno) NÃO pode escapar: sem o catch, o
      // fail() nunca rodaria e o celular só veria o timeout — revisão C2 §1.
      let accepted = false
      try {
        await sendFromDesk({
          convId,
          projectId,
          projectPath: proj.path,
          agent: agent as OfficeAgentId,
          text,
          attachments: uploadedAttachments(p),
          onAccepted: () => {
            accepted = true
            if (actionId) {
              pushActionResult({
                actionId,
                kind: "launch_task",
                ok: true,
                message: "Tarefa lançada.",
                convId,
                projectId,
                agent: effectiveAgent,
              })
            }
          },
        })
      } catch (e) {
        // aceito ⇒ o ok já saiu e o erro do TURNO aparece na própria conversa
        // (refetch do celular); não-aceito ⇒ o fail() abaixo devolve o veredito.
        console.warn("[companion] launch_task: envio rejeitou:", e)
      }
      if (!accepted) {
        fail("O app não conseguiu iniciar o turno. Veja o desktop para detalhes.")
      }
      return
    }
    // dispatch_card/close_card SAÍRAM (ADR-041): o Board não existe mais no
    // celular, e a whitelist do Rust já as rejeita antes de chegar aqui — se
    // um cliente velho mandar uma delas, cai no default (aviso, sem efeito).
    case "feedback_lesson": {
      // P6: 👍/👎 do item de turno concluído no celular — MESMO caminho do
      // ChatPanel (feedbackLesson → reinforceLessons das lições injetadas).
      const convId = str(p.convId)
      const verdict = str(p.verdict)
      if (!convId || (verdict !== "up" && verdict !== "down")) {
        console.warn("[companion] feedback_lesson malformado — ignorado", p)
        return
      }
      await feedbackLesson(convId, verdict)
      return
    }
    default:
      console.warn("[companion] ação desconhecida ignorada:", action)
  }
}

