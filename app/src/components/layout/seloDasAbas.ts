// Segurar ⌘ (Ctrl no Linux) mostra o número de cada aba, o mesmo do ⌘1–9.
// A espera curta evita piscar no ⌘C, ⌘V e em qualquer atalho que passa
// pelo modificador; outra tecla, soltar ou perder o foco escondem.

import { useSyncExternalStore } from "react"
import { ehSoOModificador, type TeclaDoAtalho } from "@/components/layout/atalhosDasAbas"

export const ESPERA_DO_SELO_MS = 350

let visivel = false
const ouvintes = new Set<() => void>()

function mudar(v: boolean) {
  if (v === visivel) return
  visivel = v
  for (const o of ouvintes) o()
}

export function useSeloDasAbas(): boolean {
  return useSyncExternalStore(
    (cb) => {
      ouvintes.add(cb)
      return () => ouvintes.delete(cb)
    },
    () => visivel,
    () => false,
  )
}

/** O selo que a tecla leva: 1 é a Conversa, 2 a 9 as abas abertas. */
export function numeroDoSelo(indiceDaAberta: number): number | null {
  const n = indiceDaAberta + 2
  return n <= 9 ? n : null
}

/** Liga o "segurar mostra". Quem chama é o teclado das abas, que já decide
 *  quando há diálogo na frente. Devolve o desligar. */
export function ligarSeloDasAbas(
  plataforma: string,
  bloqueado: () => boolean,
  alvo: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const esconder = () => {
    if (timer) clearTimeout(timer)
    timer = null
    mudar(false)
  }
  const aoDescer = (e: Event) => {
    const tecla = e as unknown as TeclaDoAtalho & { repeat?: boolean }
    if (!ehSoOModificador(tecla, plataforma) || bloqueado()) return esconder()
    if (tecla.repeat || timer || visivel) return
    timer = setTimeout(() => {
      timer = null
      mudar(true)
    }, ESPERA_DO_SELO_MS)
  }
  alvo.addEventListener("keydown", aoDescer)
  alvo.addEventListener("keyup", esconder)
  alvo.addEventListener("blur", esconder)
  return () => {
    esconder()
    alvo.removeEventListener("keydown", aoDescer)
    alvo.removeEventListener("keyup", esconder)
    alvo.removeEventListener("blur", esconder)
  }
}
