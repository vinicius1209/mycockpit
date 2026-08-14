// FUMAÇA DE UM TOKEN: o wrapper tipado do M2 (docs/model-autonomy-plan.md).
// A chamada, a classificação e o carimbo vivem no Rust (model_smoke.rs, dialeto
// confinado no enum `ModelSmokeDialect`); aqui só há o contrato do invoke e as
// réguas puras que o consumidor precisa pra NÃO tratar "não sei" como veredito.
//
// GUARDA QUE ESTE ARQUIVO EXISTE PRA SUSTENTAR: a fumaça é a única coisa que
// gasta quota de propósito. Ela roda por GESTO ou AGENDA, nunca em laço nem no
// boot — não há nada aqui assinando ticker, e o Rust ainda recusa uma segunda
// rodada do mesmo motor dentro da janela mínima.

import { invoke } from "@tauri-apps/api/core"
import { agentDef } from "@/lib/agents"

/** Desfecho da fumaça (espelho de `SmokeOutcome`, vocabulário do plano). */
export type SmokeOutcome =
  | "ok"
  | "auth-rejected"
  | "unknown-slug"
  | "context-mismatch"
  | "unreachable"

/** Resultado carimbado de uma fumaça (espelho de `SmokeResult`). */
export interface SmokeResult {
  agent: string
  model: string
  outcome: SmokeOutcome
  /** A frase do PRÓPRIO CLI (evidência, não paráfrase). */
  detail: string
  cliVersion: string | null
  /** Teto de contexto que o CLI reportou, quando reporta. */
  contextWindow: number | null
  /** Teto que o catálogo (models.dev) diz, quando conhece o modelo. */
  catalogContext: number | null
  canonicalModel: string | null
  checkedAt: number
}

/** Teto de candidatos por rodada (espelho de `MAX_CANDIDATES` no Rust — pedir
 *  mais é erro lá, e o front não deve nem tentar). */
export const MAX_CANDIDATES = 3

/** Isto decide algo sobre o slug? `unreachable` não: ele nunca promove nem
 *  rebaixa nada, é "não sei". Quem for automatizar promoção (M3) tem que
 *  passar por aqui. */
export function isVerdict(outcome: SmokeOutcome): boolean {
  return outcome !== "unreachable"
}

/** Frase pt-BR do desfecho, pra que a decisão chegue ao humano COM o motivo
 *  (o plano: "o Codex rejeitou este slug com a sua autenticação" vale
 *  infinitamente mais que aprovar/dispensar às cegas). */
export function outcomeNote(r: SmokeResult): string {
  switch (r.outcome) {
    case "ok":
      return "Testado e aceito neste CLI."
    case "auth-rejected":
      return "O CLI conhece este modelo, mas a sua autenticação não o alcança."
    case "unknown-slug":
      return "Este CLI não reconhece o modelo."
    case "context-mismatch": {
      const vivo = r.contextWindow
      const catalogo = r.catalogContext
      return vivo && catalogo
        ? `Aceito, mas o teto de contexto aqui é ${vivo} e o catálogo diz ${catalogo}.`
        : "Aceito, mas o teto de contexto difere do catálogo."
    }
    case "unreachable":
      return "Não deu para saber (nada foi promovido nem rebaixado)."
  }
}

/** Este motor pode ser testado? (espelho puro do registry) */
export function canSmokeTest(agent: string): boolean {
  return agentDef(agent)?.modelSmoke != null
}

/** Roda UMA rodada de fumaça. GASTA QUOTA (um token por candidato): só chame
 *  a partir de um gesto do humano ou de uma agenda, nunca de um efeito que
 *  reexecuta. Não engole erro (ADR-017): a recusa (teto de candidatos, freio
 *  entre rodadas, motor sem dialeto) volta como rejeição com a frase. */
export async function runSmoke(agent: string, models: string[]): Promise<SmokeResult[]> {
  return await invoke<SmokeResult[]>("model_smoke", { agent, models })
}

/** Tudo que já foi testado, com carimbo. Leitura pura, sem custo. */
export async function smokeHistory(): Promise<SmokeResult[]> {
  return await invoke<SmokeResult[]>("model_smoke_history")
}

/** O veredito conhecido para um par (motor, slug), ignorando o que não é
 *  veredito. `null` = ainda não se sabe — e não saber nunca é "não funciona". */
export function verdictFor(
  history: SmokeResult[],
  agent: string,
  model: string,
): SmokeResult | null {
  const hit = history.find((r) => r.agent === agent && r.model === model)
  if (!hit || !isVerdict(hit.outcome)) return null
  return hit
}
