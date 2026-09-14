/** Visões globais em Geral, na ordem do mock aprovado (ADR-187). */
export const GLOBAL_NAVIGATION = [
  { id: "painel", label: "Painel", desc: "Retrospectiva de custos e entregas" },
  {
    id: "fleet",
    label: "Frota",
    desc: "Trabalho em execução em todos os projetos",
  },
  {
    id: "scheduled",
    label: "Agendamentos",
    desc: "Tarefas agendadas de todos os projetos",
  },
  {
    id: "flightPlans",
    label: "Planos de voo",
    desc: "Planos reutilizáveis de missão",
  },
] as const
