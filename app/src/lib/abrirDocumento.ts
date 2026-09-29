// "Abrir no app padrão" pela porta que só abre documento (ADR-286). O motivo
// da recusa (executável, tipo que roda código) volta do Rust em pt-BR.

import { invoke } from "@tauri-apps/api/core"

export function abrirDocumento(path: string): Promise<void> {
  return invoke<void>("abrir_documento", { path })
}
