// Ditado on-device (sidecar Swift): start abre o mic, stop devolve o texto.
import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

/** Desfecho do stop. `text` SEMPRE traz a fala (nenhum caminho perde texto);
 *  `warn` só existe quando o sidecar degradou — ex.: a passada sobre o arquivo
 *  de áudio falhou e o texto veio do reconhecimento ao vivo. */
export type SttOutcome = { text: string; warn: string | null }

/** Prova do dispositivo que abriu, não uma repetição da preferência salva. */
export type SttStartOutcome = {
  attemptId: string
  deviceUid: string
  deviceName: string
  warn: string | null
}

/** Todos os eventos carregam o dono da tentativa. Há vários MicButton montados
 * ao mesmo tempo, mas a sessão nativa é global; sem esta identidade, uma
 * superfície que perdeu a corrida de abertura poderia consumir fala alheia. */
export type SttPartialEvent = { attemptId: string; text: string }
export type SttLevelEvent = { attemptId: string; level: number }
export type SttCaptureLostEvent = { attemptId: string; message: string }
export type SttEndedEvent = {
  attemptId: string
  text?: string
  error?: string
  warn?: string | null
}

export function sttEventBelongsTo(
  attemptId: string | null,
  event: { attemptId: string },
): boolean {
  return attemptId !== null && event.attemptId === attemptId
}

/** Um microfone de entrada. `uid` é o id ESTÁVEL do CoreAudio — é ele que a
 *  preferência guarda. O `name` muda com o idioma do sistema e se repete entre
 *  dois headsets iguais, então guardar nome apontaria pro device errado. */
export type MicDevice = { uid: string; name: string }

/** Lista vazia em qualquer falha: a UI mostra só "padrão do sistema", que é o
 *  comportamento que sempre existiu. Nunca uma lista inventada. */
export async function sttDevices(): Promise<MicDevice[]> {
  if (!isTauri()) return []
  try {
    return await invoke<MicDevice[]>("stt_devices")
  } catch {
    return []
  }
}

/** `device`: UID escolhido nas Configurações; null = padrão do sistema. Device
 *  que sumiu não é barrado aqui — o sidecar cai no padrão e AVISA pelo `warn`,
 *  porque só ele sabe a verdade no instante em que abre o microfone. */
export async function sttStart(
  vocab: string[],
  device: string | null,
  attemptId: string,
): Promise<SttStartOutcome> {
  return invoke<SttStartOutcome>("stt_start", { vocab, device, attemptId })
}

export async function sttStop(): Promise<SttOutcome> {
  return invoke<SttOutcome>("stt_stop")
}

export async function sttCancel(): Promise<void> {
  return invoke("stt_cancel")
}
