// Segurar o sono da máquina enquanto um agente trabalha.
//
// A preferência mora no front (é do usuário), mas quem SEGURA é o Rust — a
// trava é um `caffeinate -i -w <pid>` com relógio de morte próprio, atrelado ao
// mesmo ciclo de vida dos runs. Este módulo só empurra a escolha pra lá.

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

export type KeepAwake = "on" | "agent" | "off"

export const KEEP_AWAKE_OPTIONS: {
  value: KeepAwake
  label: string
  description: string
}[] = [
  {
    value: "agent",
    label: "Com agente",
    description: "Só enquanto um turno está rodando",
  },
  { value: "on", label: "Sempre", description: "Enquanto o app estiver aberto" },
  { value: "off", label: "Nunca", description: "A máquina dorme como sempre" },
]

/** Empurra a preferência pro Rust. Falha em silêncio de propósito: não segurar
 *  o sono é degradação, não erro — o app segue igual, e um toast por boot seria
 *  ruído sobre algo que o usuário não pode consertar daqui. */
export async function aplicarKeepAwake(modo: KeepAwake): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke("set_keep_awake", { modo })
  } catch {
    /* degrada: a máquina dorme como antes */
  }
}
