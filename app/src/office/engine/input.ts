/** Roteamento de teclado do office (§5 do design doc).
 *
 *  Regras duras:
 *  - keydown vindo de input/textarea/contentEditable NUNCA entra (o dono da
 *    checagem é o handler `isTextTarget`, injetado pela ui).
 *  - Tab sempre segue a navegação de foco; R cicla salas.
 *  - Esc é delegado a `onEscape` (o coordenador de prioridade vive na ui).
 *  - blur limpa as teclas (nada de boss andando sozinho ao trocar de janela).
 *  - Este módulo só ESCREVE em world.input.keys e chama handlers; cliques
 *    ficam com a cena (hit-test) e zoom por wheel fica com a cena/ui.
 */
import type { World } from "@/lib/fleet/types"

export type InputHandlers = {
  isTextTarget(e: KeyboardEvent): boolean
  /** Office visível? O App mantém o office MONTADO (hidden) ao trocar de modo
   *  e o attachInput continua vivo — oculto, NENHUMA tecla é consumida (sem
   *  preventDefault: Tab/setas seguem os outros modos). Ausente = sempre ativo. */
  isActive?(): boolean
  onEscape(): void
  onInteract(): void
  onCycleRoom(): void
}

/** Teclas de movimento aceitas em world.input.keys (normalizadas minúsculas). */
const MOVE_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"])

export function attachInput(target: Window, world: World, handlers: InputHandlers): () => void {
  const keys = world.input.keys

  const onKeyDown = (e: KeyboardEvent) => {
    // Office oculto (montado + hidden): o teclado é dos OUTROS modos.
    if (handlers.isActive && !handlers.isActive()) return
    // Campo de texto digitando (composer do dock etc.): nada entra no jogo.
    if (handlers.isTextTarget(e)) return

    const key = e.key.toLowerCase()

    if (key === "escape") {
      handlers.onEscape()
      return
    }
    if (key === "tab") return
    if (e.metaKey || e.ctrlKey || e.altKey) return // atalhos do app (⌘K, ⌘R etc.)
    if (key === "r") {
      if (!e.repeat) handlers.onCycleRoom()
      return
    }
    if (key === "e") {
      if (!e.repeat) handlers.onInteract()
      return
    }
    if (MOVE_KEYS.has(key)) {
      e.preventDefault() // setas rolariam a página
      keys.add(key)
    }
  }

  const onKeyUp = (e: KeyboardEvent) => {
    // Sempre limpa: o keydown pode ter ocorrido antes do foco cair num campo.
    keys.delete(e.key.toLowerCase())
  }

  const onBlur = () => {
    keys.clear()
  }

  target.addEventListener("keydown", onKeyDown)
  target.addEventListener("keyup", onKeyUp)
  target.addEventListener("blur", onBlur)
  return () => {
    target.removeEventListener("keydown", onKeyDown)
    target.removeEventListener("keyup", onKeyUp)
    target.removeEventListener("blur", onBlur)
    keys.clear()
  }
}
