// M1 — DELIVERY RECALL (auto-aprendizado, docs/autonomy.md §M1). Lógica PURA
// e testável: dado a tarefa de uma nova missão e as entregas passadas que
// PASSARAM nos gates (status "done"), rankeia por semelhança usando overlap de
// KEYWORDS e de PATHS — deliberadamente SEM embeddings no v1 (o doc pede
// "comece por keyword/path overlap, não force embeddings"). O ranking de
// confiança (high/medium/low) implementa a hierarquia do logion: recall forte
// vira contexto no prompt do planner; recall fraco não injeta nada (evita ruído).

export interface DeliveryRecord {
  id: string
  task: string
  planSummary: string
  filesTouched: string[]
  costUsd: number | null
  agent: string
  model: string | null
  createdAt: number
}

export type RecallConfidence = "high" | "medium" | "low"

export interface RecallMatch {
  delivery: DeliveryRecord
  /** Score combinado (0..1): mistura overlap de keyword e de path. */
  score: number
  confidence: RecallConfidence
}

/** Stopwords pt-BR/en frequentes + ruído de tarefa: não carregam sinal de
 *  semelhança, então poluiriam o overlap se contassem. */
const STOPWORDS = new Set([
  "a", "o", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos",
  "das", "e", "ou", "que", "com", "sem", "por", "para", "pra", "pro", "no",
  "na", "nos", "nas", "em", "ao", "aos", "se", "ser", "foi", "the", "of",
  "to", "in", "on", "for", "and", "or", "with", "add", "adicionar", "criar",
  "fazer", "novo", "nova", "usar", "quando", "onde", "como", "isso", "este",
  "esta", "esse", "essa", "mais", "menos", "todo", "toda", "cada", "um",
])

/** Normaliza uma string em tokens significativos: minúsculas, sem acento,
 *  só alfanumérico, ≥3 chars, fora das stopwords. Determinístico (testável). */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>()
  if (!text) return out
  const cleaned = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^a-z0-9\s/._-]/g, " ")
  for (const raw of cleaned.split(/[\s]+/)) {
    const t = raw.replace(/^[/._-]+|[/._-]+$/g, "")
    if (t.length >= 3 && !STOPWORDS.has(t)) out.add(t)
  }
  return out
}

/** Extrai os "segmentos de path" de uma lista de arquivos: cada arquivo vira
 *  seus componentes de caminho + o nome-base sem extensão. Ex.:
 *  "src/lib/recall.ts" → {src, lib, recall}. Assim tarefas que mencionam
 *  "recall" ou "lib" casam com a entrega mesmo sem repetir o path inteiro. */
export function pathTokens(files: string[]): Set<string> {
  const out = new Set<string>()
  for (const f of files) {
    for (const seg of f.split(/[/\\]/)) {
      const base = seg.replace(/\.[a-z0-9]+$/i, "")
      for (const t of tokenize(base)) out.add(t)
    }
  }
  return out
}

/** Coeficiente de sobreposição |A∩B| / min(|A|,|B|): mede o quanto o menor
 *  conjunto está contido no maior. Melhor que Jaccard aqui — uma tarefa curta
 *  não é penalizada por casar com uma entrega de descrição longa. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / Math.min(a.size, b.size)
}

/** Limiares de confiança (calibrados p/ overlap normalizado). Abaixo de LOW o
 *  match é descartado — nada de injetar ruído no prompt (princípio do doc). */
const HIGH = 0.5
const MEDIUM = 0.28
const LOW = 0.15

function confidenceOf(score: number): RecallConfidence | null {
  if (score >= HIGH) return "high"
  if (score >= MEDIUM) return "medium"
  if (score >= LOW) return "low"
  return null
}

export interface RecallOptions {
  /** Nº máx. de matches devolvidos (cap anti-ruído). Default 3. */
  limit?: number
}

/** Rankeia as entregas passadas por semelhança com a tarefa nova. Combina
 *  overlap de KEYWORD (task↔task+plano) com overlap de PATH (keywords da task
 *  ↔ arquivos tocados), pesando a keyword 0.65 e o path 0.35. Descarta o que
 *  fica abaixo do limiar LOW e devolve os top-N por score (desc), desempate
 *  pela entrega mais recente. */
export function recallMatches(
  task: string,
  deliveries: DeliveryRecord[],
  opts: RecallOptions = {},
): RecallMatch[] {
  const limit = opts.limit ?? 3
  const taskTokens = tokenize(task)
  if (taskTokens.size === 0) return []

  const matches: RecallMatch[] = []
  for (const d of deliveries) {
    const delTokens = tokenize(`${d.task} ${d.planSummary}`)
    const delPaths = pathTokens(d.filesTouched)
    const kw = overlap(taskTokens, delTokens)
    // path score: quanto das keywords da tarefa aparecem nos arquivos tocados.
    const path = overlap(taskTokens, delPaths)
    const score = kw * 0.65 + path * 0.35
    const confidence = confidenceOf(score)
    if (!confidence) continue
    matches.push({ delivery: d, score, confidence })
  }

  matches.sort(
    (x, y) => y.score - x.score || y.delivery.createdAt - x.delivery.createdAt,
  )
  return matches.slice(0, limit)
}

/** Filtra os matches que valem injetar no prompt do planner: só high/medium
 *  (hierarquia do logion — recall fraco não vira contexto). */
export function strongMatches(matches: RecallMatch[]): RecallMatch[] {
  return matches.filter((m) => m.confidence !== "low")
}
