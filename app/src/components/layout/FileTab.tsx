import { Columns2, Maximize2, X } from "lucide-react"
import { ProjectFileViewer } from "@/components/layout/ProjectFileViewer"
import {
  abrirAoLado,
  fecharArquivos,
  fecharOLado,
  trazerParaATira,
} from "@/components/layout/abasNoPrincipal"
import { useRaizEfetiva } from "@/components/layout/raizEfetiva"
import { Button } from "@/components/ui/button"
import { useAbasDeArquivo } from "@/store/abasDeArquivo"
import { useChat } from "@/store/chat"

/** Resolve a raiz efetiva da conversa e entrega o palco ao arquivo: largo,
 *  como aba, ou ao lado da conversa (`aoLado`, ADR-243). */
export function FileTab({ path, aoLado = false }: { path: string; aoLado?: boolean }) {
  const raiz = useRaizEfetiva()
  const ladoCabe = useAbasDeArquivo((s) => s.ladoCabe)
  const convId = useChat((state) => state.activeId)

  if (!raiz) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-muted-foreground">
        Nenhum projeto selecionado.
      </div>
    )
  }

  const acoes = aoLado ? (
    <>
      <Button variant="ghost" size="icone-compacto" onClick={() => trazerParaATira(path)} title="Abrir sozinho, como aba" aria-label="Abrir sozinho, como aba">
        <Maximize2 className="size-3.5" />
      </Button>
      <Button variant="ghost" size="icone-compacto" onClick={fecharOLado} title="Tirar do lado da conversa" aria-label="Tirar do lado da conversa">
        <X className="size-3.5" />
      </Button>
    </>
  ) : ladoCabe ? (
    <Button variant="ghost" size="icone-compacto" onClick={() => abrirAoLado(path)} title="Abrir ao lado da conversa" aria-label="Abrir ao lado da conversa">
      <Columns2 className="size-3.5" />
    </Button>
  ) : null

  return (
    <ProjectFileViewer
      root={raiz}
      path={path}
      convId={convId}
      acoes={acoes}
      onSumiu={(sumiu) => {
        if (convId) useAbasDeArquivo.getState().marcarSumido(convId, path, sumiu)
      }}
      aoFecharSumido={() => fecharArquivos([path])}
    />
  )
}
