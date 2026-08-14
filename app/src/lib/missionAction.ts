// A ESCADA DO RÓTULO (R2 do docs/mocks/missao-README.md), e o que ela conserta.
//
// O DEFEITO, com a causa achada no código: `presentTool` tem um `default:` que
// devolve a CONSTANTE "Executar ferramenta" e joga a identidade real em `meta`
// (toolview.ts, case default) — e os dois call sites da missão renderizavam só
// `.label`. Resultado: toda tool MCP, toda tool própria do Codex e toda tool do
// agy viravam a MESMA string, três, quatro vezes empilhadas, enquanto a linha
// seguinte dizia "Criar landing-plan.md". O nome CHEGA; a tela é que descartava.
// Há um segundo caso, de outra natureza: o Codex manda `file_change` com
// `input = item.changes`, SEM `file_path` (adapters.rs), então o rótulo sai
// "Editar arquivo" sem arquivo — embora o caminho esteja no payload, nas
// CHAVES do objeto.
//
// A escada, primeira que casar vence:
//   1. verbo + alvo          "criou landing-plan.md"
//   2. sem alvo no rótulo, mas com payload → o comando ou o caminho CRU em mono
//   3. nada além do identificador da tool → mostra ELE em mono
//                              (`mcp__figma__get_file`: id feio é identidade)
//   4. nada, nem nome → agrega numa linha só, com a culpa dita
//                              ("2 ações sem rótulo · o motor não mandou o nome")
//
// O degrau 4 é a forma HONESTA: N linhas iguais é pior que ausência, porque
// finge conteúdo. Agregado, o buraco fica MENSURÁVEL — se aparecer "9 ações sem
// rótulo", o adapter tem bug e o usuário vê.
//
// Puro (sem React, sem store, sem Date.now()). Nada aqui altera o `presentTool`
// do fio: a escada é uma CAMADA sobre ele, porque o rótulo genérico do chat tem
// contrato próprio e teste próprio.

import { presentTool, type ToolView } from "@/lib/toolview"
import type { ChatItem } from "@/store/chat"

type ToolItem = Extract<ChatItem, { kind: "tool" }>

/** Degrau da escada que produziu o rótulo (auditável no teste e na tela). */
export type LabelRung = 1 | 2 | 3

export interface ActionLabel {
  rung: LabelRung
  /** Texto humano completo da linha. */
  label: string
  /** O trecho que é CÓDIGO (comando, caminho, id da tool) — a UI põe em mono.
   *  null no degrau 1 quando o alvo já está embutido na prosa. */
  code: string | null
}

const PATH_KEYS = [
  "file_path",
  "path",
  "notebook_path",
  "filename",
  "file",
  "target_file",
]

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** Um caminho tem barra ou extensão. Serve pra separar "src/a.ts" de "true". */
function looksLikePath(s: string): boolean {
  return /[/\\]/.test(s) || /\.[a-z0-9]{1,6}$/i.test(s)
}

/** O que o payload sabe dizer, na ordem em que importa: comando > caminho
 *  declarado > caminho nas CHAVES (o `changes` do Codex) > nada. */
function payloadEvidence(input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  const o = input as Record<string, unknown>
  const cmd = asString(o.command) ?? asString(o.cmd)
  if (cmd) return cmd
  for (const k of PATH_KEYS) {
    const v = asString(o[k])
    if (v) return v
  }
  // `file_change` do Codex: as chaves do objeto SÃO os caminhos.
  const keys = Object.keys(o).filter((k) => looksLikePath(k))
  if (keys.length === 1) return keys[0]
  if (keys.length > 1) return `${keys[0]} e mais ${keys.length - 1}`
  return null
}

/** O identificador cru da tool, legível: `mcp__figma__get_file` vira
 *  "figma · get_file" (o mesmo tratamento que o `meta` do toolview já faz). */
export function toolIdentity(name: string): string {
  return name.replace(/^mcp__/, "").replaceAll("__", " · ")
}

/** O rótulo do `presentTool` já nomeia um ALVO? A pergunta é decidível sem
 *  lista de frases proibidas: o alvo só existe se a view achou algo concreto no
 *  payload (`detail` ou `meta`). "Editar arquivo" sem `file_path` sai dos dois
 *  vazios, e é exatamente o caso do Codex. */
function namesTarget(view: ToolView): boolean {
  return view.detail != null || view.meta != null
}

/** A escada aplicada a UMA ação. null = degrau 4 (nem nome chegou). */
export function actionLabel(name: string, input: unknown): ActionLabel | null {
  const clean = name?.trim() ?? ""
  const view = clean ? presentTool(clean, input) : null

  // degrau 1 — verbo + alvo, do vocabulário que o fio já fala.
  if (view && view.kind !== "generic" && namesTarget(view)) {
    return { rung: 1, label: view.label, code: null }
  }

  // degrau 2 — o payload sabe o que o rótulo não soube dizer.
  const evidence = payloadEvidence(input)
  if (evidence) {
    // preserva o VERBO quando existe um (o "Editar" do file_change do Codex);
    // sem verbo, o próprio comando/caminho é a linha.
    const verb =
      view && view.kind !== "generic" ? view.label.split(" ")[0] : null
    return {
      rung: 2,
      label: verb ? `${verb} ${evidence}` : evidence,
      code: evidence,
    }
  }

  // degrau 3 — sobrou o identificador, e ele é identidade.
  if (clean) {
    const id = toolIdentity(clean)
    return { rung: 3, label: id, code: id }
  }

  // degrau 4.
  return null
}

// ── O feed da fase ───────────────────────────────────────────────────────────

export type ActionState = "ok" | "erro" | "viva"

export interface ActionRow {
  kind: "acao"
  id: string
  rung: LabelRung
  label: string
  code: string | null
  state: ActionState
  /** Mudou o disco (escrita, comando, commit)? Mutação nunca agrega. */
  mutation: boolean
  /** Duração congelada, quando os dois carimbos existem. null = não se sabe, e
   *  aí não se mostra nada (Warp R6: some o sinal, fica o espaço). */
  durationMs: number | null
}

/** Degrau 4 agregado: o buraco fica mensurável em vez de fingir conteúdo. */
export interface UnlabeledRow {
  kind: "sem-rotulo"
  id: string
  count: number
  label: string
}

/** Leituras/buscas recolhidas (R6: acima de 5 ações, só mutação/falha/viva
 *  ficam abertas). O stub declara o que engoliu. */
export interface StubRow {
  kind: "stub"
  id: string
  count: number
  label: string
}

export type FeedRow = ActionRow | UnlabeledRow | StubRow

/** Acima deste número de ações, leitura vira ruído e recolhe. */
export const FEED_OPEN_LIMIT = 5

function rowState(t: ToolItem, live: boolean): ActionState {
  if (t.result) return t.result.ok ? "ok" : "erro"
  return live ? "viva" : "ok"
}

function isMutation(name: string, input: unknown): boolean {
  const view = presentTool(name || "x", input)
  return view.category === "change" || view.category === "execute"
}

/**
 * Monta as linhas de uma fase a partir dos itens do stream.
 *
 * Regras (R2 + R6, e as duas juntas são a resposta ao print do build 193):
 * - ações sem NENHUMA identidade agregam numa linha só, com a culpa dita;
 * - até 5 ações, mostra todas;
 * - acima de 5, leituras/buscas recolhem num stub e ficam visíveis as
 *   mutações, as FALHAS e a ação corrente. Falha nunca agrega — nem quando o
 *   mesmo comando falha quatro vezes seguidas (é a evidência que sustenta o
 *   aviso de repetição, e agregar apagaria justamente o que importa).
 */
export function buildPhaseFeed(
  items: ChatItem[] | undefined,
  opts: { live?: boolean } = {},
): FeedRow[] {
  const tools = (items ?? []).filter((i): i is ToolItem => i.kind === "tool")
  const lastIdx = tools.length - 1
  const rows: ActionRow[] = []
  const unlabeled: ToolItem[] = []

  tools.forEach((t, idx) => {
    const lab = actionLabel(t.name, t.input)
    if (!lab) {
      unlabeled.push(t)
      return
    }
    const live = Boolean(opts.live) && idx === lastIdx && !t.result
    rows.push({
      kind: "acao",
      id: t.id,
      rung: lab.rung,
      label: lab.label,
      code: lab.code,
      state: rowState(t, live),
      mutation: isMutation(t.name, t.input),
      durationMs:
        t.ts != null && t.activityAt != null && t.activityAt >= t.ts
          ? t.activityAt - t.ts
          : null,
    })
  })

  const out: FeedRow[] = []
  if (rows.length <= FEED_OPEN_LIMIT) {
    out.push(...rows)
  } else {
    const escondidas: ActionRow[] = []
    for (const r of rows) {
      const protegida =
        r.mutation || r.state === "erro" || r.state === "viva"
      if (protegida) {
        if (escondidas.length > 0) {
          out.push(stubOf(escondidas))
          escondidas.length = 0
        }
        out.push(r)
      } else {
        escondidas.push(r)
      }
    }
    if (escondidas.length > 0) out.push(stubOf(escondidas))
  }

  if (unlabeled.length > 0) {
    const n = unlabeled.length
    out.push({
      kind: "sem-rotulo",
      id: `sem-rotulo-${unlabeled[0].id}`,
      count: n,
      label: `${n} ${n === 1 ? "ação sem rótulo" : "ações sem rótulo"} (o motor não mandou o nome)`,
    })
  }
  return out
}

function stubOf(rows: ActionRow[]): StubRow {
  const n = rows.length
  return {
    kind: "stub",
    id: `stub-${rows[0].id}`,
    count: n,
    label: `${n} ${n === 1 ? "leitura" : "leituras"}`,
  }
}
