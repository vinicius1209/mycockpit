// A paleta ⌘K responde perguntas sobre o estado da Frota (F10, ADR-289). Sem
// modelo de linguagem: a pergunta é reconhecida por palavra, e a resposta sai
// do que o app já calcula para a Frota, a faixa e a cota. Pergunta que não é
// reconhecida não ganha resposta; a paleta segue com ações e busca.

import { AGENTS, agentDef } from "@/lib/agents"
import { planosDaFaixa, rotuloCurtoDaJanela } from "@/lib/faixaDosPlanos"
import type { LinhaDaFrota } from "@/lib/fleet/linhas"
import { fmtAgo, fmtCost } from "@/lib/format"
import { windowRows, type LedgerRow } from "@/lib/panel"
import {
  fmtAge,
  fmtPct,
  fmtResetAbsolute,
  usageTone,
  type UsageFailure,
  type UsageSnapshot,
} from "@/lib/usageWindow"

export type TipoDePergunta = "rodando" | "pede" | "gasto" | "cota" | "terminou"

export interface Intencao {
  tipo: TipoDePergunta
  /** Motor citado na pergunta ("cota do codex"), pelo registry. */
  motor: string | null
  periodo: "hoje" | "semana"
  /** "neste projeto" filtra para o projeto aberto (P4). */
  soProjeto: boolean
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")

/** Ordem importa: "o que pede você" não é "o que está rodando". */
const GATILHOS: [TipoDePergunta, RegExp][] = [
  ["pede", /\b(pede|pedem|pedindo|esperando|espera|aprovar|aprovacao|aprovacoes|decisao|decisoes)\b/],
  ["terminou", /\b(terminou|terminaram|acabou|acabaram|concluiu|concluiram|concluidas?|sem ver|perdi)\b/],
  ["rodando", /\b(rodando|trabalhando|executando|em andamento|ativas?|ativos?)\b/],
  ["gasto", /\b(gastei|gasto|gastos|gastando|custo|custos|custou|custaram)\b/],
  ["cota", /\b(cotas?|limites?|planos?|reseta|resetar|volta a cota)\b/],
]

/** O que a pessoa perguntou, ou null. Puro. */
export function intencaoDaPergunta(texto: string): Intencao | null {
  const t = norm(texto.trim())
  if (t.length < 4) return null
  const achado = GATILHOS.find(([, re]) => re.test(t))
  if (!achado) return null
  const motor =
    AGENTS.filter((a) => a.kind === "agent").find((a) => {
      const nomes = [a.id, ...norm(a.label).split(/\s+/)].filter((n) => n.length >= 3 && n !== "code")
      return nomes.some((n) => new RegExp(`\\b${n}\\b`).test(t))
    })?.id ?? null
  return {
    tipo: achado[0],
    motor,
    periodo: /\b(semana|7 dias|sete dias)\b/.test(t) ? "semana" : "hoje",
    soProjeto: /\b(neste|deste|nesse|desse) projeto\b/.test(t),
  }
}

export interface Pedaco {
  texto: string
  tom?: "forte" | "am" | "erro"
}

export interface LinhaDaResposta {
  chave: string
  agent: string | null
  titulo: string
  sub?: string
  meta: Pedaco[]
  barra?: { pct: number; tom: "ok" | "warn" | "danger" }
  /** Linha de conversa: o Enter leva até ela. */
  conversa?: { id: string; projectId: string }
}

export interface Resposta {
  manchete: Pedaco[]
  fonte: string
  linhas: LinhaDaResposta[]
}

const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`
const nomeDo = (agent: string | null) => (agent ? (agentDef(agent)?.label ?? agent) : "Motor desconhecido")

function filtrar(linhas: readonly LinhaDaFrota[], i: Intencao, projetoAberto: string | null): LinhaDaFrota[] {
  return linhas.filter(
    (l) => (!i.motor || l.agent === i.motor) && (!i.soProjeto || !projetoAberto || l.projectId === projetoAberto),
  )
}

/** O nome do projeto só aparece quando a lista mistura projetos (P4). */
function comProjeto(linhas: readonly LinhaDaFrota[]): boolean {
  return new Set(linhas.map((l) => l.projectId)).size > 1
}

export interface EstadoDaFrota {
  /** `buildFleetLines`: o que pede e o que roda, e o que terminou sem visto. */
  agora: readonly LinhaDaFrota[]
  maisCedo: readonly LinhaDaFrota[]
  /** Resumo do pedido de cada conversa que pede (o mesmo do sino). */
  pedidos: ReadonlyMap<string, string>
}

/** Rodando, pedindo e terminado sem ver. Puro. */
export function respostaDaFrota(i: Intencao, e: EstadoDaFrota, now: number, projetoAberto: string | null): Resposta {
  if (i.tipo === "pede") {
    const linhas = filtrar(e.agora.filter((l) => l.estado === "pede"), i, projetoAberto)
    const misto = comProjeto(linhas)
    return {
      manchete: linhas.length
        ? [{ texto: plural(linhas.length, "conversa", "conversas"), tom: "am" }, { texto: linhas.length === 1 ? " espera você" : " esperam você" }]
        : [{ texto: "Nada", tom: "forte" }, { texto: " espera você agora" }],
      fonte: "fila de pedidos, agora",
      linhas: linhas.map((l) => ({
        chave: l.id,
        agent: l.agent,
        titulo: l.titulo,
        sub: misto ? l.projectName : undefined,
        meta: [
          ...(e.pedidos.get(l.id) ? [{ texto: e.pedidos.get(l.id)!, tom: "am" as const }] : []),
          ...(l.updatedAt ? [{ texto: fmtAgo(now - l.updatedAt) }] : []),
        ],
        conversa: { id: l.id, projectId: l.projectId },
      })),
    }
  }
  if (i.tipo === "rodando") {
    const linhas = filtrar(e.agora.filter((l) => l.rodando), i, projetoAberto)
    const misto = comProjeto(linhas)
    return {
      manchete: linhas.length
        ? [{ texto: plural(linhas.length, "conversa", "conversas"), tom: "forte" }, { texto: " rodando agora" }]
        : [{ texto: "Nada", tom: "forte" }, { texto: " rodando agora" }],
      fonte: "estado dos turnos, agora",
      linhas: linhas.map((l) => ({
        chave: l.id,
        agent: l.agent,
        titulo: l.titulo,
        sub: misto ? l.projectName : undefined,
        meta: l.startedAt ? [{ texto: fmtAgo(now - l.startedAt) }] : [],
        conversa: { id: l.id, projectId: l.projectId },
      })),
    }
  }
  const linhas = filtrar(e.maisCedo, i, projetoAberto)
  const misto = comProjeto(linhas)
  return {
    manchete: linhas.length
      ? [{ texto: plural(linhas.length, "conversa", "conversas"), tom: "forte" }, { texto: linhas.length === 1 ? " terminou sem você abrir" : " terminaram sem você abrir" }]
      : [{ texto: "Nada", tom: "forte" }, { texto: " terminou sem você ver" }],
    fonte: "desde a última vez que você abriu cada uma",
    linhas: linhas.map((l) => ({
      chave: l.id,
      agent: l.agent,
      titulo: l.titulo,
      sub: misto ? l.projectName : undefined,
      meta:
        l.estado === "falhou"
          ? [{ texto: "falhou", tom: "erro" }, ...(l.updatedAt ? [{ texto: fmtAgo(now - l.updatedAt) }] : [])]
          : [{ texto: `concluída${l.updatedAt ? ` · ${fmtAgo(now - l.updatedAt)}` : ""}` }],
      conversa: { id: l.id, projectId: l.projectId },
    })),
  }
}

/** O gasto do livro de custos, o mesmo da faixa. Turno sem preço fica fora da
 *  soma e aparece como "sem preço", nunca como zero. Puro. */
export function respostaDoGasto(i: Intencao, rows: readonly LedgerRow[], now: number, projetoAberto: string | null): Resposta {
  const janela = windowRows([...rows], i.periodo === "semana" ? "7d" : "today", now).filter(
    (r) => (!i.motor || r.agent === i.motor) && (!i.soProjeto || !projetoAberto || r.projectId === projetoAberto),
  )
  const porMotor = new Map<string, { custo: number; turnos: number; semPreco: number }>()
  for (const r of janela) {
    const m = porMotor.get(r.agent) ?? { custo: 0, turnos: 0, semPreco: 0 }
    m.custo += r.costUsd ?? 0
    m.turnos += 1
    if (r.costUsd == null) m.semPreco += 1
    porMotor.set(r.agent, m)
  }
  const total = [...porMotor.values()].reduce((s, m) => s + m.custo, 0)
  const quando = i.periodo === "semana" ? "nos últimos 7 dias" : "hoje"
  return {
    manchete: janela.length
      ? [{ texto: fmtCost(total), tom: "forte" }, { texto: ` ${quando}, em ${plural(janela.length, "turno", "turnos")}` }]
      : [{ texto: "Nenhum turno", tom: "forte" }, { texto: ` ${quando}` }],
    fonte: "livro de custos, até o último turno terminado",
    linhas: [...porMotor.entries()]
      .sort((a, b) => b[1].custo - a[1].custo)
      .map(([agent, m]) => ({
        chave: agent,
        agent,
        titulo: nomeDo(agent),
        meta: [
          m.custo > 0 || m.semPreco === 0 ? { texto: fmtCost(m.custo), tom: "forte" as const } : { texto: "sem preço" },
          { texto: plural(m.turnos, "turno", "turnos") },
        ],
      })),
  }
}

/** A pior janela de cada motor, pela regra da faixa e do Companion. Puro. */
export function respostaDaCota(
  i: Intencao,
  byAgent: Record<string, UsageSnapshot>,
  failures: Record<string, UsageFailure>,
  now: number,
): Resposta {
  const planos = planosDaFaixa(null, byAgent, failures, now)
    .filter((p) => !i.motor || p.agent === i.motor)
    .sort((a, b) => b.janela.usedPercent - a.janela.usedPercent)
  const volta = (resetsAt: number | null) => {
    const q = resetsAt != null && resetsAt * 1000 > now ? fmtResetAbsolute(resetsAt, now) : null
    return q ? `volta ${q.replace(/^às /, "")}` : null
  }
  if (planos.length === 0) {
    return {
      manchete: [{ texto: "Ainda não li a cota", tom: "forte" }, { texto: i.motor ? ` do ${nomeDo(i.motor)}` : " de nenhum motor" }],
      fonte: "leitura dos planos",
      linhas: [],
    }
  }
  const pior = planos[0]
  const quandoPior = pior.janela.resetsAt != null ? fmtResetAbsolute(pior.janela.resetsAt, now) : null
  const maisVelha = Math.min(...planos.map((p) => byAgent[p.agent]?.fetchedAt ?? now))
  return {
    manchete: [
      { texto: planos.length > 1 ? "A mais apertada é a do " : "A cota do " },
      { texto: nomeDo(pior.agent), tom: "forte" },
      { texto: quandoPior ? `, que volta ${quandoPior}` : `, em ${fmtPct(pior.janela.usedPercent)}` },
    ],
    fonte: `leitura dos planos ${fmtAge(maisVelha, now)}`,
    linhas: planos.map((p) => {
      const tom = usageTone(p.janela.usedPercent)
      const v = volta(p.janela.resetsAt)
      return {
        chave: p.agent,
        agent: p.agent,
        titulo: nomeDo(p.agent),
        sub: rotuloCurtoDaJanela(p.janela) === "5h" ? "sessão de 5h" : `janela de ${p.janela.label}`,
        barra: { pct: Math.min(100, Math.round(p.janela.usedPercent)), tom },
        meta: [{ texto: fmtPct(p.janela.usedPercent), tom: tom === "ok" ? "forte" : tom === "warn" ? "am" : "erro" }, ...(v ? [{ texto: v }] : [])],
      }
    }),
  }
}

/** A linha do campo vazio (P2): só com algo rodando ou pedindo. Puro. */
export function linhaDeEstado(e: EstadoDaFrota, gastoHoje: number | null): Pedaco[] | null {
  const rodando = e.agora.filter((l) => l.rodando).length
  const pede = e.agora.filter((l) => l.estado === "pede").length
  if (rodando === 0 && pede === 0) return null
  const partes: Pedaco[] = []
  if (rodando) partes.push({ texto: `${rodando} rodando` })
  if (pede) partes.push({ texto: `${pede} ${pede === 1 ? "pede" : "pedem"} você`, tom: "am" })
  if (gastoHoje) partes.push({ texto: `${fmtCost(gastoHoje)} hoje` })
  return partes
}
