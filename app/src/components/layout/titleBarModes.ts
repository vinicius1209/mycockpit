// Superfícies do switcher central da barra do topo. Mora fora do TitleBar.tsx
// porque é dado puro (ordem + rótulo é a arquitetura de informação do produto)
// e dá para travar em teste sem montar React.

export interface BarMode {
  id: "painel" | "linear" | "sdd"
  label: string
  available: boolean
  desc: string
}

export const MODES: readonly BarMode[] = [
  {
    id: "painel",
    label: "Painel",
    available: true,
    desc: "Retrospectiva: onde o dinheiro queimou, por agente e por entrega (consulta, não sessão)",
  },
  {
    id: "linear",
    label: "Trabalho",
    available: true,
    desc: "Fluxo simples com um agente principal",
  },
  {
    id: "sdd",
    label: "Features",
    available: true,
    desc: "Planeje, contrate e entregue uma feature com gates de verificação",
  },
]
