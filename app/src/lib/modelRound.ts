// A RODADA de modelos (M3 do docs/model-autonomy-plan.md): a única peça que
// junta as três pernas, gasta o token da fumaça e carimba as decisões.
//
// A REGRA mora em `lib/modelPromotion` (pura, testada). Aqui é o encanamento:
// perguntar a lista viva, escolher quem merece uma fumaça, aplicar a regra,
// gravar o ledger e mexer no cache do picker.
//
// QUANDO RODA (o §5 do plano: "fumaça não vira laço"):
//   • por GESTO — "Verificar agora" em Configurações ▸ Modelos;
//   • por AGENDA diária — o mesmo portão de 24h do catálogo de preços, com o
//     `lastModelRound` como freio próprio.
// Nunca em ticker, nunca em efeito que reexecuta. Três freios em série, e cada
// um sozinho já segura a conta: (1) o portão de 24h daqui; (2) só candidato
// NOVO vai pra fumaça, então em regime normal a rodada não gasta NADA; (3) o
// teto de 3 por motor e o `ROUND_COOLDOWN_MS` de 60s no Rust, que fazem um laço
// acidental FALHAR em vez de queimar quota.
//
// O QUE ESTA RODADA NÃO FAZ (guarda do §5): não escolhe padrão. Ela só
// ACRESCENTA opção ao seletor, e o gesto de tirar segue existindo. Trocar o
// motor das suas tarefas continua sendo decisão sua.

import { agentModels } from "@/lib/agents"
import { modelListingAgents, modelSmokeAgents } from "@/lib/agentRoster"
import {
  getModelsCatalog,
  modelPrice,
  refreshCatalogIntoSettings,
  type CatalogModel,
} from "@/lib/catalog"
import { isTauri } from "@/lib/db"
import {
  listConversationModelChoices,
  listModelProposals,
  replaceModelRetirements,
  upsertModelDecision,
} from "@/lib/modelLedger"
import { fetchModelList, type ModelListing } from "@/lib/modelList"
import {
  catalogEntryFor,
  reloadActiveProposals,
  runModelCurator,
} from "@/lib/modelCurator"
import {
  pickSmokeCandidates,
  promotionCall,
  retirementNotices,
  type ModelUsage,
  type PriceRead,
} from "@/lib/modelPromotion"
import { MAX_CANDIDATES, runSmoke, smokeHistory, type SmokeResult } from "@/lib/modelSmoke"
import { useApp } from "@/store/app"
import { usePresets } from "@/store/presets"

/** Janela mínima entre rodadas AGENDADAS. O gesto passa por cima (é você
 *  pedindo); o freio de 60s por motor no Rust continua valendo pros dois. */
export const ROUND_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface RoundReport {
  /** "agent:value" de cada desfecho, pra quem pediu por gesto poder contar. */
  promoted: string[]
  pending: string[]
  rejected: string[]
  /** Aposentadorias anunciadas que são NOVAS ou mudaram de texto. */
  retired: string[]
  /** Quantos slugs foram de fato testados (o que a rodada gastou). */
  smoked: number
  /** Motor cuja lista viva não deu para consultar. "Não sei": nada rebaixado. */
  unlisted: { agent: string; message: string }[]
  /** Motor cuja fumaça não deu para rodar (teto, freio, CLI fora). */
  smokeFailed: { agent: string; message: string }[]
}

function empty(): RoundReport {
  return {
    promoted: [],
    pending: [],
    rejected: [],
    retired: [],
    smoked: 0,
    unlisted: [],
    smokeFailed: [],
  }
}

/** Candidato de uma rodada: o slug + o texto que ele levaria pro seletor. */
interface Candidate {
  agent: string
  value: string
  label: string
  description: string
  origin: "cli" | "curator"
}

/** Preço pela MESMA régua do custo do turno, com o alias resolvido.
 *
 *  Duas consultas porque são duas perguntas: o `model_price` do Rust responde
 *  por slug exato (é o que o medidor de custo usa), e o `catalogEntryFor`
 *  resolve o ALIAS que o Claude Code aceita em `--model` ("sonnet" não é id de
 *  catálogo nenhum). Falha de comunicação vira "não sei", jamais "sem preço":
 *  reprovar candidato por erro nosso seria mentir o motivo. */
async function priceRead(
  catalog: CatalogModel[],
  agent: string,
  value: string,
): Promise<PriceRead> {
  try {
    const p = await modelPrice(value)
    if (p)
      return {
        kind: "found",
        input: p.input,
        output: p.output,
        fromCatalog: p.fromCatalog,
      }
  } catch (e) {
    return { kind: "unknown", message: e instanceof Error ? e.message : String(e) }
  }
  const c = catalogEntryFor(catalog, agent, value)
  if (c && (c.input != null || c.output != null))
    return {
      kind: "found",
      input: c.input ?? 0,
      output: c.output ?? 0,
      fromCatalog: true,
    }
  return { kind: "none" }
}

/** Onde os modelos estão ESCOLHIDOS hoje: conversas (o `req_model`, que é o que
 *  você pediu) e personas. É o que faz o aviso de aposentadoria dizer "e você
 *  usa ele aqui" em vez de só "vai sair". */
async function modelUsages(): Promise<ModelUsage[]> {
  const out: ModelUsage[] = (await listConversationModelChoices()).map((c) => ({
    agent: c.agent,
    model: c.model,
    where: `conversa ${c.title}`,
  }))
  // Personas: o espelho em memória dos arquivos .mycockpit/agents/*.md. Store
  // não carregado = nenhuma persona relatada, nunca uma inventada.
  for (const p of usePresets.getState().list)
    if (p.model) out.push({ agent: p.backend, model: p.model, where: `persona ${p.name}` })
  return out
}

/** UMA rodada. Devolve o relatório, ou `null` quando nem começou (fora do
 *  Tauri, ou agenda ainda no freio). Não engole erro (ADR-017): o que não deu
 *  pra consultar sai no relatório, e quem pediu por gesto conta a verdade. */
export async function runModelRound(opts: {
  trigger: "gesture" | "schedule"
  now?: number
}): Promise<RoundReport | null> {
  if (!isTauri()) return null
  const now = opts.now ?? Date.now()
  const app = useApp.getState()
  if (
    opts.trigger === "schedule" &&
    now - (app.settings.lastModelRound ?? 0) < ROUND_INTERVAL_MS
  )
    return null
  // Marca o run JÁ: falha adiante não vira martelada a cada boot.
  app.setSettings({ lastModelRound: now })

  const report = empty()
  const [catalog, ledger] = await Promise.all([
    getModelsCatalog(),
    listModelProposals(),
  ])
  const decidido = new Map(ledger.map((r) => [`${r.agent}:${r.value}`, r]))

  // 1. A lista viva de quem sabe se listar. Sonda local, read-only, sem quota.
  const listings = new Map<string, ModelListing>()
  for (const def of modelListingAgents()) {
    try {
      listings.set(def.id, await fetchModelList(def.id))
    } catch (e) {
      const f = e as { message?: string }
      report.unlisted.push({ agent: def.id, message: f?.message ?? String(e) })
    }
  }

  // 2. Aposentadoria anunciada: só de quem RESPONDEU (motor mudo não perde o
  //    que já se sabia). Isto NÃO mexe no seletor, só explica.
  const usages = await modelUsages()
  for (const [agent, listing] of listings) {
    const avisos = retirementNotices(
      listing,
      agentModels(agent).map((o) => o.value),
      usages,
    )
    const novas = await replaceModelRetirements(
      agent,
      avisos.map((a) => ({
        value: a.value,
        successor: a.successor,
        vendorNote: a.vendorNote,
        reason: a.reason,
      })),
      now,
    )
    report.retired.push(...novas.map((value) => `${agent}:${value}`))
  }

  // 3. Candidatos. Duas fontes, nenhuma delas por nome de motor:
  //    (a) o que o CLI LISTA e o seu seletor ainda não tem;
  //    (b) o que o curador propôs a partir do catálogo e segue pendente.
  //    Fora: o que VOCÊ dispensou (a rodada nunca ressuscita gesto seu), o que
  //    já está no seletor, e o que o próprio fornecedor esconde ou aposentou —
  //    oferecer o que o motor não oferece seria inventar oferta.
  const candidates: Candidate[] = []
  for (const [agent, listing] of listings) {
    const picker = new Set(agentModels(agent).map((o) => o.value))
    for (const m of listing.models) {
      if (picker.has(m.id) || m.hidden || m.supersededBy) continue
      const row = decidido.get(`${agent}:${m.id}`)
      if (row?.status === "dismissed" || row?.status === "active") continue
      candidates.push({
        agent,
        value: m.id,
        label: m.label,
        description: m.description ?? "",
        origin: "cli",
      })
    }
  }
  for (const row of ledger) {
    // Pendente segue candidato (falta veredito) e REPROVADO também: a recusa
    // foi sobre o mundo daquele dia, e o mundo muda (o preço aparece no
    // catálogo, o CLI passa a listar). Re-avaliar não custa nada — quem já tem
    // veredito de fumaça carimbado não é testado de novo.
    if (row.status !== "proposed" && row.status !== "rejected") continue
    if (candidates.some((c) => c.agent === row.agent && c.value === row.value))
      continue
    // Já está no seletor por outro caminho (opção estática do registry, lista
    // dinâmica do agy): promover de novo anunciaria como novidade o que você já
    // usa. Sai da rodada em silêncio porque não há nada a decidir.
    if (agentModels(row.agent).some((o) => o.value === row.value)) continue
    candidates.push({
      agent: row.agent,
      value: row.value,
      label: row.label,
      description: row.description,
      origin: row.origin,
    })
  }
  if (candidates.length === 0) return report

  // 4. A fumaça: o único gasto. Só candidato NOVO, teto por motor, e só em
  //    motor que sabe testar (registry, nunca nome).
  const history = await smokeHistory()
  const frescos: SmokeResult[] = []
  for (const def of modelSmokeAgents()) {
    const meus = candidates.filter((c) => c.agent === def.id).map((c) => c.value)
    if (meus.length === 0) continue
    const pick = pickSmokeCandidates(
      meus,
      history,
      def.id,
      listings.get(def.id)?.cliVersion ?? null,
      MAX_CANDIDATES,
    )
    if (pick.length === 0) continue
    try {
      frescos.push(...(await runSmoke(def.id, pick)))
      report.smoked += pick.length
    } catch (e) {
      // Recusa do Rust (freio de 60s, teto, motor sem dialeto) ou CLI fora do
      // ar. Não silencia: vira linha do relatório, e os candidatos daquele
      // motor seguem PENDENTES (sem veredito, nada é rebaixado).
      report.smokeFailed.push({
        agent: def.id,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }
  // O carimbado agora ganha do histórico (mesma chave, o mais novo na frente).
  const carimbos = [...frescos, ...history]

  // 5. A regra, uma vez por candidato, e o ledger com o motivo escrito.
  let promoveu = false
  for (const c of candidates) {
    const call = promotionCall({
      agent: c.agent,
      value: c.value,
      listing: listings.get(c.agent) ?? null,
      smoke:
        carimbos.find((r) => r.agent === c.agent && r.model === c.value) ?? null,
      price: await priceRead(catalog, c.agent, c.value),
    })
    const status =
      call.decision === "promote"
        ? "active"
        : call.decision === "reject"
          ? "rejected"
          : "proposed"
    const gravou = await upsertModelDecision({
      agent: c.agent,
      value: c.value,
      label: c.label,
      description: c.description,
      status,
      origin: c.origin,
      reason: call.reason,
      evidence: call.evidence,
      now,
    })
    if (!gravou) continue // sem gravação não houve promoção (nada de teatro)
    const chave = `${c.agent}:${c.value}`
    if (call.decision === "promote") {
      report.promoted.push(chave)
      promoveu = true
    } else if (call.decision === "reject") report.rejected.push(chave)
    else report.pending.push(chave)
  }

  // 6. Só agora o seletor muda: recarrega o cache de aprovados a partir do
  //    banco (fonte única — o picker nunca é montado a partir do relatório).
  if (promoveu) await reloadActiveProposals()
  return report
}

/** A MANUTENÇÃO DIÁRIA de modelos, na ordem em que uma depende da outra:
 *  catálogo de preços (best-effort, rede falhou = o snapshot anterior segue
 *  valendo), curador semanal (self-gated em `lastCuratorRun`, nunca roda com o
 *  helper global desligado) e a rodada de promoção (self-gated em
 *  `lastModelRound`).
 *
 *  Mora aqui, e não no boot do App, porque o boot é o GATILHO e não o dono da
 *  regra: quem quiser disparar a mesma coisa de outro lugar chama esta função
 *  em vez de repetir a sequência. Nenhuma das três roda em laço, e a única que
 *  pode gastar quota (a rodada) só gasta com candidato NOVO. */
export async function runDailyModelMaintenance(): Promise<void> {
  await refreshCatalogIntoSettings()
  await runModelCurator()
  await runModelRound({ trigger: "schedule" })
}

/** Resumo pt-BR de uma rodada, pro toast do gesto. Puro. */
export function roundSummary(r: RoundReport): string {
  const partes: string[] = []
  if (r.promoted.length > 0)
    partes.push(
      r.promoted.length === 1
        ? "1 modelo novo entrou no seletor"
        : `${r.promoted.length} modelos novos entraram no seletor`,
    )
  if (r.rejected.length > 0)
    partes.push(
      r.rejected.length === 1
        ? "1 não passou (o motivo está na lista)"
        : `${r.rejected.length} não passaram (os motivos estão na lista)`,
    )
  if (r.pending.length > 0)
    partes.push(`${r.pending.length} esperando você`)
  if (r.retired.length > 0)
    partes.push(
      r.retired.length === 1
        ? "1 aposentadoria anunciada"
        : `${r.retired.length} aposentadorias anunciadas`,
    )
  if (partes.length === 0) return "Nenhum modelo novo por aqui."
  return `${partes.join(" · ")}.`
}

/** As frases do que NÃO deu para consultar. Vazio = tudo respondeu. */
export function roundGaps(r: RoundReport, rotulo: (a: string) => string): string[] {
  return [
    ...r.unlisted.map(
      (u) => `Não deu para listar os modelos do ${rotulo(u.agent)}: ${u.message}`,
    ),
    ...r.smokeFailed.map(
      (u) => `Não deu para testar no ${rotulo(u.agent)}: ${u.message}`,
    ),
  ]
}
