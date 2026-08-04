// v0.3 Fusion, o JUIZ (seleção, nunca merge) + helpers de orquestração.
// O juiz roda no backend (comando `judge`: modelo forte, sem tools, sem MCP) e
// aqui a gente faz a dupla-passada (ordens invertidas → concordância = confiança)
// e mapeia o rótulo embaralhado de volta pro candidato.

import { invoke } from "@tauri-apps/api/core"
import { extractJson } from "@/lib/format"
import { agentDef } from "@/lib/agents"
import { frameHistory } from "@/lib/trust"
import type { ChatItem } from "@/store/chat"
import type { FusionCandidate, FusionJudge } from "@/store/fusion"

interface JudgeResult {
  text: string
  cost_usd: number | null
}

/** Rótulo legível de um candidato ("Claude · Opus"). Fonte única: lib/agents. */
export function candLabel(agent: string, model: string | null): string {
  const a = agentDef(agent)?.shortLabel ?? agent
  return model ? `${a} · ${model}` : a
}

/** Família do modelo/agent (claude/openai/…), p/ manter o juiz FORA da liga. */
function familyOf(s: string): string {
  const l = s.toLowerCase()
  if (/claude|opus|sonnet|haiku/.test(l)) return "claude"
  if (/codex|gpt|o3/.test(l)) return "openai"
  if (/opencode|glm/.test(l)) return "opencode"
  return l
}

/** Pré-seleção do vencedor (decisão PURA, idêntica pra qualquer caller):
 *  - juiz `single` (único candidato válido) → sempre auto-seleciona;
 *  - senão só se as 2 passadas CONCORDARAM e o juiz é NEUTRO (família fora da liga).
 *  Caso contrário deixa null (o usuário decide). */
export function decideChosen(
  judge: FusionJudge,
  candidates: FusionCandidate[],
  judgeModel: string,
): string | null {
  const jf = familyOf(judgeModel)
  const neutral = !candidates.some(
    (c) =>
      familyOf(c.agent) === jf ||
      (c.reqModel != null && familyOf(c.reqModel) === jf),
  )
  if (judge.status === "single") return judge.suggestedId
  return judge.agreement && neutral ? judge.suggestedId : null
}

async function callJudge(
  model: string,
  cwd: string,
  prompt: string,
): Promise<JudgeResult> {
  return invoke<JudgeResult>("judge", { model, cwd, prompt })
}

/** Texto final promovível de um candidato, o MESMO artefato que o juiz avalia. */
export function candidateText(c: FusionCandidate): string {
  const texts = c.items.filter(
    (it): it is Extract<ChatItem, { kind: "text" }> => it.kind === "text",
  )
  if (texts.length) return texts.map((t) => t.text).join("\n\n")
  return c.result?.text ?? ""
}

const CAP_CHARS = 32000 // ~8k tokens por candidato no prompt do juiz

function truncate(s: string): string {
  return s.length > CAP_CHARS ? s.slice(0, CAP_CHARS) + "\n[truncado]" : s
}

/** Prompt do juiz (pt-BR; SELEÇÃO de UMA resposta inteira, nunca merge). */
export function buildJudgePrompt(
  task: string,
  labeled: { label: string; text: string }[],
): string {
  const names = labeled.map((l) => l.label).join(", ")
  const blocks = labeled.map((l) => `[${l.label}]\n${truncate(l.text)}`).join("\n\n")
  return `Você é um JUIZ. Recebe a TAREFA original e respostas CANDIDATAS de agentes diferentes, rotuladas ${names}. Sua função é ESCOLHER a melhor resposta INTEIRA. NÃO combine, NÃO funda, NÃO reescreva, NÃO crie resposta nova: escolha exatamente UM rótulo existente.

Critérios, nesta ordem: (1) correção/factualidade; (2) completude em relação ao que foi pedido; (3) clareza e ausência de alucinação. IGNORE o tamanho e a ORDEM em que aparecem, os rótulos foram embaralhados e não indicam qualidade nem origem. Se uma candidata estiver vazia, truncada [marcada assim] ou claramente falha, desconsidere-a.

Responda SOMENTE com um único objeto JSON, sem nada antes ou depois:
{"winner":"<rótulo>","confidence":<0..1>,"reason":"<=200 caracteres, pt-BR>","runnerup":"<rótulo ou null>"}

TAREFA:
${task}

RESPOSTAS CANDIDATAS:
${blocks}`
}

interface JudgePass {
  winner: string | null
  reason: string
  runnerup: string | null
}

function parseJudge(text: string, labels: string[]): JudgePass | null {
  const o = extractJson<Record<string, unknown>>(text, "object")
  if (!o) return null
  const w = typeof o.winner === "string" && labels.includes(o.winner) ? o.winner : null
  const r =
    typeof o.runnerup === "string" && labels.includes(o.runnerup)
      ? o.runnerup
      : null
  return { winner: w, reason: typeof o.reason === "string" ? o.reason : "", runnerup: r }
}

const LABELS = ["A", "B", "C", "D", "E"]

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Estado inicial do juiz (idle). Fonte única, o store importa daqui. */
export function emptyJudge(): FusionJudge {
  return {
    status: "idle",
    suggestedId: null,
    rationale: null,
    agreement: null,
    runnerupId: null,
    passes: [],
    notes: {},
  }
}

/** Roda o juiz com DUPLA-PASSADA (ordens invertidas) sobre os sobreviventes.
 *  Concordância das 2 passadas = sinal de confiança. Nunca lança. */
export async function runJudge(
  task: string,
  judgeModel: string,
  cwd: string,
  candidates: FusionCandidate[],
): Promise<{ judge: FusionJudge; cost: number }> {
  const survivors = candidates.filter(
    (c) =>
      (c.status === "done" || c.status === "finalizing") &&
      candidateText(c).trim().length > 0,
  )
  if (survivors.length === 0) {
    return {
      judge: { ...emptyJudge(), status: "unavailable", rationale: "Nenhum candidato produziu resposta válida." },
      cost: 0,
    }
  }
  if (survivors.length === 1) {
    return {
      judge: { ...emptyJudge(), status: "single", suggestedId: survivors[0].id, rationale: "Único candidato válido." },
      cost: 0,
    }
  }

  // embaralha → rotula → guarda permutação label→candId (passada 1)
  const shuffled = shuffle(survivors)
  const p1items = shuffled.map((c, i) => ({ label: LABELS[i], text: candidateText(c), candId: c.id }))
  const p1labels = p1items.map((l) => l.label)
  const id1of = new Map(p1items.map((l) => [l.label, l.candId]))
  // passada 2: ordem invertida, re-rotulada
  const p2items = [...p1items].reverse().map((l, i) => ({ label: LABELS[i], text: l.text, candId: l.candId }))
  const p2labels = p2items.map((l) => l.label)
  const id2of = new Map(p2items.map((l) => [l.label, l.candId]))

  const judge = emptyJudge()
  let cost = 0
  try {
    const r1 = await callJudge(judgeModel, cwd, buildJudgePrompt(task, p1items))
    cost += r1.cost_usd ?? 0
    const pass1 = parseJudge(r1.text, p1labels)
    const r2 = await callJudge(judgeModel, cwd, buildJudgePrompt(task, p2items))
    cost += r2.cost_usd ?? 0
    const pass2 = parseJudge(r2.text, p2labels)

    judge.passes = [
      { winnerLabel: pass1?.winner ?? "?", reason: pass1?.reason ?? "" },
      { winnerLabel: pass2?.winner ?? "?", reason: pass2?.reason ?? "" },
    ]
    const win1 = pass1?.winner ? (id1of.get(pass1.winner) ?? null) : null
    const win2 = pass2?.winner ? (id2of.get(pass2.winner) ?? null) : null
    if (!win1 && !win2) {
      judge.status = "unavailable"
      judge.rationale = "O juiz não retornou uma escolha válida."
    } else {
      const agreement = win1 != null && win1 === win2
      judge.agreement = agreement
      judge.suggestedId = win1 ?? win2
      judge.rationale = pass1?.reason ?? pass2?.reason ?? null
      judge.runnerupId = pass1?.runnerup ? (id1of.get(pass1.runnerup) ?? null) : null
      judge.status = agreement ? "agree" : "disagree"
    }
  } catch {
    judge.status = "unavailable"
    judge.rationale = "Falha ao consultar o juiz."
  }
  return { judge, cost }
}

// ── Serialização de contexto (preâmbulo enriquecido) ────────────────────────
// Além de user/text, tool calls entram como linha compacta ("· tool Read: a.ts"),
// sequências do mesmo tool colapsam, e um orçamento de chars mantém o INÍCIO
// (1º pedido do usuário) + o FINAL (mais recente), cortando o meio.

const DIGEST_MAX = 80

function firstLine(s: string): string {
  const line = s.split("\n", 1)[0].trim()
  return line.length > DIGEST_MAX ? `${line.slice(0, DIGEST_MAX)}…` : line
}

/** Digest compacto do input de uma tool: file_path OU command (1ª linha, ~80
 *  chars) OU a chave principal do input. Puro e tolerante (input é unknown). */
export function toolDigest(input: unknown): string {
  if (input == null) return ""
  if (typeof input === "string") return firstLine(input)
  if (typeof input !== "object") return firstLine(String(input))
  const o = input as Record<string, unknown>
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null)
  const main =
    str("file_path") ??
    str("path") ??
    str("command") ??
    str("pattern") ??
    str("query") ??
    str("url") ??
    str("prompt") ??
    str("description")
  if (main != null) return firstLine(main)
  // fallback: primeira chave com valor primitivo (a "chave principal" do input)
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      return firstLine(`${k}=${String(v)}`)
    }
  }
  const keys = Object.keys(o)
  return keys.length ? keys[0] : ""
}

/** Quantos digests distintos aparecem numa linha colapsada antes do "…". */
const COLLAPSE_SHOWN = 3

/** Itens → entradas de texto (uma por item/grupo). Sequências consecutivas do
 *  MESMO tool colapsam numa linha ("· tool Read ×7: a.ts, b.rs, …"). */
function contextEntries(items: ChatItem[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < items.length) {
    const it = items[i]
    if (it.kind === "user") {
      out.push(`\nUsuário: ${it.text}`)
      i++
    } else if (it.kind === "text") {
      out.push(`\nAssistente: ${it.text}`)
      i++
    } else if (it.kind === "tool") {
      let j = i
      const digests: string[] = []
      while (j < items.length) {
        const t = items[j]
        if (t.kind !== "tool" || t.name !== it.name) break
        const d = toolDigest(t.input)
        if (d && !digests.includes(d)) digests.push(d)
        j++
      }
      const count = j - i
      const shown =
        digests.slice(0, COLLAPSE_SHOWN).join(", ") +
        (digests.length > COLLAPSE_SHOWN ? ", …" : "")
      const head = count > 1 ? `· tool ${it.name} ×${count}` : `· tool ${it.name}`
      out.push(shown ? `${head}: ${shown}` : head)
      i = j
    } else {
      i++
    }
  }
  return out
}

/** Orçamento default do preâmbulo (~10k chars ≈ 2.5k tokens). */
export const CONTEXT_BUDGET = 10_000

/** Serializa o histórico da conversa num preâmbulo (Fusion no meio da conversa,
 *  revezamento pro agy sem resume). Enriquecido: tool calls viram linhas
 *  compactas; acima do `budget`, mantém início + final e corta o meio com
 *  "[… N itens omitidos …]".
 *
 *  H3 (prompt-hygiene-plan): o resultado sai EMOLDURADO (frameHistory) — é
 *  conteúdo serializado reinjetado em prompt, então instrução plantada no
 *  histórico fica dentro dos delimitadores, nunca vira pedido solto. O budget
 *  vale pro conteúdo; a moldura é constante e fica fora da conta. */
export function serializeContext(
  items: ChatItem[],
  budget = CONTEXT_BUDGET,
): string {
  const header = "Contexto da conversa até aqui:"
  const entries = contextEntries(items)
  const full = [header, ...entries].join("\n")
  if (full.length <= budget) return frameHistory(full)

  // início: o 1º pedido do usuário (sempre ao menos 1 entrada) até ~30%.
  const headMax = Math.floor(budget * 0.3)
  const tailMax = budget - headMax - 48 // folga pro marcador de corte
  const head: string[] = []
  let hLen = 0
  let i = 0
  while (i < entries.length && hLen + entries[i].length + 1 <= headMax) {
    head.push(entries[i])
    hLen += entries[i].length + 1
    i++
  }
  if (head.length === 0 && entries.length > 0) {
    head.push(entries[0]) // o 1º pedido entra mesmo se estourar o headMax
    i = 1
  }
  // final: o mais recente, de trás pra frente, até ~70%.
  const tail: string[] = []
  let tLen = 0
  let j = entries.length - 1
  while (j >= i && tLen + entries[j].length + 1 <= tailMax) {
    tail.unshift(entries[j])
    tLen += entries[j].length + 1
    j--
  }
  const omitted = j - i + 1
  if (omitted <= 0) return frameHistory(full)
  return frameHistory(
    [header, ...head, `\n[… ${omitted} itens omitidos …]`, ...tail].join("\n"),
  )
}

/** Roda `fn` sobre `items` com no máximo `limit` em paralelo (stagger de candidatos). */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), queue.length) },
    async () => {
      while (queue.length) {
        const item = queue.shift()
        if (item === undefined) break
        await fn(item)
      }
    },
  )
  await Promise.all(workers)
}
