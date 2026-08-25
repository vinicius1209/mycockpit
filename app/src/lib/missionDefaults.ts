import type {
  MissionPhaseDef,
  MissionPlanEdge,
  MissionPlanNode,
  MissionPreset,
} from "@/lib/missionTypes"

const FACTORY_REVISION = 3

/** Planos de fábrica já desenham o retorno do reviewer. O runtime não inventa
 * `fix-N`: a mesma fase Corrigir pode ser visitada até duas vezes. */
function defaultReviewWorkflow(base: MissionPreset): MissionPreset {
  const reviewer = base.phases.find((phase) => phase.persona === "reviewer")
  const reviewerIndex = base.phases.findIndex(
    (phase) => phase.persona === "reviewer",
  )
  const executor = [...base.phases]
    .reverse()
    .find((phase) => phase.persona === "executor")
  if (!reviewer || !executor) return base
  const correction: MissionPhaseDef = {
    ...executor,
    id: `${executor.id}-fix`,
    label: "Corrigir",
    instructions:
      "A revisão anterior foi reprovada. Corrija exatamente os pontos do handoff do reviewer e preserve o restante.",
  }
  const phases = [...base.phases, correction]
  const nodes: MissionPlanNode[] = phases.map((phase, index) => ({
    id: `node-${phase.id}`,
    phaseId: phase.id,
    position:
      phase.id === correction.id
        ? { x: Math.max(0, reviewerIndex) * 224, y: 284 }
        : { x: index * 224, y: 92 },
  }))
  const mainEdges: MissionPlanEdge[] = base.phases
    .slice(0, -1)
    .map((phase, index) => ({
      id: `edge-node-${phase.id}-node-${base.phases[index + 1].id}`,
      source: `node-${phase.id}`,
      target: `node-${base.phases[index + 1].id}`,
      condition: "success",
    }))
  return {
    ...base,
    revision: FACTORY_REVISION,
    factoryRevision: FACTORY_REVISION,
    mode: "graph",
    phases,
    graph: {
      version: 1,
      entryNodeId: nodes[0]?.id ?? null,
      nodes,
      edges: [
        ...mainEdges,
        {
          id: `edge-node-${reviewer.id}-node-${correction.id}`,
          source: `node-${reviewer.id}`,
          target: `node-${correction.id}`,
          condition: "failure",
          label: "Reprovado",
          maxTraversals: 2,
        },
        {
          id: `edge-node-${correction.id}-node-${reviewer.id}`,
          source: `node-${correction.id}`,
          target: `node-${reviewer.id}`,
          condition: "success",
          label: "Corrigido",
          maxTraversals: 2,
        },
      ],
    },
  }
}

export const DEFAULT_MISSION_PRESETS: MissionPreset[] = [
  defaultReviewWorkflow({
    id: "feature",
    name: "Feature completa",
    maxCostUsd: 25,
    phases: [
      { id: "plan", label: "Planejar", persona: "planner", agent: "claude-code", model: "opus", effort: null, maxRetries: 1 },
      { id: "build", label: "Executar", persona: "executor", agent: "codex", model: null, effort: null, maxRetries: 2 },
      { id: "review", label: "Revisar", persona: "reviewer", agent: "claude-code", model: "opus", effort: null, maxRetries: 1 },
    ],
  }),
  // UI-first (revisão 3): as instruções por fase nasceram da auditoria de uma
  // missão real de landing page (ADR-091). O plano estava certo — decidiu
  // "grande prova visual do produto" — e a entrega saiu sem NENHUMA imagem de
  // produto na dobra. Passou porque o critério do revisor era, literalmente,
  // `lint` + `build` + `git diff --check`: um compilador, não um olho.
  //
  // A persona `reviewer` manda "rode git diff para ver o CÓDIGO real". Num
  // fluxo de UI isso é metade do trabalho, e a outra metade não estava escrita
  // em lugar nenhum. Aqui está.
  defaultReviewWorkflow({
    id: "ui-first",
    name: "UI-first",
    maxCostUsd: 15,
    phases: [
      {
        id: "plan",
        label: "Planejar",
        persona: "planner",
        agent: "claude-code",
        model: "sonnet",
        effort: null,
        maxRetries: 1,
        instructions:
          "Se já existe uma versão da tela, ela é a RÉGUA DE QUALIDADE, não um " +
          "rascunho a superar em quantidade. Antes de planejar, descreva o que a " +
          "versão atual já acerta (composição, hierarquia, prova visual) e diga " +
          "explicitamente o que a nova versão precisa MANTER. Uma variação que " +
          "simplifica a dobra é regressão, não alternativa.",
        exitCriteria: [
          "O plano nomeia o que a versão atual já acerta e que não pode piorar.",
          "O plano diz onde fica a prova visual do produto na primeira dobra.",
        ],
      },
      {
        id: "ui",
        label: "Executar UI",
        persona: "executor",
        agent: "agy",
        model: null,
        effort: null,
        maxRetries: 2,
        instructions:
          "Interface é composição, não lista de seções. A primeira dobra precisa " +
          "de prova visual do produto (captura ou mock do produto funcionando), " +
          "e não só texto centralizado. Se o plano elegeu uma frase como promessa " +
          "central, ela é a headline; não a rebaixe a citação decorativa.",
        exitCriteria: [
          "A primeira dobra tem prova visual do produto, não apenas texto.",
          "A promessa central do plano está na headline, não numa caixa de citação.",
        ],
      },
      {
        id: "review",
        label: "Revisar",
        persona: "reviewer",
        agent: "claude-code",
        model: "sonnet",
        effort: null,
        maxRetries: 1,
        instructions:
          "Em fluxo de UI, `lint` e `build` verdes são o PISO, nunca o critério. " +
          "ABRA o resultado e olhe: suba o servidor local, capture a primeira " +
          "dobra e compare lado a lado com a versão anterior. Reprove se a nova " +
          "estiver pior em composição, hierarquia ou prova visual, mesmo com " +
          "todos os comandos passando. Julgue a entrega contra as DECISÕES do " +
          "planejador, não só contra a lista de passos.",
        exitCriteria: [
          "Você abriu o resultado e olhou a primeira dobra, não só o diff.",
          "Cada decisão de design do planejador foi conferida contra a tela.",
          "Se há versão anterior, a comparação lado a lado está no handoff.",
        ],
      },
    ],
  }),
  defaultReviewWorkflow({
    id: "barato",
    name: "Econômico",
    maxCostUsd: 5,
    phases: [
      { id: "plan", label: "Planejar", persona: "planner", agent: "claude-code", model: "sonnet", effort: null, maxRetries: 1 },
      { id: "build", label: "Executar", persona: "executor", agent: "codex", model: null, effort: null, maxRetries: 1 },
      { id: "review", label: "Revisar", persona: "reviewer", agent: "claude-code", model: "sonnet", effort: null, maxRetries: 1 },
    ],
  }),
]
