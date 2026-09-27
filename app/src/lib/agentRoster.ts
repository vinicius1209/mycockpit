// SELETORES do registry: "quais motores têm a capability X". Extraídos de
// `lib/agents.ts` quando a catraca de tamanho cobrou a divisão (STYLEGUIDE §10:
// se a guarda disparar, DIVIDA o arquivo, nunca suba o teto).
//
// A regra de casa continua valendo inteira: nenhum código genérico escreve
// ["claude-code", "codex", …] no meio da lógica — pergunta aqui, e motor novo
// aparece sozinho quando entra no registry. `AGENTS`/`AgentDef` continuam sendo
// a fonte única; este arquivo só filtra.

import { AGENTS, type AgentDef } from "@/lib/agents"

/** Motores cujo usage de fim de turno vem ACUMULADO da thread (ADR-033). Quem
 *  precisa falar desses motores na UI (a manutenção "recalcular custo
 *  estimado") pergunta AQUI em vez de escrever "codex" no meio do código. */
export function cumulativeUsageAgents(): AgentDef[] {
  return AGENTS.filter((a) => a.cumulativeUsage)
}

/** Motores que REPORTAM custo em USD no fim do turno. A correção do custo
 *  acumulado da sessão (ADR-226) só olha para eles: quem não reporta, estima
 *  pelo preço e nunca teve o problema. */
export function reportedCostAgents(): AgentDef[] {
  return AGENTS.filter((a) => a.reportsCost)
}

/** Motores com fonte de JANELA DE USO (medidor de rate limit). Quem monta a
 *  pill/popover/Configurações do medidor pergunta AQUI, nunca por nome — motor
 *  sem fonte nem aparece (1ª camada de esconder do Orca). */
export function usageWindowAgents(): AgentDef[] {
  return AGENTS.filter((a) => a.usageWindow != null)
}

/** Motores com hooks de ciclo de vida instaláveis (hooks-plan H1). Quem monta
 *  o bloco de Configurações e as superfícies de sessão externa pergunta AQUI,
 *  nunca por nome — motor sem hooks nem aparece (degradação honesta pro
 *  watchdog, que continua existindo pra todos). */
export function hooksAgents(): AgentDef[] {
  return AGENTS.filter((a) => a.hooksStatus)
}

/** Motores que sabem dizer AGORA quais modelos conhecem (M1 do
 *  model-autonomy-plan). Quem quiser conferir um slug contra o CLI pergunta
 *  AQUI, nunca por nome — motor sem fonte não ganha sonda inventada, continua
 *  no catálogo. */
export function modelListingAgents(): AgentDef[] {
  return AGENTS.filter((a) => a.listsModels != null)
}

/** Motores em que dá pra rodar a FUMAÇA de um candidato (M2). Quem oferecer o
 *  gesto "testar este modelo" pergunta AQUI, nunca por nome — e motor sem
 *  dialeto não ganha botão que não faz nada. */
export function modelSmokeAgents(): AgentDef[] {
  return AGENTS.filter((a) => a.modelSmoke != null)
}

/** Motores que são CLI NA MÁQUINA do usuário: os que o app integra de verdade
 *  (`available`) e que executam como processo local (`kind === "agent"`). Quem
 *  precisa varrer "o estado das ferramentas desta máquina" (a saúde no sino, a
 *  Frota do Painel) pergunta AQUI, nunca escrevendo ["claude-code", "codex", …]
 *  no meio do código: motor novo entra no registry e aparece sozinho, e motor
 *  `available: false` não gera item de saúde pra uma CLI que o app não dirige. */
export function machineAgents(): AgentDef[] {
  return AGENTS.filter((a) => a.kind === "agent" && a.available)
}

/** Os motores que a pessoa pode usar nesta build, na ordem do registry. Cada
 *  um ganha uma página própria nas Configurações (ADR-268): quem monta o rail
 *  pergunta AQUI, e motor novo aparece sozinho quando entra no registry. */
export function motoresDaMaquina(): AgentDef[] {
  return AGENTS.filter((a) => a.kind === "agent" && a.available)
}
