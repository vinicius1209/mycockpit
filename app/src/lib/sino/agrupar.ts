// A atividade do sino, uma linha por conversa por dia (ADR-271).
//
// O feed guarda um item por evento, e é assim que a bandeja e o Companion o
// leem. O sino agrupa só na hora de mostrar: a conversa é o índice, e o que
// ela fez vira contagem e recibo. Falha e aviso ficam sozinhos, porque falha
// escondida dentro de um grupo é falha que não se vê (§1).

import type { Notification } from "@/store/notifications"

export interface ContagemDePedidos {
  perguntas: number
  permissoes: number
  pausas: number
}

export interface GrupoDaConversa {
  tipo: "conversa"
  chave: string
  convId: string
  projectId: string
  /** Do mais novo para o mais velho. */
  itens: Notification[]
  turnos: number
  /** Pedidos que pararam a conversa no caminho: histórico, não pendência. */
  pedidos: ContagemDePedidos
  /** O desfecho mais recente (turno ou missão), dono do recibo e da meta. */
  desfecho: Notification | null
  naoLidas: number
  ts: number
}

export interface Avulso {
  tipo: "avulso"
  chave: string
  item: Notification
  naoLidas: number
  ts: number
}

export type Entrada = GrupoDaConversa | Avulso

export interface Dia {
  chave: string
  rotulo: string
  entradas: Entrada[]
}

const PEDIDOS = new Set<Notification["kind"]>(["approval", "question", "gate"])

function entraNoGrupo(n: Notification): boolean {
  if (!n.convId || n.origem === "trabalho") return false
  return n.kind === "run_done" || PEDIDOS.has(n.kind)
}

function chaveDoDia(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function rotuloDoDia(ts: number, now: number): string {
  const chave = chaveDoDia(ts)
  if (chave === chaveDoDia(now)) return "Hoje"
  const ontem = new Date(now)
  ontem.setDate(ontem.getDate() - 1)
  if (chave === chaveDoDia(ontem.getTime())) return "Ontem"
  return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

export function agruparAtividade(items: readonly Notification[], now: number): Dia[] {
  const dias = new Map<string, Dia>()
  const grupos = new Map<string, GrupoDaConversa>()
  const ordenados = [...items].sort((a, b) => b.ts - a.ts)

  for (const n of ordenados) {
    const chaveDia = chaveDoDia(n.ts)
    let dia = dias.get(chaveDia)
    if (!dia) {
      dia = { chave: chaveDia, rotulo: rotuloDoDia(n.ts, now), entradas: [] }
      dias.set(chaveDia, dia)
    }
    const naoLida = n.read ? 0 : 1

    if (!entraNoGrupo(n)) {
      dia.entradas.push({ tipo: "avulso", chave: n.id, item: n, naoLidas: naoLida, ts: n.ts })
      continue
    }

    const chave = `${chaveDia}:${n.convId}`
    let g = grupos.get(chave)
    if (!g) {
      g = {
        tipo: "conversa",
        chave,
        convId: n.convId!,
        projectId: n.projectId,
        itens: [],
        turnos: 0,
        pedidos: { perguntas: 0, permissoes: 0, pausas: 0 },
        desfecho: null,
        naoLidas: 0,
        ts: n.ts,
      }
      grupos.set(chave, g)
      dia.entradas.push(g)
    }
    g.itens.push(n)
    g.naoLidas += naoLida
    if (n.kind === "run_done") {
      if (n.origem !== "missao") g.turnos += 1
      g.desfecho ??= n
    } else if (n.kind === "question") g.pedidos.perguntas += 1
    else if (n.kind === "approval") g.pedidos.permissoes += 1
    else g.pedidos.pausas += 1
  }

  return [...dias.values()]
}

/** Só o que tem algo não visto; dia que esvazia sai. */
export function soNaoLidas(dias: readonly Dia[]): Dia[] {
  return dias
    .map((d) => ({ ...d, entradas: d.entradas.filter((e) => e.naoLidas > 0) }))
    .filter((d) => d.entradas.length > 0)
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`
}

/** "2 perguntas · 1 permissão", ou null quando a conversa não parou. */
export function rotuloDosPedidos(p: ContagemDePedidos): string | null {
  const partes = [
    p.perguntas ? plural(p.perguntas, "pergunta", "perguntas") : null,
    p.permissoes ? plural(p.permissoes, "permissão", "permissões") : null,
    p.pausas ? plural(p.pausas, "pausa da missão", "pausas da missão") : null,
  ].filter(Boolean)
  return partes.length ? partes.join(" · ") : null
}

/** O feed guardou "pendente" na chegada; no histórico o pedido já não pende.
 *  Quem pende agora é o Esperando você. */
const SEM_PENDENCIA: [string, string][] = [
  ["Permissão pendente", "Permissão"],
  ["Pergunta pendente", "Pergunta"],
  ["Decisão pendente", "Missão pausou"],
  ["Recuperação pendente", "Missão parou"],
]

/** A segunda linha de um item avulso: diz o que o ícone não diz, com o rótulo
 *  do EVENTO (um trabalho em background que parou não é turno que falhou). */
export function metaDoAvulso(n: Notification, tituloDaConversa: string | null): string {
  if (PEDIDOS.has(n.kind)) {
    for (const [de, para] of SEM_PENDENCIA) {
      if (n.subtitle.startsWith(de)) return para + n.subtitle.slice(de.length)
    }
    return n.subtitle
  }
  if (n.origem === "turno" && n.kind === "run_error") return `${n.subtitle} · turno falhou`
  if (n.origem === "trabalho" && tituloDaConversa) return `${tituloDaConversa} · ${n.subtitle}`
  return n.subtitle
}
