// O chrome das Configurações é UM só (ADR-202): a barra fixa no topo do
// painel, com título, escopo, ações e o X, pertence ao SettingsDialog. Cada
// seção só entrega o conteúdo e, pelo `SectionHeader`, o que vai na barra.
//
// Mecanismo: portal, não estado. A seção renderiza título/escopo/ação DENTRO
// do slot da barra via `createPortal`, então os botões continuam com as
// closures da própria seção e nada precisa subir por store. O provider só
// sabe duas coisas: onde fica o slot e se alguma seção o está ocupando (para
// a barra mostrar o título do registro quando a seção não desenha cabeçalho).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

interface ChromeSlot {
  /** Elemento da barra onde o `SectionHeader` monta o portal. */
  alvo: HTMLElement | null
  /** A seção atual publicou cabeçalho? (mount/unmount, nunca por render) */
  ocupar: (on: boolean) => void
}

const ChromeContext = createContext<ChromeSlot | null>(null)

export function useChromeSlot(): ChromeSlot | null {
  return useContext(ChromeContext)
}

/** Estado do slot para o SettingsDialog: o `ref` a pendurar na barra e se
 *  há seção ocupando. */
export function useSettingsChrome() {
  const [alvo, setAlvo] = useState<HTMLElement | null>(null)
  const [ocupado, setOcupado] = useState(0)
  const ocupar = useCallback((on: boolean) => {
    setOcupado((n) => Math.max(0, n + (on ? 1 : -1)))
  }, [])
  const slot = useMemo<ChromeSlot>(() => ({ alvo, ocupar }), [alvo, ocupar])
  return { slot, setAlvo, ocupado: ocupado > 0 }
}

export function SettingsChromeProvider({
  slot,
  children,
}: {
  slot: ChromeSlot
  children: ReactNode
}) {
  return <ChromeContext.Provider value={slot}>{children}</ChromeContext.Provider>
}
