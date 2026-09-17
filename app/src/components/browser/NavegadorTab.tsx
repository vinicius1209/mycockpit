// A aba "Navegador" do painel principal (navegador PRD R1): o navegador do
// projeto ativo, visto e pilotado sem janela do sistema.
//
// Contêiner fino: resolve o projeto e o estado REAL do Chromium (o mesmo hook
// de Configurações). A vista ao vivo só monta com sessão ligada, e desmontar a
// aba para o screencast; desligado, a aba oferece ligar sem janela (ADR-131).

import { useMemo } from "react"
import { Globe, Loader2, PictureInPicture2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProjectBrowser } from "@/components/settings/ProjectBrowserCard"
import { isTauri } from "@/lib/db"
import { useApp } from "@/store/app"
import { useNavegadorFlutuante } from "@/store/navegadorFlutuante"
import { NavegadorVista } from "./NavegadorVista"
import { useNavegadorDoProjeto, type AlvoDoNavegador } from "./useNavegadorDoProjeto"

export function NavegadorAoVivo({
  alvo,
  acoes,
}: {
  alvo: AlvoDoNavegador
  acoes?: React.ReactNode
}) {
  const nav = useNavegadorDoProjeto(alvo)
  return <NavegadorVista nav={nav} acoes={acoes} />
}

export function NavegadorTab() {
  const project = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null)
  const { status, busy, toggle } = useProjectBrowser(project?.path ?? null)
  // Chaves primitivas: o status é reconsultado a cada evento e chega como
  // objeto novo; o alvo só muda quando muda a sessão de verdade.
  const sessionId = status?.session?.projectId ?? null
  const sessionPath = status?.session?.projectPath ?? null
  const alvo = useMemo<AlvoDoNavegador | null>(
    () => (sessionId && sessionPath ? { projectId: sessionId, projectPath: sessionPath } : null),
    [sessionId, sessionPath],
  )

  if (alvo) {
    return (
      <NavegadorAoVivo
        alvo={alvo}
        acoes={
          <Button
            type="button"
            size="icone-compacto"
            variant="ghost"
            aria-label="Flutuar sobre a conversa"
            title="Flutuar sobre a conversa"
            onClick={() => {
              useNavegadorFlutuante.getState().flutuar(alvo.projectId)
              useApp.getState().closeMainTab()
            }}
          >
            <PictureInPicture2 />
          </Button>
        }
      />
    )
  }

  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="max-w-sm">
        <Globe className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-2 text-[13px] font-medium">
          {!project
            ? "Nenhum projeto selecionado"
            : !isTauri()
              ? "O navegador do projeto só existe dentro do app"
              : !status
              ? "Consultando o navegador do projeto"
              : "Navegador do projeto desligado"}
        </p>
        {project && status && (
          <>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              {status.binary
                ? "A Frota liga um Chromium isolado deste projeto, sem abrir janela. Você acompanha e pilota por aqui."
                : (status.detail ?? "Nenhum Chromium encontrado nesta máquina.")}
            </p>
            <Button
              size="compacto"
              className="mt-3"
              disabled={busy || !status.binary}
              onClick={() => void toggle(true)}
            >
              {busy && <Loader2 className="animate-spin" />}
              Ligar navegador
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
