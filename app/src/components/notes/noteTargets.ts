/**
 * A quem a nota se destina — pelo REGISTRY, nunca por nome escrito à mão.
 *
 * A primeira versão da gaveta trazia uma união fixa
 * (`"claude" | "codex" | "agy" | "opencode" | "all"`) repetida em dois arquivos
 * de UI. Isso fura a regra mais dura da casa (código genérico não compara nome
 * de agent, consulta o registry) e já estava ERRADA na prática: o registry
 * chama de `claude-code` o que a nota chamava de `claude`, e o `model`
 * ("Modelo direto") simplesmente não existia pra ela. Agent novo entrava no
 * `adapters.rs` e no `agents.ts` e a gaveta continuava sem saber.
 *
 * Aqui o alvo é **id do registry** ou `ALVO_QUALQUER`. Quem lista, lista do
 * registry; quem lê valor gravado, normaliza antes de usar.
 */

import { DESTINATIONS, agentDef } from "@/lib/agents"

/** "serve pra qualquer motor" — o padrão de toda nota. */
export const ALVO_QUALQUER = "all"
export const ROTULO_QUALQUER = "Geral"

/**
 * Apelidos gravados pela versão anterior no `localStorage`.
 *
 * `codex`, `agy` e `opencode` já nasceram iguais ao id do registry; só o Claude
 * divergia. O mapa existe pra que a nota que você escreveu ontem não perca o
 * destino hoje — e é a única razão pela qual um nome de agent aparece neste
 * arquivo. Ele encolhe, nunca cresce: alvo novo entra pelo registry.
 */
const LEGADO: Record<string, string> = { claude: "claude-code" }

export interface AlvoDeNota {
  id: string
  label: string
}

/** Os alvos oferecidos, derivados do registry. "Geral" primeiro: é o padrão. */
export function alvosDeNota(): AlvoDeNota[] {
  return [
    { id: ALVO_QUALQUER, label: ROTULO_QUALQUER },
    ...DESTINATIONS.map((d) => ({ id: d.id, label: d.label })),
  ]
}

/**
 * Valor gravado → alvo utilizável.
 *
 * Alvo desconhecido cai em `ALVO_QUALQUER` em vez de sumir da lista: nota com
 * destino que o app não reconhece mais (agent removido, JSON editado à mão)
 * continua VISÍVEL. Nota que some porque o destino envelheceu é a pior falha
 * possível aqui — ela não avisa.
 */
export function normalizarAlvo(valor: string | undefined | null): string {
  if (!valor || valor === ALVO_QUALQUER) return ALVO_QUALQUER
  const id = LEGADO[valor] ?? valor
  return agentDef(id) ? id : ALVO_QUALQUER
}

export function rotuloDoAlvo(valor: string | undefined | null): string {
  const id = normalizarAlvo(valor)
  return id === ALVO_QUALQUER ? ROTULO_QUALQUER : (agentDef(id)?.label ?? ROTULO_QUALQUER)
}
