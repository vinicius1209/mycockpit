// M3 do docs/model-autonomy-plan.md — O PORTÃO VIRA AVISO.
//
// Este arquivo é a REGRA, pura e sem I/O: dado o que o CLI lista (M1), o que a
// fumaça carimbou (M2) e o que o app sabe cobrar (pricing.rs), ele diz se um
// candidato entra sozinho no seletor, fica pendente ou é reprovado — e, em
// qualquer caso, COM O MOTIVO ESCRITO.
//
// As três pernas, e por que são três:
//   1. o CLI LISTA o slug        → ele existe no motor, hoje, nesta versão
//   2. a FUMAÇA deu `ok`         → ele funciona com a SUA autenticação
//   3. o app sabe o PREÇO        → o turno com ele não sai sem custo
// Passou nas três, entra sozinho. Falhou em qualquer uma, não entra e vira item
// pro humano com o motivo ("o CLI não conhece este slug", "a sua autenticação
// não o alcança", "sem preço"), que é infinitamente mais útil que um par
// aprovar/dispensar às cegas.
//
// A ASSIMETRIA que sustenta a honestidade: `unverified` (não há lista viva) e
// `unreachable` (a fumaça não concluiu) são "NÃO SEI". Não promovem e não
// rebaixam: o candidato fica PENDENTE, nunca descartado. Só um veredito de
// verdade reprova. É por isso que o claude-code, que não sabe listar modelos
// (M1), não perde nada: os candidatos dele seguem no gate humano de sempre, em
// vez de serem reprovados por uma pergunta que ninguém pôde fazer.
//
// GUARDA DO §5 DO PLANO, mecânica e aqui: promover é ADICIONAR UMA OPÇÃO. Nada
// neste arquivo escreve default de agent, de projeto ou de conversa — entrar
// como opção é reversível, trocar o motor das suas tarefas não é.
//
// Agnosticismo: nenhuma comparação por nome de motor. Tudo o que este módulo
// sabe sobre um agent vem do registry (`lib/agents`) e das duas réguas de M1/M2.

import type { ModelProposal, ModelRetirement } from "@/lib/modelLedger"
import { agentDef } from "@/lib/agents"
import {
  slugStanding,
  standingNote,
  type ModelListEntry,
  type ModelListing,
} from "@/lib/modelList"
import {
  isVerdict,
  outcomeNote,
  verdictFor,
  type SmokeResult,
} from "@/lib/modelSmoke"

// ---------------------------------------------------------------------------
// A regra
// ---------------------------------------------------------------------------

/** As três pernas, na ordem em que o motivo é contado. */
export const PROMOTION_LEGS = ["list", "smoke", "price"] as const
export type PromotionLeg = (typeof PROMOTION_LEGS)[number]

/** `unknown` é "não sei" (nunca promove, nunca rebaixa). */
export type LegVerdict = "pass" | "fail" | "unknown"

export interface LegRead {
  leg: PromotionLeg
  verdict: LegVerdict
  /** A frase pt-BR desta perna, pronta pro humano. */
  note: string
}

/** O que a rodada faz com o candidato.
 *  - `promote`: entra sozinho no seletor (opção nova, nunca padrão).
 *  - `pending`: falta saber algo. Fica esperando, NÃO é descartado.
 *  - `reject`: alguma perna deu veredito negativo. Não entra, e o motivo fica
 *    visível (reprovado não é desaparecido). */
export type PromotionDecision = "promote" | "pending" | "reject"

/** Leitura do preço. O `unknown` existe porque "não deu pra perguntar o preço"
 *  não pode virar "não tem preço": isso reprovaria um candidato por uma falha
 *  nossa. */
export type PriceRead =
  | { kind: "found"; input: number; output: number; fromCatalog: boolean }
  | { kind: "none" }
  | { kind: "unknown"; message: string }

export interface PromotionInput {
  agent: string
  /** O slug EXATO que iria pro `--model`. */
  value: string
  /** A lista viva do motor. `null` = não há fonte, ou a sonda falhou. */
  listing: ModelListing | null
  /** O registro carimbado da fumaça, veredito OU não. `null` = nunca testado. */
  smoke: SmokeResult | null
  price: PriceRead
}

export interface PromotionCall {
  agent: string
  value: string
  decision: PromotionDecision
  /** A frase que vai pro humano: a procedência (promoveu) ou o motivo (não). */
  reason: string
  /** A frase do PRÓPRIO CLI, quando existe (evidência, não paráfrase). */
  evidence: string | null
  legs: LegRead[]
}

function listLeg(listing: ModelListing | null, value: string): LegRead {
  const standing = slugStanding(listing, value)
  if (standing === "listed")
    return { leg: "list", verdict: "pass", note: "O CLI lista este modelo." }
  const entry = listing?.models.find((m) => m.id === value) ?? null
  const note = standingNote(standing, entry) ?? ""
  // `unverified` é a única leitura que não decide nada: sem fonte de lista, o
  // motor não perde e não ganha (degradação honesta do M1).
  return {
    leg: "list",
    verdict: standing === "unverified" ? "unknown" : "fail",
    note,
  }
}

function smokeLeg(smoke: SmokeResult | null): LegRead {
  if (!smoke)
    return {
      leg: "smoke",
      verdict: "unknown",
      note: "Ainda não foi testado neste CLI.",
    }
  const note = outcomeNote(smoke)
  if (!isVerdict(smoke.outcome))
    return { leg: "smoke", verdict: "unknown", note }
  return {
    leg: "smoke",
    verdict: smoke.outcome === "ok" ? "pass" : "fail",
    note,
  }
}

function priceLeg(price: PriceRead): LegRead {
  if (price.kind === "found")
    return {
      leg: "price",
      verdict: "pass",
      note: price.fromCatalog
        ? `Preço no catálogo: $${price.input} in · $${price.output} out por 1M tokens.`
        : `Preço na tabela embutida: $${price.input} in · $${price.output} out por 1M tokens.`,
    }
  if (price.kind === "none")
    return {
      leg: "price",
      verdict: "fail",
      note: "Sem preço no catálogo, então o turno sairia sem estimativa de custo.",
    }
  return {
    leg: "price",
    verdict: "unknown",
    note: `Não deu para consultar o preço agora (${price.message}).`,
  }
}

/** A REGRA. Passou nas três pernas, entra sozinho; falhou em alguma, não entra
 *  e o motivo é a frase das pernas que falharam; nas demais, fica pendente com
 *  o que falta escrito. Pura: mesma entrada, mesma saída, sem relógio nem I/O. */
export function promotionCall(input: PromotionInput): PromotionCall {
  const legs: LegRead[] = [
    listLeg(input.listing, input.value),
    smokeLeg(input.smoke),
    priceLeg(input.price),
  ]
  const fails = legs.filter((l) => l.verdict === "fail")
  const unknowns = legs.filter((l) => l.verdict === "unknown")
  const entry = input.listing?.models.find((m) => m.id === input.value) ?? null
  const evidence = input.smoke?.detail ?? entry?.retirementNote ?? null

  // Ordem que importa: um veredito negativo reprova mesmo com outra perna em
  // "não sei" — o que reprova é o veredito, nunca a ignorância.
  if (fails.length > 0)
    return {
      agent: input.agent,
      value: input.value,
      decision: "reject",
      reason: fails.map((l) => l.note).join(" "),
      evidence,
      legs,
    }
  if (unknowns.length > 0)
    return {
      agent: input.agent,
      value: input.value,
      decision: "pending",
      reason: `Falta conferir: ${unknowns.map((l) => l.note).join(" ")}`,
      evidence,
      legs,
    }
  return {
    agent: input.agent,
    value: input.value,
    decision: "promote",
    reason:
      "Entrou sozinho: o CLI lista, a fumaça aceitou com a sua autenticação e o app sabe o preço.",
    evidence,
    legs,
  }
}

// ---------------------------------------------------------------------------
// Quem vai pra fumaça (a peça que gasta dinheiro)
// ---------------------------------------------------------------------------

/** Candidatos que MERECEM uma fumaça nesta rodada, na ordem recebida e no teto.
 *
 *  A fumaça é a única coisa que gasta quota de propósito, então:
 *  - candidato com veredito CARIMBADO não é re-testado (ele já respondeu);
 *  - a exceção é a VERSÃO DO CLI ter mudado desde o carimbo: aí o veredito é
 *    sobre outro binário e vale perguntar de novo;
 *  - `unreachable` não é veredito, então ele volta pra fila (a pergunta segue
 *    sem resposta);
 *  - `cliVersion` nulo (motor sem lista viva, nada com que comparar) NÃO
 *    re-testa: na dúvida, não gastar. */
export function pickSmokeCandidates(
  values: string[],
  history: SmokeResult[],
  agent: string,
  cliVersion: string | null,
  max: number,
): string[] {
  const out: string[] = []
  for (const value of values) {
    if (out.length >= max) break
    // `verdictFor` já ignora o que não é veredito: "não sei" volta pra fila.
    const rec = verdictFor(history, agent, value)
    if (rec) {
      const mudouDeBinario =
        cliVersion != null && rec.cliVersion != null && rec.cliVersion !== cliVersion
      if (!mudouDeBinario) continue
    }
    out.push(value)
  }
  return out
}

// ---------------------------------------------------------------------------
// Aposentadoria explicada (o achado do M2 que o plano não previa)
// ---------------------------------------------------------------------------

/** Onde um modelo está ESCOLHIDO hoje. `where` é a frase pronta ("conversa
 *  Refatorar o composer", "persona Revisor"). */
export interface ModelUsage {
  agent: string
  model: string
  where: string
}

export interface RetirementNotice {
  agent: string
  value: string
  /** O sucessor que o FORNECEDOR indica. Vazio = ele não indicou nenhum, que é
   *  o caso do slug que simplesmente SUMIU da lista (não há anúncio a citar). */
  successor: string
  /** O texto do fornecedor sobre a migração (evidência crua, quando veio). */
  vendorNote: string | null
  /** A frase pt-BR completa, com o sucessor e onde você usa o modelo. */
  reason: string
  /** Os lugares onde você está com ele escolhido. */
  usedIn: string[]
}

/** Modelos que o CLI ANUNCIA como aposentados e que importam pra você: os que
 *  estão no seu seletor ou escolhidos em algum lugar.
 *
 *  A guarda do plano ("nada some do seletor sem aviso") não precisa de
 *  heurística aqui: o motivo vem escrito pelo fornecedor no `retirementNote`,
 *  e o sucessor também. O que este módulo acrescenta é a parte que só o app
 *  sabe: que VOCÊ está usando aquele modelo, e onde.
 *
 *  Slug aposentado que não está no seu seletor nem escolhido em lugar nenhum
 *  não vira aviso: nunca foi seu, não há o que explicar.
 *
 *  DOIS jeitos de um modelo sair de cena, e os dois passam por aqui:
 *
 *   1. **anunciado** — o CLI diz `upgrade: <sucessor>` e ainda oferece o slug.
 *      Ele CONTINUA no seletor, só ganha a frase: tirar um modelo que funciona
 *      por causa de um aviso quebraria a conversa de quem está com ele.
 *   2. **sumido** — o slug não está mais na lista, sem anúncio nenhum. É o
 *      caso que faltava, e ele é pior justamente por ser mudo: em 09/09/2026 o
 *      seletor ainda oferecia `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.6` e
 *      `gpt-realtime-2.1`, que o `model/list` do codex já não conhecia. Aqui
 *      ele vira aviso; quem decide não oferecer mais é `agentModels`, contra a
 *      lista viva, e nunca este módulo.
 *
 *  `listing` nulo é "não deu pra perguntar" e não gera aviso nenhum: a mesma
 *  assimetria do resto do M3, onde só veredito rebaixa. */
export function retirementNotices(
  listing: ModelListing | null,
  /** Os values que o seletor daquele agent oferece hoje. */
  options: readonly string[],
  usages: readonly ModelUsage[],
): RetirementNotice[] {
  if (!listing) return []
  const oferecidos = new Set(options)
  const out: RetirementNotice[] = []
  for (const entry of listing.models) {
    if (!entry.supersededBy) continue
    const usedIn = ondeUsa(listing, entry.id, usages)
    if (!oferecidos.has(entry.id) && usedIn.length === 0) continue
    out.push({
      agent: listing.agent,
      value: entry.id,
      successor: entry.supersededBy,
      vendorNote: entry.retirementNote,
      reason: retirementReason(entry, usedIn),
      usedIn,
    })
  }
  // Os SUMIDOS: o que você tem à mão e o CLI não conhece mais. A varredura é
  // sobre o seu lado (seletor + escolhas), porque o outro lado é justamente
  // uma ausência — não há entrada na lista pra iterar.
  const conhecidos = new Set(listing.models.map((m) => m.id))
  const meus = new Set([
    ...options,
    ...usages.filter((u) => u.agent === listing.agent).map((u) => u.model),
  ])
  for (const value of meus) {
    if (!value || value === "default" || conhecidos.has(value)) continue
    const usedIn = ondeUsa(listing, value, usages)
    out.push({
      agent: listing.agent,
      value,
      successor: "",
      vendorNote: null,
      reason: vanishedReason(listing, usedIn),
      usedIn,
    })
  }
  return out
}

function ondeUsa(
  listing: ModelListing,
  value: string,
  usages: readonly ModelUsage[],
): string[] {
  return usages
    .filter((u) => u.agent === listing.agent && u.model === value)
    .map((u) => u.where)
}

function retirementReason(entry: ModelListEntry, usedIn: string[]): string {
  const base = `O CLI anuncia que este modelo será aposentado e indica ${entry.supersededBy} no lugar.`
  const doFornecedor = entry.retirementNote ? ` ${entry.retirementNote.trim()}` : ""
  const seu =
    usedIn.length > 0
      ? ` Você está com ele escolhido em ${listar(usedIn)}, e a troca é sua: nada muda sozinho.`
      : ""
  return `${base}${doFornecedor}${seu}`
}

/** A frase do slug que sumiu. Carrega a EVIDÊNCIA (versão do CLI e data), que é
 *  o que separa "o CLI não conhece mais" de um palpite nosso. */
function vanishedReason(listing: ModelListing, usedIn: string[]): string {
  const versao = listing.cliVersion ? ` ${listing.cliVersion}` : ""
  const base = `Este modelo saiu do catálogo do CLI${versao}, sem anunciar sucessor, então ele deixou de ser oferecido no seletor.`
  const seu =
    usedIn.length > 0
      ? ` Você está com ele escolhido em ${listar(usedIn)}: enviar assim tende a falhar, e a troca é sua.`
      : ""
  return `${base}${seu}`
}

/** "a, b e c" (o "e" antes do último; sem travessão, §7 do STYLEGUIDE). */
function listar(itens: string[]): string {
  if (itens.length === 1) return itens[0]
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`
}

// ---------------------------------------------------------------------------
// O aviso no sino
// ---------------------------------------------------------------------------

/** Quanto tempo uma decisão sobre modelo é NOTÍCIA. Passado isso ela continua
 *  em Configurações ▸ Modelos (que é o estado), mas sai do sino (que é o
 *  novo). Novidade envelhece; estado não. */
export const NEWS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type ModelNewsTone = "new" | "blocked" | "retired"

export interface ModelNewsItem {
  /** Chave estável COM a assinatura do conteúdo: o aviso de amanhã, que fala de
   *  outros modelos, não nasce dispensado. Mesmo padrão do `updateDismissed`. */
  id: string
  agent: string
  tone: ModelNewsTone
  title: string
  detail: string
}

/** O que o sino conta sobre modelos: o ledger de decisões + as aposentadorias
 *  anunciadas pelo fornecedor.
 *
 *  Hierarquia (a mesma do resto do sino: o que mexe com você primeiro):
 *  aposentadoria → reprovado → novidade. E NADA daqui conta no badge: ver
 *  `blockingToolCount` em lib/toolHealth. */
export function modelNews(
  rows: readonly ModelProposal[],
  retirements: readonly ModelRetirement[],
  now: number,
  dismissed: Record<string, number> = {},
): ModelNewsItem[] {
  const fresco = (r: ModelProposal) =>
    r.decidedAt > 0 && now - r.decidedAt < NEWS_WINDOW_MS
  const out: ModelNewsItem[] = []

  for (const r of retirements.filter(
    (r) => now - r.seenAt < NEWS_WINDOW_MS,
  ))
    out.push({
      id: `models:retired:${r.agent}:${r.value}:${r.seenAt}`,
      agent: r.agent,
      tone: "retired",
      // Sem sucessor não houve anúncio: o slug simplesmente saiu do catálogo, e
      // dizer "vai ser aposentado" ali seria inventar um aviso do fornecedor.
      title: r.successor
        ? `${r.value} vai ser aposentado`
        : `${r.value} saiu do catálogo do ${rotulo(r.agent)}`,
      detail: `${rotulo(r.agent)} · ${r.reason}`,
    })

  for (const r of rows.filter((r) => r.status === "rejected" && fresco(r)))
    out.push({
      id: `models:blocked:${r.agent}:${r.value}:${r.decidedAt}`,
      agent: r.agent,
      tone: "blocked",
      title: `${r.value} não entrou no seletor`,
      detail: `${rotulo(r.agent)} · ${r.reason}`,
    })

  // Promovidos: uma linha por motor (a frase do plano é "N modelos novos
  // validados e disponíveis", não N linhas iguais).
  const porAgent = new Map<string, ModelProposal[]>()
  for (const r of rows) {
    if (r.status !== "active" || r.decidedBy !== "app" || !fresco(r)) continue
    const lista = porAgent.get(r.agent)
    if (lista) lista.push(r)
    else porAgent.set(r.agent, [r])
  }
  for (const [agent, lista] of porAgent) {
    const slugs = lista.map((r) => r.value)
    const n = slugs.length
    out.push({
      id: `models:new:${agent}:${slugs.join(",")}`,
      agent,
      tone: "new",
      title:
        n === 1
          ? "1 modelo novo validado e disponível"
          : `${n} modelos novos validados e disponíveis`,
      detail: `${rotulo(agent)} · ${slugs.join(", ")} · ${n === 1 ? "já está" : "já estão"} no seletor`,
    })
  }

  return out.filter((i) => dismissed[i.id] == null)
}

function rotulo(agent: string): string {
  return agentDef(agent)?.label ?? agent
}
