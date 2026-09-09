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
import { agentDef, dedupeModelOptions, type LiveModels } from "@/lib/agents"
import type { AgentModelOption } from "@/lib/curatedModels"

/** Um esforço que o CLI declara aceitar PARA UM MODELO (espelho de
 *  `ModelEffortOption`). */
export interface ModelEffortOption {
  id: string
  description: string | null
}

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
  /** Esforços que ESTE modelo aceita, na ordem do CLI. Vazio = o dialeto não
   *  fala de esforço (nunca "nenhum esforço serve"). */
  efforts: ModelEffortOption[]
  /** O esforço que o CLI usa neste modelo quando ninguém escolhe. */
  defaultEffort: string | null
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

/** A lista viva de um motor → as opções do seletor. UMA regra pra todos os
 *  dialetos: quem sabe o que existe é o CLI, e o app só traduz.
 *
 *  Havia aqui uma função POR FORNECEDOR (`agyModelOptions`, `openCodeModel-
 *  Options`), e o preço apareceu em 09/09/2026: o codex passou a listar o
 *  `gpt-6-astra` como default DELE e o seletor da Frota seguiu abrindo em
 *  "Sol", porque ninguém tinha escrito a terceira função. Motor que declara
 *  `listsModels` no registry passa por aqui sem ganhar código próprio.
 *
 *  As regras, todas do transporte e nenhuma de um fornecedor:
 *
 *  • **A ORDEM é a do CLI.** Ele já ordena por prioridade dele (no codex o
 *    frontier vem primeiro), e reordenar seria o app opinando sobre um ranking
 *    que não é dele. É isso que faz modelo novo estrear no TOPO em vez de
 *    aparecer no rodapé atrás de dois modelos mortos.
 *  • **`hidden` não vira oferta.** O CLI esconde do picker dele; oferecer seria
 *    inventar oferta. Ele continua conhecido (a fumaça e a régua de estado
 *    enxergam a entrada), só não é sugestão.
 *  • **Slug com espaço em branco é descartado.** Regressão de 14/08/2026: um
 *    parser velho devolveu a LINHA do TSV como slug, o valor foi persistido e
 *    o CLI recusou todo envio ("model … is not recognized"). Opção que só
 *    produz erro não é oferta.
 *  • **Rótulo de casa ganha do rótulo do CLI**, quando o slug está no catálogo
 *    curado: a copy em pt-BR é nossa e diz mais. Slug novo estreia com o texto
 *    do PRÓPRIO CLI, que é melhor que "gpt-6-astra" cru.
 *  • **Aposentado fica, explicado.** Sumir com opção sem aviso é a coisa que
 *    este módulo existe pra impedir; a descrição vira o estado.
 *
 *  A sentinela ("Padrão") vem do registry e é preservada na frente, porque ela
 *  não é modelo: é "deixa o CLI escolher". Quando o CLI diz QUEM é o default
 *  dele, a descrição passa a dizer o nome — foi a linha "hoje Sol" escrita à
 *  mão que ficou mentindo por uma geração inteira de modelo. */
export function liveModelOptions(
  agent: string,
  entries: ReadonlyArray<ModelListEntry>,
): AgentModelOption[] {
  const estaticos = agentDef(agent)?.models ?? []
  const curado = new Map(estaticos.map((o) => [o.value, o]))
  const vivos: AgentModelOption[] = []
  for (const entry of entries) {
    const value = (entry.id ?? "").trim()
    if (!value || /\s/.test(value) || entry.hidden) continue
    const casa = curado.get(value)
    const nota = entry.supersededBy
      ? standingNote("retired", entry)
      : null
    vivos.push({
      ...(casa ?? {
        value,
        label: (entry.label ?? "").trim() || value,
        description: (entry.description ?? "").trim() || undefined,
      }),
      ...(nota ? { description: nota } : {}),
    })
  }
  return dedupeModelOptions([...sentinela(agent, entries), ...vivos])
}

/** A opção "Padrão" do registry, com a descrição atualizada quando o CLI diz
 *  quem é o default DELE. Sem sentinela no registry não se inventa uma: motor
 *  que não oferece "deixa o CLI escolher" não passa a oferecer por causa daqui. */
function sentinela(
  agent: string,
  entries: ReadonlyArray<ModelListEntry>,
): AgentModelOption[] {
  const base = (agentDef(agent)?.models ?? []).find((o) => o.value === SENTINELA)
  if (!base) return []
  const escolhido = entries.find((e) => e.isDefault)
  if (!escolhido) return [base]
  const label = agentDef(agent)?.label ?? agent
  return [
    {
      ...base,
      description: `Deixa o ${label} escolher (hoje ${escolhido.label || escolhido.id})`,
    },
  ]
}

/** O valor que significa "não escolhi modelo/esforço, deixa o CLI decidir". */
export const SENTINELA = "default"

/** Os esforços que o CLI declara para ESTE modelo, prontos pro seletor.
 *
 *  `null` = o dialeto não fala de esforço para este slug, e quem chama cai na
 *  régua estática do registry. Nunca devolve lista vazia por omissão: esvaziar
 *  a régua de esforço tiraria uma escolha que o motor aceita.
 *
 *  Existe porque a régua escrita à mão erra por modelo, não por motor: em
 *  09/09/2026 o mesmo CLI aceitava `ultra` no gpt-6-astra e parava em `xhigh`
 *  no gpt-5.5, e uma lista só não podia estar certa nos dois. */
export function liveEffortOptions(
  listing: ModelListing | null | undefined,
  model: string | null | undefined,
  sentinelaDoRegistry?: AgentModelOption,
): AgentModelOption[] | null {
  if (!listing || !model || model === SENTINELA) return null
  const entry = listing.models.find((m) => m.id === model)
  if (!entry || entry.efforts.length === 0) return null
  const cabeca = sentinelaDoRegistry ? [sentinelaDoRegistry] : []
  return [
    ...cabeca,
    ...entry.efforts.map((e) => ({
      value: e.id,
      label: e.id,
      description:
        e.description ??
        (e.id === entry.defaultEffort ? "Padrão deste modelo" : undefined),
    })),
  ]
}

/** O esforço escolhido ainda cabe na régua DESTE modelo?
 *
 *  Existe porque a régua passou a ser por modelo: trocar de modelo dentro do
 *  mesmo motor pode deixar para trás um esforço que o novo não aceita (o
 *  `ultra` do gpt-6-astra no gpt-5.5, que para em `xhigh`). O sintoma era duplo
 *  e os dois lados eram ruins: a régua abria sem NENHUM degrau aceso, e o envio
 *  ia falhar no backend por um valor que a pessoa não escolheu para aquele
 *  modelo.
 *
 *  Régua vazia devolve `true`: sem lista declarada não há o que contestar, e
 *  derrubar a escolha da pessoa por falta de informação seria o "não sei"
 *  rebaixando algo, que é justamente o que este módulo não faz. */
export function effortFitsModel(
  regua: readonly AgentModelOption[],
  effort: string,
): boolean {
  if (regua.length === 0) return true
  return regua.some((o) => o.value === effort)
}

/** A resposta de UM motor virada nas duas metades que o seletor consome, numa
 *  passada só. É a fronteira entre "o que o CLI disse" e "o que a pessoa vê":
 *  daqui pra frente ninguém mais toca no payload cru.
 *
 *  Pura de propósito — quem escreve no cache é a camada de efeito (`detect`),
 *  e é isso que deixa esta regra testável sem Tauri. */
export function liveModelsFrom(listing: ModelListing): LiveModels {
  const efforts = new Map<string, AgentModelOption[]>()
  const padrao = (agentDef(listing.agent)?.efforts ?? []).find(
    (o) => o.value === SENTINELA,
  )
  for (const entry of listing.models) {
    const opcoes = liveEffortOptions(listing, entry.id, padrao)
    if (opcoes) efforts.set(entry.id, opcoes)
  }
  return {
    models: liveModelOptions(listing.agent, listing.models),
    efforts,
    known: new Set(listing.models.map((m) => m.id)),
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
