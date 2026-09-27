// O projeto da zona "No projeto" das Configurações (ADR-268). Um seletor só,
// no rail, e todas as seções do projeto leem o MESMO projeto. Antes MCPs,
// Navegador e Skills tinham cada uma o seu seletor, com o seu estado: trocar
// o projeto em MCPs e ir para Skills voltava ao projeto ativo, em silêncio.
//
// Escopo do PAINEL, nunca do app: escolher aqui não muda o projeto ativo da
// barra lateral. Sem escolha, vale o projeto ativo.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { initialMcpProjectId } from "@/lib/mcp"
import type { Project } from "@/lib/types"
import { useApp } from "@/store/app"

export interface ProjetoDasConfiguracoes {
  project: Project | null
  projects: Project[]
  escolher: (id: string) => void
}

const Contexto = createContext<ProjetoDasConfiguracoes | null>(null)

/** O estado do projeto escolhido. O SettingsDialog é o dono; fora dele (teste,
 *  seção montada sozinha) cada seção cai neste mesmo cálculo. */
export function useProjetoEscolhido(): ProjetoDasConfiguracoes {
  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const [escolhido, setEscolhido] = useState<string | null>(null)
  const project = useMemo(() => {
    const id =
      escolhido && projects.some((p) => p.id === escolhido)
        ? escolhido
        : initialMcpProjectId(projects, activeProjectId)
    return projects.find((p) => p.id === id) ?? null
  }, [activeProjectId, projects, escolhido])
  return useMemo(() => ({ project, projects, escolher: setEscolhido }), [project, projects])
}

export function ProjetoDasConfiguracoesProvider({
  valor,
  children,
}: {
  valor: ProjetoDasConfiguracoes
  children: ReactNode
}) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

/** O projeto que as seções da zona "No projeto" mostram. */
export function useProjetoDasConfiguracoes(): ProjetoDasConfiguracoes {
  const doDialog = useContext(Contexto)
  const proprio = useProjetoEscolhido()
  return doDialog ?? proprio
}

/** O escopo na barra da seção: diz de qual projeto é o que está na tela. Só
 *  leitura de propósito; quem troca é o seletor do rail. */
export function EscopoDoProjeto({ nome }: { nome: string }) {
  return (
    <span
      className="max-w-48 truncate rounded-full border px-2 text-[11px] leading-5 font-medium text-muted-foreground"
      title="Troque o projeto no seletor do rail, em No projeto"
    >
      Projeto {nome}
    </span>
  )
}
