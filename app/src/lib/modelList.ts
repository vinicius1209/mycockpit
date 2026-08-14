// Lista VIVA de modelos: o que o CLI diz conhecer AGORA (M1 do
// docs/model-autonomy-plan.md). O Rust é quem sonda (model_list.rs, dialeto
// confinado no enum `ModelListSource`); aqui só há o wrapper tipado e a régua
// pura que diz em que ESTADO um slug está segundo essa lista.
//
// Regra que este arquivo existe pra sustentar (guarda do plano): "nada some do
// seletor sem aviso". Por isso a régua nunca devolve só um booleano — devolve
// um estado com motivo, e distingue "o CLI não conhece" de "não deu pra
// perguntar". Sem lista viva, o veredito é `unverified`: o comportamento de
// hoje (lista curada + catálogo) fica intacto.

import { invoke } from "@tauri-apps/api/core"
import { agentDef } from "@/lib/agents"

/** Um modelo que o CLI declara conhecer (espelho de `ModelListEntry`). */
export interface ModelListEntry {
  id: string
  label: string
  description: string | null
  /** O CLI esconde do picker padrão dele: existe, mas não é oferta. */
  hidden: boolean
  /** O CLI marca como o default DELE. */
  isDefault: boolean
  /** O CLI anuncia que este slug foi sucedido por outro. */
  supersededBy: string | null
  /** O texto do PRÓPRIO CLI sobre a aposentadoria (evidência, não paráfrase). */
  retirementNote: string | null
}

/** A lista de um motor, com procedência e carimbo (espelho de `ModelListing`). */
export interface ModelListing {
  agent: string
  /** "agy-models" | "codex-app-server" */
  source: string
  cliVersion: string | null
  fetchedAt: number
  models: ModelListEntry[]
}

/** Falha de sonda com o tipo na cara (espelho de `ModelListError`). */
export interface ModelListFailure {
  /** "unsupported" | "spawn" | "timeout" | "protocol" | "rpc" | "empty" */
  kind: string
  message: string
}

/** Estado de um slug segundo a lista viva.
 *  - `listed`: o CLI conhece e oferece.
 *  - `hidden`: o CLI conhece mas esconde do picker dele.
 *  - `retired`: o CLI conhece e ANUNCIA que foi sucedido por outro.
 *  - `unknown`: a lista veio e este slug NÃO está nela.
 *  - `unverified`: não há lista viva (motor sem fonte, ou a sonda falhou) —
 *    é "não sei", nunca veredito: nada é rebaixado por causa dele. */
export type SlugStanding = "listed" | "hidden" | "retired" | "unknown" | "unverified"

/** Em que estado o slug está segundo ESTA lista. `listing` nulo = não deu pra
 *  perguntar, e a resposta honesta é `unverified` (não "desconhecido"). */
export function slugStanding(
  listing: ModelListing | null | undefined,
  slug: string,
): SlugStanding {
  if (!listing) return "unverified"
  const entry = listing.models.find((m) => m.id === slug)
  if (!entry) return "unknown"
  if (entry.supersededBy) return "retired"
  if (entry.hidden) return "hidden"
  return "listed"
}

/** Frase pt-BR do estado, pra que a UI nunca some com uma opção em silêncio.
 *  `null` = estado que não precisa de aviso (o slug está normal na lista). */
export function standingNote(
  standing: SlugStanding,
  entry?: ModelListEntry | null,
): string | null {
  switch (standing) {
    case "listed":
      return null
    case "hidden":
      return "O CLI conhece este modelo, mas não o oferece na lista padrão dele."
    case "retired": {
      const sucessor = entry?.supersededBy
      return sucessor
        ? `O CLI marcou este modelo como aposentado e indica ${sucessor} no lugar.`
        : "O CLI marcou este modelo como aposentado."
    }
    case "unknown":
      return "O CLI não reconhece este modelo hoje (ele segue disponível, mas pode falhar no turno)."
    case "unverified":
      return "Não deu para conferir com o CLI, então nada mudou."
  }
}

/** Este motor sabe se listar? (espelho puro do registry, sem tocar no backend) */
export function canListModels(agent: string): boolean {
  return agentDef(agent)?.listsModels != null
}

/** Pergunta a lista viva ao CLI. Sonda LOCAL e read-only: nenhuma quota.
 *  NÃO engole erro (ADR-017): quem chama precisa distinguir "sem fonte" de
 *  "a fonte falhou agora" — a promessa é rejeitar com `ModelListFailure`. */
export async function fetchModelList(agent: string): Promise<ModelListing> {
  try {
    return await invoke<ModelListing>("model_list", { agent })
  } catch (e) {
    throw toListFailure(e)
  }
}

/** Normaliza o erro do invoke no shape tipado (o Rust já manda {kind,message};
 *  o que vier fora de forma vira "protocol" com o texto cru, nunca some). */
export function toListFailure(e: unknown): ModelListFailure {
  if (e && typeof e === "object" && "kind" in e) {
    const o = e as { kind?: unknown; message?: unknown }
    return {
      kind: typeof o.kind === "string" ? o.kind : "protocol",
      message: typeof o.message === "string" ? o.message : String(e),
    }
  }
  return { kind: "protocol", message: typeof e === "string" ? e : String(e) }
}
