// A janela separada do navegador do projeto (`browser.html`). Deixou de ser o
// caminho padrão: o navegador mora na aba principal (navegador PRD R1). Esta
// janela segue existindo como contêiner da MESMA vista; o projeto vem do rótulo
// da janela (`browser_panel_context`).

import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Globe, Loader2 } from "lucide-react"
import { NavegadorVista } from "./NavegadorVista"
import { useNavegadorDoProjeto, type AlvoDoNavegador } from "./useNavegadorDoProjeto"

export function BrowserPanel() {
  const [alvo, setAlvo] = useState<AlvoDoNavegador | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const nav = useNavegadorDoProjeto(alvo)

  useEffect(() => {
    void invoke<AlvoDoNavegador>("browser_panel_context")
      .then(setAlvo)
      .catch((cause) => setErro(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  if (!alvo) {
    return (
      <main className="grid h-screen place-items-center bg-background text-foreground">
        <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
          {erro ?? (
            <>
              <Loader2 className="size-4 animate-spin" /> Preparando o painel
            </>
          )}
        </span>
      </main>
    )
  }

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header
        data-tauri-drag-region
        className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4"
      >
        <Globe className="size-4 text-muted-foreground" />
        <div className="min-w-0">
          <h1 className="truncate text-[13px] font-semibold">Navegador do projeto</h1>
          <p className="truncate text-[11px] text-muted-foreground">{alvo.projectPath}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <NavegadorVista nav={nav} />
      </div>
    </main>
  )
}
