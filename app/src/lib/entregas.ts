// O que o turno ENTREGOU: arquivo escrito inteiro (`Write`) ou criado (a
// mudança `add` do Codex) que não é código, e sim algo para a pessoa abrir:
// relatório, planilha, imagem, vídeo. Vira cartão acima do recibo do turno
// (G1, `docs/prototipos-maestri-plan.md`).
//
// Só o que o motor DISSE conta: o arquivo que ele declarou com `deliver`
// (ADR-286) ou, sem declaração, o que ele disse que escreveu. Arquivo gerado
// por comando de shell (`pandoc -o`, script Python) só entra declarado:
// adivinhar pelo comando seria inventar entrega.

import type { ChatItem } from "@/store/chat"
import { nomeDaTool } from "@/lib/toolFrota"

type ToolItem = Extract<ChatItem, { kind: "tool" }>

/** Extensões de entregável. Fica de fora o que costuma ser código ou dado do
 *  projeto (html, md, json, svg, txt): num turno de código eles apareceriam
 *  às dezenas, e o cartão virava ruído. */
const EXTENSOES = new Set([
  "pdf", "csv", "tsv", "xlsx", "xls", "ods", "docx", "doc", "odt", "rtf", "pptx", "key",
  "png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "webm", "mp3", "wav", "m4a", "zip",
])

export interface Entrega {
  /** Como o motor escreveu: absoluto ou relativo à raiz da conversa. */
  caminho: string
  /** A frase do agente, quando ele declarou a entrega (`deliver`). */
  frase?: string
}

/** A ferramenta `deliver` do `frota-work` (ADR-286): o agente DECLARA o que
 *  entregou, qualquer tipo, dentro ou fora do projeto. */
export function ehEntregaDeclarada(tool: ToolItem): boolean {
  return nomeDaTool(tool.name) === "deliver"
}

function declarada(tool: ToolItem): Entrega | null {
  const r = tool.result
  if (!ehEntregaDeclarada(tool) || !r || r.ok === false || r.interrupted) return null
  const input = tool.input && typeof tool.input === "object" && !Array.isArray(tool.input) ? (tool.input as Record<string, unknown>) : {}
  const caminho = typeof input.path === "string" ? input.path.trim() : ""
  if (!caminho) return null
  const frase = typeof input.summary === "string" ? input.summary.trim() : ""
  return frase ? { caminho, frase } : { caminho }
}

export function ehEntregavel(caminho: string): boolean {
  const nome = caminho.split("/").pop() ?? ""
  const i = nome.lastIndexOf(".")
  return i > 0 && EXTENSOES.has(nome.slice(i + 1).toLowerCase())
}

/** A mudança do Codex é `add` nos dois formatos que chegam: texto (o que o
 *  fio guarda hoje) e `{ type }` (o schema do app-server). */
function criado(kind: unknown): boolean {
  if (kind === "add") return true
  return !!kind && typeof kind === "object" && (kind as { type?: unknown }).type === "add"
}

function caminhosEscritos(tool: ToolItem): string[] {
  const r = tool.result
  if (!r || r.ok === false || r.interrupted) return []
  const input = tool.input
  if (tool.name === "Write" && input && typeof input === "object" && !Array.isArray(input)) {
    const p = (input as Record<string, unknown>).file_path
    return typeof p === "string" && p ? [p] : []
  }
  if (tool.name === "Edit" && Array.isArray(input)) {
    return input
      .filter((ch) => ch && typeof ch === "object" && criado((ch as { kind?: unknown }).kind))
      .map((ch) => (ch as { path?: unknown }).path)
      .filter((p): p is string => typeof p === "string" && !!p)
  }
  return []
}

/** Entregas de UM trecho de itens, sem repetir caminho e na ordem da última
 *  vez. Quando o agente declarou alguma, valem só as declaradas: ele disse o
 *  que é entrega, e a inferência pelas edições cede (D5). Puro. */
export function entregasDoTrecho(items: readonly ChatItem[]): Entrega[] {
  const declaradas = new Map<string, Entrega>()
  for (const it of items) {
    if (it.kind !== "tool") continue
    const e = declarada(it)
    if (!e) continue
    declaradas.delete(e.caminho)
    declaradas.set(e.caminho, e)
  }
  if (declaradas.size) return [...declaradas.values()]
  const vistos = new Map<string, Entrega>()
  for (const it of items) {
    if (it.kind !== "tool") continue
    for (const caminho of caminhosEscritos(it)) {
      if (!ehEntregavel(caminho)) continue
      vistos.delete(caminho)
      vistos.set(caminho, { caminho })
    }
  }
  return [...vistos.values()]
}

/** id do `result` → entregas do turno que ele fecha, a partir de `from`.
 *  Turno fechado não muda mais: o array do mapa anterior é reaproveitado, para
 *  a identidade não trocar a cada token do turno seguinte (o `memo` do item do
 *  fio depende disso). Puro. */
export function entregasPorResultado(
  items: readonly ChatItem[],
  from: number,
  anterior: ReadonlyMap<string, Entrega[]> = new Map(),
): Map<string, Entrega[]> {
  const out = new Map<string, Entrega[]>()
  let inicio = from
  for (let i = from; i < items.length; i++) {
    const it = items[i]
    if (it.kind === "user") inicio = i + 1
    if (it.kind !== "result") continue
    const reaproveitado = anterior.get(it.id)
    // Turno sem entrega também fica no mapa (vazio): senão seria refeito a cada token.
    out.set(it.id, reaproveitado ?? entregasDoTrecho(items.slice(inicio, i)))
    inicio = i + 1
  }
  return out
}
