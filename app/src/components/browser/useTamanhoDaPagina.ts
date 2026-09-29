// O tamanho da página do projeto na tela: lê ao abrir, segue o evento do Rust
// (a troca pode vir do agente, pela `browser_resize`) e pede a troca pelo
// seletor. O valor mostrado é sempre o que o Rust confirmou.

import { useCallback, useEffect, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { avisar } from "@/lib/avisos"
import { isTauri } from "@/lib/db"
import {
  TAMANHO_PADRAO,
  definirTamanho,
  lerTamanho,
  type TamanhoDaPagina,
} from "@/lib/tamanhoDaPagina"

export interface TamanhoNaTela {
  tamanho: TamanhoDaPagina
  trocando: boolean
  trocar: (t: TamanhoDaPagina) => void
}

export function useTamanhoDaPagina(projectPath: string): TamanhoNaTela {
  const [tamanho, setTamanho] = useState<TamanhoDaPagina>(TAMANHO_PADRAO)
  const [trocando, setTrocando] = useState(false)

  useEffect(() => {
    let vivo = true
    lerTamanho(projectPath).then(
      (t) => vivo && setTamanho(t),
      (e: unknown) => console.error("[navegador] não li o tamanho da página", e),
    )
    if (!isTauri()) return () => void (vivo = false)
    const desligar = listen<{ projectPath: string; tamanho: TamanhoDaPagina }>("browser://tamanho", (e) => {
      if (vivo && e.payload.projectPath === projectPath) setTamanho(e.payload.tamanho)
    })
    return () => {
      vivo = false
      void desligar.then((un) => un())
    }
  }, [projectPath])

  const trocar = useCallback(
    (t: TamanhoDaPagina) => {
      setTrocando(true)
      definirTamanho(projectPath, t)
        .then(setTamanho, (e: unknown) => avisar.erro(`Não mudei o tamanho da página: ${String(e)}`))
        .finally(() => setTrocando(false))
    },
    [projectPath],
  )

  return { tamanho, trocando, trocar }
}
