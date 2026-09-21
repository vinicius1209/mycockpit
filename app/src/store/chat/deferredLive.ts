import { deferredKind, type DeferredKind, type DeferredWork } from "@/lib/work"

/** Tipo do contrato → palavra que um humano usa (background-status B2.3:
 *  `local_agent` cru vazava pra tela). `other` não tem palavra: o motor disse
 *  algo que o contrato não conhece, e inventar nome seria mentir. */
const DEFERRED_KIND_LABEL: Record<DeferredKind, string | null> = {
  terminal: "terminal",
  subagent: "subagente",
  workflow: "workflow",
  other: null,
}

/** Nome humano de um trabalho diferido pro copy da UI (nunca id cru quando há
 *  alternativa melhor). */
export function deferredLabel(d: DeferredWork): string {
  if (d.name) return d.name
  const kind = deferredKind(d)
  const palavra = kind && DEFERRED_KIND_LABEL[kind]
  if (palavra) return palavra
  // Termo cru de item antigo que ninguém conhece segue cru; o `other` do
  // contrato não é palavra pra tela.
  return d.kind && d.kind !== "other" ? d.kind : d.id
}

/** Rótulo cortado pro tamanho que cabe na linha viva sem empurrar o cronômetro
 *  (background-status B2.1: quem cede é o NOME, nunca o tempo). O corte é do
 *  texto, além do `truncate` do CSS — a linha viva também vira `title` e
 *  notificação, onde não existe elipse de layout. */
function clipWorkName(name: string, max: number): string {
  const clean = name.replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** O que a LINHA VIVA (rodapé do fio, junto do composer) diz sobre o trabalho em
 *  background (background-status B2.2/B2.5). Um lugar canônico pro "agora":
 *  nada vivo → null (não mente); um → "trabalho em background · <nome>";
 *  N → "N trabalhos em background · <mais recente>" (nome atrás de nome
 *  empilhado quebrou a linha nos builds 181/182).
 *  `since` é o instante do trabalho NOMEADO: o cronômetro pertence ao que está
 *  escrito, e o turno perde o `startedAt` no `result`.
 *  `detail` lista os nomes pro tooltip (o detalhe abre no Fio Vivo). Puro. */
export interface LiveWorkLine {
  text: string
  since: number
  count: number
  detail: string
}

export function deferredLiveLine(
  works: DeferredWork[],
  nameMax = 28,
): LiveWorkLine | null {
  if (works.length === 0) return null
  // "mais recente" = o que nasceu por último; empate no nascimento desempata
  // pela última atividade observada, e depois pela ordem do fio.
  const latest = works.reduce((a, b) =>
    b.startedAt > a.startedAt ||
    (b.startedAt === a.startedAt && b.updatedAt >= a.updatedAt)
      ? b
      : a,
  )
  const name = clipWorkName(deferredLabel(latest), nameMax)
  return {
    text:
      works.length === 1
        ? `trabalho em background · ${name}`
        : `${works.length} trabalhos em background · ${name}`,
    since: latest.startedAt,
    count: works.length,
    detail: works.map(deferredLabel).join(", "),
  }
}

/** Aviso do botão de PARAR, na superfície do turno (deferred-work-plan D1.4 ×
 *  background-status B2.4): interromper o turno mata junto o trabalho em
 *  background. É a única superfície com essa ação, então a copy diz o preço, no
 *  plural certo. Sem trabalho vivo → undefined (o Parar comum não precisa de
 *  aviso). */
export function deferredStopWarning(works: DeferredWork[]): string | undefined {
  if (works.length === 0) return undefined
  if (works.length === 1)
    return "Parar (o trabalho em background do agent morre junto e fica marcado como interrompido)"
  return `Parar (os ${works.length} trabalhos em background do agent morrem junto e ficam marcados como interrompidos)`
}

/** Decisão travada 3 (D1) e ADR-182: Retomar ≠ repetir. Workflow reaproveita
 *  cache via resumeFromRunId; Bash/outros não prometem cache inexistente. */
export function deferredResumePrompt(d: DeferredWork): string | null {
  if (d.status !== "interrupted") return null
  return deferredKind(d) === "workflow"
    ? `Retome o trabalho em background "${deferredLabel(d)}" de onde parou, reaproveitando o que já foi executado: use a tool Workflow com o resumeFromRunId indicado na task-notification desta conversa (chamadas agent() concluídas voltam do cache). NÃO relance do zero.`
    : `O trabalho em background "${deferredLabel(d)}" foi interrompido antes da conclusão. Inspecione o estado atual do ambiente e decida os próximos passos.`
}

/** O que o botão "Retomar" de um trabalho diferido promete, no `title`. Mesma
 *  fronteira do prompt acima: só workflow reaproveita cache. */
export function deferredRetryTitle(d: DeferredWork): string {
  return deferredKind(d) === "workflow"
    ? "Retoma o trabalho em background de onde parou, reaproveitando o cache do workflow (não relança do zero)"
    : "Retoma a verificação do trabalho em background interrompido"
}

/** Extrai o contador de progresso (usage.total_tokens) do `progress` cru do
 *  task_progress. Tolerante: payload sem usage/total_tokens → null. */
export function progressTokens(progress: unknown): number | null {
  if (progress == null || typeof progress !== "object") return null
  const usage = (progress as Record<string, unknown>).usage
  if (usage == null || typeof usage !== "object") return null
  const t = (usage as Record<string, unknown>).total_tokens
  return typeof t === "number" ? t : null
}
