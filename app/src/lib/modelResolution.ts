// Validação pedido×resolvido do modelo de uma sessão (P1 da auditoria de
// modelos, jul/2026). A verdade do CLI manda — o app NÃO bloqueia o run quando
// a resolução diverge; ele só para de aceitar em silêncio (notice no fio +
// marca no TitleBar). Motivação real: `--model opus[1m]` resolvido pelo claude
// 2.1.209 para claude-opus-4-7[1m], modelo que o /model do usuário nem
// listava; e o claude headless cai em FALLBACK silencioso quando a conta não
// tem acesso ao modelo pedido (só um aviso no stream, o run segue).
//
// Dois níveis, de propósito:
// - Divergência DURA (família errada, pin exato não honrado, [1m] perdido)
//   → resolutionNotice devolve mensagem = aviso no fio.
// - Resolução normal de alias (opus → ID concreto da vez) NÃO é aviso — vira
//   observação no ledger (observedResolutions, P2); quando a resolução MUDA
//   entre sessões, aliasShiftNotice fornece a mensagem (alto sinal, sem ruído
//   a cada turno).

/** Aliases que o Claude Code aceita em `--model` e a família que cada um pode
 *  legitimamente virar. Resolução é SERVER-SIDE e muda com versão/provider —
 *  os padrões só travam a FAMÍLIA, nunca a versão (versão é papel do pin). */
const CLAUDE_ALIAS_FAMILY: Record<string, RegExp> = {
  fable: /^claude-fable-/,
  best: /^claude-(fable|opus)-/,
  opus: /^claude-opus-/,
  sonnet: /^claude-sonnet-/,
  haiku: /^claude-haiku-/,
  // opusplan: Opus na fase de plano, Sonnet na execução — ambos válidos.
  opusplan: /^claude-(opus|sonnet)-/,
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Padrão que o modelo RESOLVIDO deve casar dado o pedido. null = sem
 *  expectativa verificável: pedido default/vazio, agent que só ecoa o pedido
 *  (codex) ou nem reporta (agy), ou alias que o app não conhece (honesto —
 *  não inventa expectativa pra não gerar alarme falso). */
export function expectedResolution(
  agent: string,
  reqModel: string | null,
): RegExp | null {
  if (agent !== "claude-code") return null
  if (!reqModel || reqModel === "default") return null

  const oneMillion = reqModel.endsWith("[1m]")
  const base = oneMillion ? reqModel.slice(0, -"[1m]".length) : reqModel

  const family = CLAUDE_ALIAS_FAMILY[base]
  if (family) {
    // Alias: trava família; com [1m] pedido, o resolvido tem que manter o 1M.
    return oneMillion
      ? new RegExp(`${family.source}.*\\[1m\\]$`)
      : family
  }
  if (base.startsWith("claude-")) {
    // Pin por ID completo: match exato, tolerando duas formas que o CLI pode
    // reportar sem quebrar o contrato do pin: o sufixo [1m] não pedido (1M é
    // default nos modelos atuais) e a forma DATADA do mesmo ID (ex.:
    // claude-opus-4-8 → claude-opus-4-8-20260322) — senão todo pin viraria
    // falso "Modelo divergente" permanente. Com [1m] pedido, o sufixo tem
    // que voltar.
    return oneMillion
      ? new RegExp(`^${escapeRegExp(base)}(-\\d{8})?\\[1m\\]$`)
      : new RegExp(`^${escapeRegExp(base)}(-\\d{8})?(\\[1m\\])?$`)
  }
  return null
}

/** Mensagem de DIVERGÊNCIA DURA (pt-BR) pra injetar no fio; null = tudo bem
 *  (casa com o esperado) ou sem base pra afirmar (expectativa null). */
export function resolutionNotice(
  agent: string,
  reqModel: string | null,
  resolved: string | null,
): string | null {
  if (!resolved) return null
  const expected = expectedResolution(agent, reqModel)
  if (!expected || expected.test(resolved)) return null
  return (
    `Modelo divergente: pedi "${reqModel}" e a sessão iniciou com ` +
    `"${resolved}". A verdade do CLI manda — o turno segue nesse modelo. ` +
    `Pra travar a versão, use um pin por ID completo no seletor.`
  )
}

/** O pedido é um alias (resolução legítima varia) — e não um pin/ID exato?
 *  Decide se a mudança de resolução entre sessões merece aviso (ledger P2). */
export function isAliasRequest(agent: string, reqModel: string | null): boolean {
  if (agent !== "claude-code" || !reqModel || reqModel === "default") return false
  const base = reqModel.endsWith("[1m]")
    ? reqModel.slice(0, -"[1m]".length)
    : reqModel
  return base in CLAUDE_ALIAS_FAMILY
}

/** Mensagem (pt-BR) quando um ALIAS passa a resolver pra outro modelo do que
 *  na última sessão observada — o momento exato em que orçamento/comportamento
 *  derivariam em silêncio. */
export function aliasShiftNotice(
  reqModel: string,
  previous: string,
  next: string,
): string {
  return (
    `O alias "${reqModel}" resolve agora para "${next}" ` +
    `(antes "${previous}"). Preço e comportamento podem ter mudado; ` +
    `pra fixar a versão, use um pin por ID completo.`
  )
}
