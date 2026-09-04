import { error as persistError, info as persistInfo } from "@tauri-apps/plugin-log"

function stringify(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`
  }
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function formatRuntimeLog(values: unknown[]): string {
  return values.map(stringify).join(" ")
}

let installed = false

/**
 * Persiste falhas fatais do frontend no Frota.log. A instalação acontece antes
 * do primeiro render e só no runtime Tauri; o preview do navegador permanece
 * sem efeitos nativos.
 */
export function installRuntimeLogging(): void {
  if (installed || !("__TAURI_INTERNALS__" in window)) return
  installed = true

  const originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)
  const reportFailure = (reason: unknown) =>
    originalWarn("[runtime-log] não consegui persistir o erro", reason)
  const persist = (message: string) => {
    void persistError(message).catch(reportFailure)
  }

  console.error = (...values: unknown[]) => {
    originalError(...values)
    persist(formatRuntimeLog(values))
  }

  window.addEventListener("error", (event) => {
    persist(
      formatRuntimeLog([
        "[window.error]",
        event.message,
        event.filename && `${event.filename}:${event.lineno}:${event.colno}`,
        event.error,
      ]),
    )
  })
  window.addEventListener("unhandledrejection", (event) => {
    persist(formatRuntimeLog(["[unhandledrejection]", event.reason]))
  })

  void persistInfo("frontend: observabilidade inicializada").catch(reportFailure)
}
