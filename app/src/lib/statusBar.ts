// FAIXA DE STATUS INFERIOR — o que pode morar nela, e o que NUNCA pode.
//
// O critério pra ela existir estava registrado no roadmap ("só com ≥3
// indicadores ambientes permanentes") e foi cruzado: janela de uso por
// provider, custo da sessão, build em execução, com o navegador de trabalho
// vivo a caminho. Antes disso a faixa seria chrome gratuito.
//
// A FRONTEIRA que este módulo existe pra defender:
//
//   A faixa é AMBIENTE (o que é verdade enquanto você trabalha: quanto do
//   plano queimou, quanto a sessão custou, qual build está rodando).
//   O AGORA da conversa é da LINHA VIVA, que mora no composer e não sai de lá.
//
// Dois relógios narrando o mesmo agora foi o bug dos builds 181/182 (§6 do
// STYLEGUIDE, "dono único do agora"). Uma faixa permanente com cronômetro
// seria a reincidência com outro nome, e por isso `statusBarAccepts` é uma
// lista FECHADA: sinal novo entra por decisão explícita, não por conveniência
// de quem tem um dado sobrando e uma faixa vazia na frente.

import { absoluteTone, type MeterTone } from "@/lib/meter"
import { fmtCost } from "@/lib/format"
import { shortVersion } from "@/lib/version"

/** O que a faixa aceita hospedar. Lista FECHADA (ver o cabeçalho). */
export const STATUS_BAR_KINDS = ["usage", "cost", "build", "update"] as const
export type StatusKind = (typeof STATUS_BAR_KINDS)[number]

/**
 * Este sinal pode entrar na faixa?
 *
 * Recusa tudo que narra o AGORA de um turno (linha viva, cronômetro,
 * ferramenta rodando, streaming) e tudo que PEDE decisão: pedido de permissão
 * mora no card de interação e na faixa "precisa de você" do topo, que é
 * acionável. A faixa inferior não pede nada, e não pisca.
 */
export function statusBarAccepts(kind: string): kind is StatusKind {
  return (STATUS_BAR_KINDS as readonly string[]).includes(kind)
}

export interface StatusItem {
  kind: StatusKind
  /** O texto curto (11px mono, tabular-nums). */
  text: string
  /** Etiqueta à esquerda do valor; "" = item sem etiqueta. */
  label: string
  /** Tooltip: a frase inteira, pro texto curto não precisar mentir. */
  title: string
  /** Cinza é o normal; só sobe de tom por régua do §2 (nunca por opinião). */
  tone: MeterTone
}

/**
 * Custo da sessão na faixa. `null` = a zona não desenha NADA (sem placeholder,
 * sem "US$ 0,00", sem divisor órfão).
 *
 * Mesma regra de sempre: só com ≥2 turnos e gasto real. Um turno só já está
 * dito no fio, e "US$ 0,000" num turno em voo é ruído.
 *
 * O TOM vem de `absoluteTone`: cinza até o usuário definir um teto em
 * Configurações ▸ Uso e custo; com teto, é percentual daquele teto na régua do
 * §2. Nenhum limiar é inventado aqui.
 */
export function statusCostItem(
  cost: {
    total: number
    estimated: boolean
    turns: number
    /** ADR-047: turnos com consumo medido e preço desconhecido. */
    unpriced?: number
  },
  limit: number | null,
): StatusItem | null {
  if (cost.turns < 2) return null
  const unpriced = cost.unpriced ?? 0
  // Sessão inteira sem preço: havia consumo e a faixa não dizia NADA (o
  // modelo fora da tabela de preço apagava a zona). Agora ela diz o estado
  // real, sem inventar dólar (ADR-047).
  if (cost.total <= 0) {
    if (unpriced <= 0) return null
    return {
      kind: "cost",
      label: "sessão",
      text: "sem preço",
      title:
        "Esta sessão consumiu tokens em modelo fora da tabela de preço. O consumo está no fio e no ledger; o valor em US$ o app não sabe, e não inventa.",
      tone: absoluteTone(0, limit),
    }
  }
  return {
    kind: "cost",
    label: "sessão",
    text: fmtCost(cost.total, cost.estimated ? "estimated" : "reported"),
    title:
      (limit
        ? `Custo acumulado desta sessão (soma dos turnos), contra o seu teto de ${fmtCost(limit)}`
        : "Custo acumulado desta sessão (soma dos turnos). Defina um teto em Configurações ▸ Uso e custo pra ele avisar.") +
      (unpriced > 0
        ? `. Fora desta soma: ${unpriced} turno${unpriced === 1 ? "" : "s"} com preço desconhecido`
        : ""),
    tone: absoluteTone(cost.total, limit),
  }
}

/**
 * Build em execução, à direita. Absorve o que era o rodapé da sidebar: saber
 * qual build está rodando é ambiente e permanente, e no rodapé da sidebar
 * sumia junto com a sidebar fechada.
 *
 * A versão NUNCA trunca (S3.1): forma curta na linha, string completa no
 * tooltip. Sem versão (vite dev, fora do Tauri) fica "local" — nunca "v?" nem
 * campo vazio fingindo dado.
 */
export function statusBuildItem(version: string | null): StatusItem {
  const short = version ? shortVersion(version) : null
  return {
    kind: "build",
    label: "",
    text: short ? `local · ${short}` : "local",
    title: version ? `Build em execução: v${version}` : "Build local (sem versão carimbada)",
    tone: "ok",
  }
}

/**
 * Job de update de CLI em andamento (Configurações ▸ CLIs instaladas).
 * Substitui o toast flutuante "Atualizando…" (que sobrevivia ao fechar do
 * modal e reaparecia por cima do chat): é estado AMBIENTE — verdadeiro
 * enquanto o job roda, independente de qual tela o usuário está vendo — então
 * mora aqui, não num popup. O desfecho (sucesso/erro) continua sendo um toast
 * de um clique só, em `lib/updates.ts` — isso não muda.
 *
 * `null` = nenhum job rodando: a zona não desenha nada.
 */
export function statusUpdateItem(runningLabels: string[]): StatusItem | null {
  if (runningLabels.length === 0) return null
  const text =
    runningLabels.length === 1
      ? `atualizando ${runningLabels[0]}…`
      : `atualizando ${runningLabels.length}…`
  return {
    kind: "update",
    label: "",
    text,
    title: `Em andamento: ${runningLabels.join(", ")}`,
    tone: "ok",
  }
}
