// Vigia de TURNO MUDO (P2 do pacote de confiabilidade): um turno "running" que
// fica minutos sem produzir NENHUM item novo costuma ser CLI travada (socket
// pendurado, prompt engolido, processo zumbi) — e nada avisava. Este vigia
// observa o useChat FORA do hot path (subscribe coalescido + tick lento),
// compara a ASSINATURA leve dos itens (padrão itemsSignature do derive do
// office) e, passado o limiar (settings.stalledAfterMin; 0 = desligado), avisa
// UMA vez por episódio: notificação nativa (notifyTurnStalled) + toast
// acionável ("Ver conversa" / "Cancelar turno") + flag transient stalledSince
// na conversa (derive do office e snapshot do Companion leem). Atividade nova
// fecha o episódio — mudo DE NOVO por outro período completo ⇒ novo aviso.

import { toast } from "sonner"
import { agentLabel, cancelAgent } from "@/lib/agent"
import { notifyTurnStalled } from "@/lib/notify"
import { useApp } from "@/store/app"
import { useChat, type ChatItem } from "@/store/chat"

/** Coalescing do subscribe do chat (o vigia nunca roda por delta de stream). */
const COALESCE_MS = 5_000
/** Tick de relógio: silêncio não emite evento de store — alguém precisa olhar. */
const TICK_MS = 30_000

type Mark = { sig: string; at: number }
/** Última assinatura de itens vista por conv running + quando ela MUDOU. */
const marks = new Map<string, Mark>()

/** (testes) zera a memória do vigia. */
export function _resetWatchdogState(): void {
  marks.clear()
}

/** Assinatura leve do andamento (padrão itemsSignature do derive): muda quando
 *  chega delta/tool/result — é o "sinal de vida" que o vigia observa.
 *  DECISÃO (P2): uma tool RODANDO há muito sem result (build/suíte longa) NÃO
 *  muda a assinatura — conta como "mudo" e o aviso dispara. Intencional: o
 *  aviso é informativo ("o turno segue em execução"), não cancela nada, e uma
 *  tool acima do limiar é exatamente o que o usuário quer conferir. Streaming
 *  de texto lento ≠ mudo: cada delta muda text.length ⇒ re-arma o cronômetro. */
function itemsSignature(items: ChatItem[]): string {
  const last = items[items.length - 1]
  if (!last) return "0"
  const extra =
    last.kind === "text"
      ? String(last.text.length)
      : last.kind === "tool"
        ? `${last.name}:${last.result ? 1 : 0}`
        : ""
  return `${items.length}:${last.id}:${last.kind}:${extra}`
}

/** Cancela o turno mudo (ação do toast): mata o auto-resume agendado e o run
 *  corrente — o mesmo par do "stop-activity" da tray (App.tsx). */
export async function cancelStalledTurn(convId: string): Promise<void> {
  const chat = useChat.getState()
  chat.cancelAutoResume(convId)
  const runId = chat.byId[convId]?.runId
  if (runId) await cancelAgent(runId)
}

/** Navega até a conversa muda (padrão openConversation da tray). */
async function openStalledConv(convId: string): Promise<void> {
  const chat = useChat.getState()
  const projectId = chat.byId[convId]?.projectId
  if (!projectId) return
  useApp.getState().setActiveProject(projectId)
  await chat.openProject(projectId)
  await chat.switchConversation(convId)
  useApp.getState().setViewMode("linear")
}

function showStalledToast(
  convId: string,
  agent: string,
  minutes: number,
): void {
  toast(`${agentLabel(agent)} está mudo há ${minutes} min`, {
    description: "O turno segue em execução, mas sem produzir nada novo.",
    duration: 15_000,
    action: {
      label: "Ver conversa",
      onClick: () => void openStalledConv(convId),
    },
    cancel: {
      label: "Cancelar turno",
      onClick: () => void cancelStalledTurn(convId),
    },
  })
}

/** UMA passada do vigia (determinística dado stores + memória; `now` injetável
 *  p/ teste): marca atividade, detecta silêncio > limiar, fecha episódios. */
export function checkStalledTurns(now: number = Date.now()): void {
  const afterMin = useApp.getState().settings.stalledAfterMin
  const chat = useChat.getState()
  for (const [convId, c] of Object.entries(chat.byId)) {
    if (!c.running) {
      // turno acabou: esquece a marca e fecha o episódio (se aberto).
      marks.delete(convId)
      if (c.stalledSince != null) chat.clearStalled(convId)
      continue
    }
    const sig = itemsSignature(c.items)
    const prev = marks.get(convId)
    if (!prev || prev.sig !== sig) {
      // atividade (ou 1ª vista): re-arma o cronômetro e fecha o episódio.
      marks.set(convId, { sig, at: now })
      if (c.stalledSince != null) chat.clearStalled(convId)
      continue
    }
    if (afterMin <= 0) {
      // 0 = desligado: segue medindo (religar já tem baseline), sem avisar.
      if (c.stalledSince != null) chat.clearStalled(convId)
      continue
    }
    if (c.stalledSince != null) continue // já avisado NESTE episódio
    const silentMs = now - prev.at
    if (silentMs < afterMin * 60_000) continue
    const minutes = Math.max(afterMin, Math.round(silentMs / 60_000))
    chat.markStalled(convId, prev.at)
    notifyTurnStalled(convId, c.agent, minutes)
    showStalledToast(convId, c.agent, minutes)
  }
  // conversa removida não deixa marca órfã
  for (const id of [...marks.keys()]) {
    if (!chat.byId[id]) marks.delete(id)
  }
}

/** Liga o vigia: subscribe do useChat (coalescido ≥5s, trailing edge) + tick
 *  de 30s (silêncio não gera evento de store). Retorna o stop. */
export function startTurnWatchdog(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = () => {
    if (timer) return // já agendado neste burst → coalesce
    timer = setTimeout(() => {
      timer = null
      checkStalledTurns()
    }, COALESCE_MS)
  }
  const unsub = useChat.subscribe(schedule)
  const ticker = setInterval(() => checkStalledTurns(), TICK_MS)
  checkStalledTurns() // baseline imediato
  return () => {
    unsub()
    clearInterval(ticker)
    if (timer) clearTimeout(timer)
  }
}
