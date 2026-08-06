// Ditado on-device (sidecar Swift): start abre o mic, stop devolve o texto.
import { invoke } from "@tauri-apps/api/core"

/** Desfecho do stop. `text` SEMPRE traz a fala (nenhum caminho perde texto);
 *  `warn` só existe quando o sidecar degradou — ex.: a passada sobre o arquivo
 *  de áudio falhou e o texto veio do reconhecimento ao vivo. */
export type SttOutcome = { text: string; warn: string | null }

export async function sttStart(vocab: string[]): Promise<void> {
  return invoke("stt_start", { vocab })
}

export async function sttStop(): Promise<SttOutcome> {
  return invoke<SttOutcome>("stt_stop")
}

export async function sttCancel(): Promise<void> {
  return invoke("stt_cancel")
}
