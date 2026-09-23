// Escuta do encerramento (ADR-235). Mora no BOOT da janela, como a dos eventos
// de trabalho: a saída pode começar com qualquer tela montada, ou nenhuma.

import { listen } from "@tauri-apps/api/event"
import { isTauri } from "@/lib/db"
import { useEncerramento, type ItemDoEncerramento } from "@/store/encerramento"

let iniciada = false

export function iniciarTelaDeEncerramento(): void {
  if (iniciada || !isTauri()) return
  iniciada = true
  const falhou = (erro: unknown) => {
    iniciada = false
    console.error("[encerramento] não consegui ligar a escuta:", erro)
  }
  listen<Omit<ItemDoEncerramento, "estado">[]>("quit://encerrando", (e) =>
    useEncerramento.getState().comecar(e.payload),
  ).catch(falhou)
  listen<{ id: string; estado: "encerrado" | "forcado" }>("quit://item", (e) =>
    useEncerramento.getState().marcar(e.payload.id, e.payload.estado),
  ).catch(falhou)
  listen("quit://pronto", () => useEncerramento.getState().concluir()).catch(falhou)
}
