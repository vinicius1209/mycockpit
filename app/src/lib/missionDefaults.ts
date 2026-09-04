import type {
  MissionPhaseDef,
  MissionPlanEdge,
  MissionPlanNode,
  MissionPreset,
} from "@/lib/missionTypes"

const FACTORY_REVISION = 4
const QUALITY_LOOP_LIMIT = 30

const PLAN_INSTRUCTIONS =
  "Leia as instruções do repositório e inspecione o estado real antes de planejar. " +
  "Transforme o pedido numa matriz verificável de aceitação: comportamento, regressões, " +
  "erros, segurança e, quando houver interface visível, estados e viewports que precisam " +
  "ser comparados por screenshot. Não implemente nesta fase e não reduza requisitos vagos: " +
  "torne explícito o que significa ficar 100% fiel ao pedido."

const BUILD_INSTRUCTIONS =
  "Implemente o plano inteiro no worktree, preservando mudanças alheias. Rode os testes " +
  "focais enquanto trabalha. Quando houver interface visível, abra a superfície real e " +
  "faça uma primeira inspeção visual; não trate build verde como prova de qualidade visual."

const VERIFY_INSTRUCTIONS =
  "Você é a verificação independente. Inspecione o diff e rode de verdade as checagens " +
  "proporcionais ao risco: testes focais e de regressão, lint, tipos e build quando existirem. " +
  "Se houver interface visível, abra a superfície real, exerça os estados relevantes e salve " +
  "screenshots reproduzíveis junto dos artefatos da missão; compare com a referência ou com " +
  "a versão anterior no mesmo ambiente. Não confie apenas no relato do executor. Responda " +
  "APROVADO somente se tudo passar. Em qualquer falha, comece com REPROVADO, nunca escreva " +
  "a palavra de aprovação e entregue uma lista acionável para a correção."

const FIX_INSTRUCTIONS =
  "Leia o feedback mais recente dos reviewers e corrija todos os itens reprovados, sem " +
  "apagar trabalho válido. Reproduza cada falha antes de alterar, adicione cobertura contra " +
  "regressão quando couber e atualize as screenshots se a interface mudou de propósito. " +
  "Não encerre por conta própria: a saída desta fase sempre volta à verificação independente."

const JUDGE_INSTRUCTIONS =
  "Você é o juiz final e independente. Reabra o resultado, inspecione o diff e confronte " +
  "cada item da matriz de aceitação com evidência concreta. Reexecute amostras críticas dos " +
  "testes. Se houver interface visível, produza screenshots frescas dos estados e viewports " +
  "relevantes, olhe as imagens e compare-as com a referência; avalie fidelidade, hierarquia, " +
  "legibilidade, estados vazio/erro/loading e regressões. Não aceite checklist narrado sem " +
  "prova. Só responda APROVADO quando todos os critérios estiverem satisfeitos, sem ressalvas " +
  "nem pendências. Caso contrário, comece com REPROVADO, nunca escreva a palavra de aprovação " +
  "e descreva exatamente o que a próxima rodada deve corrigir."

function qualityLoopWorkflow(base: MissionPreset): MissionPreset {
  const nodes: MissionPlanNode[] = base.phases.map((phase, index) => ({
    id: `node-${phase.id}`,
    phaseId: phase.id,
    position:
      phase.id === "fix"
        ? { x: 560, y: 284 }
        : { x: index * 224, y: 92 },
  }))
  const edge = (
    id: string,
    source: string,
    target: string,
    condition: MissionPlanEdge["condition"],
    label?: string,
    limited = false,
  ): MissionPlanEdge => ({
    id,
    source: `node-${source}`,
    target: `node-${target}`,
    condition,
    ...(label ? { label } : {}),
    ...(limited ? { maxTraversals: QUALITY_LOOP_LIMIT } : {}),
  })

  return {
    ...base,
    revision: FACTORY_REVISION,
    factoryRevision: FACTORY_REVISION,
    mode: "graph",
    gatePolicy: "nunca",
    graph: {
      version: 1,
      entryNodeId: "node-plan",
      nodes,
      edges: [
        edge("edge-plan-build", "plan", "build", "success"),
        edge("edge-build-verify", "build", "verify", "success"),
        edge("edge-verify-judge", "verify", "judge", "success", "Verificado", true),
        edge("edge-verify-fix", "verify", "fix", "failure", "Falhou nos testes", true),
        edge("edge-judge-fix", "judge", "fix", "failure", "Ainda não está 100%", true),
        edge("edge-fix-verify", "fix", "verify", "success", "Corrigido", true),
      ],
    },
  }
}

function phase(input: MissionPhaseDef): MissionPhaseDef {
  return { ...input, autonomy: "auto" }
}

export const DEFAULT_MISSION_PRESETS: MissionPreset[] = [
  qualityLoopWorkflow({
    id: "feature",
    name: "Feature completa",
    description:
      "Planeja, implementa, testa e repete correção + julgamento até aprovação integral.",
    maxCostUsd: null,
    phases: [
      phase({
        id: "plan", label: "Definir régua", persona: "planner",
        agent: "claude-code", model: "claude-opus-5[1m]", effort: "max", maxRetries: 1,
        instructions: PLAN_INSTRUCTIONS,
        exitCriteria: [
          "Todos os requisitos do pedido aparecem numa matriz objetiva de aceitação.",
          "Riscos, regressões prováveis e comandos de verificação foram identificados.",
          "Mudanças visíveis têm referências, estados e viewports definidos para screenshots.",
        ],
      }),
      phase({
        id: "build", label: "Implementar", persona: "executor",
        agent: "codex", model: "gpt-5.6-sol", effort: "xhigh", maxRetries: 2,
        instructions: BUILD_INSTRUCTIONS,
        entryCriteria: ["A matriz de aceitação e as restrições do repositório estão claras."],
        exitCriteria: [
          "A implementação cobre a matriz de aceitação sem deixar TODOs ou mocks enganosos.",
          "Testes focais relevantes foram executados durante a implementação.",
          "Mudanças visíveis foram abertas e inspecionadas no ambiente real.",
        ],
      }),
      phase({
        id: "verify", label: "Testar e capturar", persona: "reviewer",
        agent: "agy", model: "gemini-3.1-pro-high", effort: null, maxRetries: 1,
        instructions: VERIFY_INSTRUCTIONS,
        exitCriteria: [
          "Os comandos executados e seus resultados reais estão registrados no handoff.",
          "A cobertura inclui o comportamento novo e regressões plausíveis do entorno.",
          "Toda mudança visível possui screenshots dos estados relevantes, ou uma justificativa objetiva de não aplicabilidade.",
        ],
      }),
      phase({
        id: "judge", label: "Julgar 100%", persona: "reviewer",
        agent: "claude-code", model: "claude-opus-5[1m]", effort: "max", maxRetries: 1,
        instructions: JUDGE_INSTRUCTIONS,
        entryCriteria: ["A verificação independente aprovou testes e evidências da rodada atual."],
        exitCriteria: [
          "Cada item da matriz de aceitação tem evidência concreta e atual.",
          "Não existem ressalvas, perguntas abertas, testes ignorados ou regressões conhecidas.",
          "Quando há UI, screenshots frescas foram abertas e julgadas, não apenas geradas.",
        ],
      }),
      phase({
        id: "fix", label: "Corrigir", persona: "executor",
        agent: "codex", model: "gpt-5.6-sol", effort: "xhigh", maxRetries: 2,
        instructions: FIX_INSTRUCTIONS,
        entryCriteria: ["Existe feedback de reprovação concreto da verificação ou do juiz."],
        exitCriteria: [
          "Todos os pontos da reprovação mais recente foram corrigidos e rechecados localmente.",
          "A correção preserva os critérios que já estavam aprovados nas rodadas anteriores.",
        ],
      }),
    ],
  }),
  qualityLoopWorkflow({
    id: "ui-first",
    name: "UI-first",
    description:
      "Fluxo visual rigoroso com comparação por screenshots e juiz independente.",
    maxCostUsd: null,
    phases: [
      phase({
        id: "plan", label: "Definir referência", persona: "planner",
        agent: "claude-code", model: "claude-opus-5[1m]", effort: "max", maxRetries: 1,
        instructions:
          PLAN_INSTRUCTIONS + " A versão atual é a régua mínima: descreva composição, hierarquia e prova visual que não podem piorar.",
        exitCriteria: [
          "O plano nomeia o que a versão atual acerta e não pode regredir.",
          "Cada estado visível e viewport relevante tem uma referência de comparação.",
          "A primeira dobra e a principal prova visual do produto estão explicitamente definidas.",
        ],
      }),
      phase({
        id: "build", label: "Implementar UI", persona: "executor",
        agent: "agy", model: "gemini-3.1-pro-high", effort: null, maxRetries: 2,
        instructions:
          BUILD_INSTRUCTIONS + " Interface é composição, não lista de seções. Preserve a linguagem visual existente, a prova visual do produto na primeira dobra e valide interação por interação.",
        exitCriteria: [
          "A interface implementada mantém ou melhora a composição e a hierarquia da referência.",
          "Estados principal, vazio, loading, erro e responsivo aplicáveis foram exercitados.",
          "A superfície foi aberta e inspecionada, não inferida apenas pelo código.",
        ],
      }),
      phase({
        id: "verify", label: "Testar e capturar", persona: "reviewer",
        agent: "codex", model: "gpt-5.6-sol", effort: "xhigh", maxRetries: 1,
        instructions: VERIFY_INSTRUCTIONS,
        exitCriteria: [
          "Testes funcionais, acessibilidade básica, tipos, lint e build aplicáveis passaram.",
          "Screenshots reproduzíveis cobrem os estados e viewports definidos pelo plano.",
          "A comparação com a referência está descrita com diferenças concretas, não gosto genérico.",
        ],
      }),
      phase({
        id: "judge", label: "Julgar fidelidade", persona: "reviewer",
        agent: "claude-code", model: "claude-opus-5[1m]", effort: "max", maxRetries: 1,
        instructions: JUDGE_INSTRUCTIONS,
        exitCriteria: [
          "As screenshots atuais foram abertas e comparadas lado a lado com a referência.",
          "A primeira dobra preserva a prova visual do produto definida no plano.",
          "Não há regressão de composição, hierarquia, legibilidade, interação ou responsividade.",
          "A entrega está fiel ao pedido inteiro e não possui ressalvas conhecidas.",
        ],
      }),
      phase({
        id: "fix", label: "Corrigir UI", persona: "executor",
        agent: "agy", model: "gemini-3.1-pro-high", effort: null, maxRetries: 2,
        instructions: FIX_INSTRUCTIONS,
        exitCriteria: [
          "Cada diferença visual ou funcional reprovada foi reproduzida e corrigida.",
          "Novas screenshots demonstram a correção sem regredir estados já aprovados.",
        ],
      }),
    ],
  }),
  qualityLoopWorkflow({
    id: "barato",
    name: "Econômico",
    description:
      "Mesma disciplina de qualidade com modelos econômicos e teto de US$ 5 para tarefas pequenas.",
    maxCostUsd: 5,
    phases: [
      phase({
        id: "plan", label: "Definir régua", persona: "planner",
        agent: "claude-code", model: "claude-sonnet-5[1m]", effort: "high", maxRetries: 1,
        instructions: PLAN_INSTRUCTIONS,
        exitCriteria: ["O pedido foi convertido em critérios verificáveis e proporcionais ao escopo."],
      }),
      phase({
        id: "build", label: "Implementar", persona: "executor",
        agent: "codex", model: "gpt-5.6-terra", effort: "high", maxRetries: 2,
        instructions: BUILD_INSTRUCTIONS,
        exitCriteria: ["A implementação e os testes focais cobrem todos os critérios definidos."],
      }),
      phase({
        id: "verify", label: "Testar e capturar", persona: "reviewer",
        agent: "agy", model: "gemini-3.6-flash-medium", effort: null, maxRetries: 1,
        instructions: VERIFY_INSTRUCTIONS,
        exitCriteria: ["Testes reais e evidências visuais aplicáveis sustentam o veredito."],
      }),
      phase({
        id: "judge", label: "Julgar", persona: "reviewer",
        agent: "claude-code", model: "claude-sonnet-5[1m]", effort: "high", maxRetries: 1,
        instructions: JUDGE_INSTRUCTIONS,
        exitCriteria: ["Todos os critérios têm evidência e não restam ressalvas conhecidas."],
      }),
      phase({
        id: "fix", label: "Corrigir", persona: "executor",
        agent: "codex", model: "gpt-5.6-terra", effort: "high", maxRetries: 2,
        instructions: FIX_INSTRUCTIONS,
        exitCriteria: ["A reprovação mais recente foi integralmente corrigida e rechecada."],
      }),
    ],
  }),
]
