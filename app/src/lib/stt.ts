// Ditado on-device (sidecar Swift): start abre o mic, stop devolve o texto.
import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

/** Desfecho do stop. `text` SEMPRE traz a fala (nenhum caminho perde texto);
 *  `warn` só existe quando o sidecar degradou — ex.: a passada sobre o arquivo
 *  de áudio falhou e o texto veio do reconhecimento ao vivo. */
export type SttOutcome = { text: string; warn: string | null }

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
): Promise<void> {
  return invoke("stt_start", { vocab, device })
}

export async function sttStop(): Promise<SttOutcome> {
  return invoke<SttOutcome>("stt_stop")
}

export async function sttCancel(): Promise<void> {
  return invoke("stt_cancel")
}
