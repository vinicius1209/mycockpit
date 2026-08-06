// office/bridge/voice.ts — dono ÚNICO do mic no office (§5.5 do
// docs/agent-office.md). Regras:
//   - startDictation recusa se o office JÁ grava (flag de módulo) e propaga o
//     erro do backend quando a gravação GLOBAL (MicButton) está com o mic —
//     nunca duas gravações ao mesmo tempo.
//   - Parciais de `stt://partial` só são repassados aos assinantes quando o
//     OFFICE iniciou a gravação (o MicButton tem a própria legenda).
//   - Texto final (stopDictation) volta pro chamador — cai no composer do dock
//     pra revisão; Enter envia (send.ts).
// Fora do Tauri (vite dev, O8) não há mic: start falha com mensagem clara.

import { listen } from "@tauri-apps/api/event"
import { isTauri } from "@/lib/db"
import { sttCancel, sttStart, sttStop } from "@/lib/stt"

/** true enquanto a gravação corrente pertence AO OFFICE. */
let recording = false

/** Assinantes das parciais (legenda no balão do dock). */
const partialCbs = new Set<(text: string) => void>()

/** Assinantes do FIM do ditado (stop, cancel E stt://ended — sidecar morto).
 *  É o gatilho ÚNICO do espelho de UI (useOfficeUi.recording=false): sem ele o
 *  dock ficaria "Ouvindo…" pra sempre quando o sidecar morre no meio. */
const endedCbs = new Set<() => void>()

function emitEnded(): void {
  for (const cb of endedCbs) cb()
}

/** Listeners globais do Tauri, registrados UMA vez por processo (lazy, no 1º
 *  start). Cache de promessa que RESETA em falha — padrão do repo. */
let listenersReady: Promise<void> | null = null

function ensureListeners(): Promise<void> {
  if (!listenersReady) {
    const run = (async () => {
      // parcial ao vivo — repassa SÓ quando o office é o dono da gravação
      await listen<string>("stt://partial", (e) => {
        if (!recording) return
        for (const cb of partialCbs) cb(e.payload)
      })
      // sidecar morreu no meio (stt://ended): solta a flag — senão o office
      // ficaria "gravando" pra sempre e recusaria qualquer novo ditado.
      await listen<{ text?: string; error?: string }>("stt://ended", () => {
        if (!recording) return
        recording = false
        void sttCancel() // limpa a sessão do sidecar morto (gesto do MicButton)
        emitEnded()
      })
    })()
    listenersReady = run.catch((e) => {
      listenersReady = null
      throw e
    })
  }
  return listenersReady
}

/** Abre o mic pro office. Lança se: fora do Tauri, o office já grava, ou o
 *  backend recusa (gravação global do MicButton em andamento). */
export async function startDictation(vocab: string[]): Promise<void> {
  if (!isTauri()) {
    throw new Error("Ditado disponível apenas no app (bun run tauri dev)")
  }
  if (recording) {
    throw new Error("Ditado do office já em andamento")
  }
  await ensureListeners()
  // mic já ocupado pela gravação global → o backend rejeita o start; propaga
  // SEM ligar a flag (o office não virou dono de nada).
  await sttStart(vocab)
  recording = true
}

/** Para a gravação do office e devolve o texto final (cai no composer pra
 *  revisão). Sem gravação do office em andamento → no-op ("" — nunca rouba o
 *  stop de uma gravação global alheia). */
export async function stopDictation(): Promise<string> {
  if (!recording) {
    emitEnded() // auto-cura de espelho dessincronizado (não toca o mic global)
    return ""
  }
  try {
    // o office ainda não tem onde mostrar o aviso de degradação do sidecar
    // (`warn`); o TEXTO nunca se perde, que é a garantia que importa aqui.
    return (await sttStop()).text
  } finally {
    recording = false
    emitEnded()
  }
}

/** Descarta a gravação do office (Esc). Sem gravação do office, não toca o
 *  backend — mas SEMPRE emite o fim (auto-cura de espelho dessincronizado). */
export async function cancelDictation(): Promise<void> {
  const was = recording
  recording = false
  emitEnded()
  if (!was) return
  await sttCancel()
}

/** Assina as parciais do ditado DO OFFICE. Retorna o unsubscribe. Parciais de
 *  uma gravação global (MicButton) nunca chegam aqui. */
export function onDictationPartial(cb: (text: string) => void): () => void {
  partialCbs.add(cb)
  return () => {
    partialCbs.delete(cb)
  }
}

/** Assina o FIM do ditado do office (stopDictation, cancelDictation e
 *  stt://ended). O espelho de UI (recording=false no store) vive num ÚNICO
 *  assinante — nada de pares manuais setRecording(false) espalhados. */
export function onDictationEnded(cb: () => void): () => void {
  endedCbs.add(cb)
  return () => {
    endedCbs.delete(cb)
  }
}
