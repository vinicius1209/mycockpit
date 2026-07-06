// Ditado on-device (sidecar Swift): start abre o mic, stop devolve o texto.
import { invoke } from "@tauri-apps/api/core"

export async function sttStart(vocab: string[]): Promise<void> {
  return invoke("stt_start", { vocab })
}

export async function sttStop(): Promise<string> {
  return invoke<string>("stt_stop")
}

export async function sttCancel(): Promise<void> {
  return invoke("stt_cancel")
}
