// Núcleo PURO do guia de setup da sidebar (R2 fase 2 do roadmap). O onboarding
// instala o essencial em ~1 minuto; o guia é o que sobra depois, marcado por
// PROBE de estado real e nunca por "o usuário clicou aqui uma vez".
//
// Três regras que este módulo existe pra garantir:
//   1. item só fica marcado com PROBE que voltou dizendo que sim;
//   2. leitura que não voltou é "unknown", que NÃO conta como feito e NÃO
//      deixa o guia sumir (§6 do STYLEGUIDE: "não sei" degrada pro pessimista);
//   3. item de capacidade que esta máquina não tem some da lista inteira, em
//      vez de virar linha morta que nunca completa (§5.1).

import type { SectionId } from "@/components/settings/sections"

export type GuideItemId =
  | "agent"
  | "project"
  | "meter"
  | "hooks"
  | "companion"

/** Resultado de um probe: true/false = leitura real; null = não voltou. */
export type ProbeResult = boolean | null

export type ItemState = "done" | "todo" | "unknown"

/** Pra onde o clique leva. `add-project` abre o seletor de pasta; o resto
 *  abre Configurações na seção que RESOLVE aquele item. */
export type GuideTarget =
  | { kind: "settings"; section: SectionId }
  | { kind: "add-project" }

export interface GuideItem {
  id: GuideItemId
  /** O que o item DESBLOQUEIA, não o nome da feature. */
  label: string
  state: ItemState
  target: GuideTarget
}

/** O que a máquina oferece. Um item só entra na lista quando a capacidade
 *  existe aqui (registry + probe), nunca por nome de agent. */
export interface GuideCapabilities {
  /** Algum motor instalado tem medidor de janela de uso. */
  meter: boolean
  /** Algum motor instalado tem hooks de ciclo de vida instaláveis. */
  hooks: boolean
  /** O Companion está LIGADO nas Configurações. Desligado = não-configurado,
   *  e não-configurado esconde (§5.2); ligado sem par é o "configurado
   *  incompleto", que fica visível de propósito. */
  companion: boolean
}

export type ProbeMap = Partial<Record<GuideItemId, ProbeResult>>

const CATALOG: {
  id: GuideItemId
  label: string
  target: GuideTarget
  /** null = item incondicional. */
  needs: keyof GuideCapabilities | null
}[] = [
  {
    id: "agent",
    label: "Ter uma CLI de agent instalada",
    target: { kind: "settings", section: "machine" },
    needs: null,
  },
  {
    id: "project",
    label: "Apontar seu primeiro projeto",
    target: { kind: "add-project" },
    needs: null,
  },
  {
    id: "meter",
    label: "Ver quanto da janela de uso você já queimou",
    target: { kind: "settings", section: "ledger" },
    needs: "meter",
  },
  {
    id: "hooks",
    label: "Enxergar as sessões abertas no terminal",
    target: { kind: "settings", section: "hooks" },
    needs: "hooks",
  },
  {
    id: "companion",
    label: "Parear o celular para acompanhar de longe",
    target: { kind: "settings", section: "companion" },
    needs: "companion",
  },
]

/** Probe → estado do item. Ausente e null são a MESMA coisa: não sei. */
export function stateFromProbe(result: ProbeResult | undefined): ItemState {
  if (result === true) return "done"
  if (result === false) return "todo"
  return "unknown"
}

/** A lista que ESTA máquina mostra, nesta ordem. */
export function buildItems(
  caps: GuideCapabilities,
  probes: ProbeMap,
): GuideItem[] {
  return CATALOG.filter((c) => c.needs === null || caps[c.needs]).map((c) => ({
    id: c.id,
    label: c.label,
    state: stateFromProbe(probes[c.id]),
    target: c.target,
  }))
}

/** Contagem do anel. Só "done" conta: "unknown" nunca vira progresso. */
export function guideProgress(items: readonly GuideItem[]): {
  done: number
  total: number
} {
  return {
    done: items.filter((i) => i.state === "done").length,
    total: items.length,
  }
}

/** Completo = todos os itens marcados por probe. Lista vazia é completa
 *  (máquina sem capacidade nenhuma não fica com guia órfão na sidebar). */
export function isComplete(items: readonly GuideItem[]): boolean {
  return items.every((i) => i.state === "done")
}

/** A linha aparece? Pronto, incompleto e não dispensado. Sai sozinha ao
 *  completar (não precisa de dismissal pra isso), e leitura travada mantém
 *  ela VISÍVEL em vez de sumir para sempre. */
export function shouldShowGuide(p: {
  ready: boolean
  complete: boolean
  dismissed: boolean
}): boolean {
  return p.ready && !p.complete && !p.dismissed
}

/** O que a linha deve renderizar, ou null pra não renderizar nada. */
export interface GuideView {
  items: GuideItem[]
  done: number
  total: number
}

/** A decisão de EXIBIÇÃO inteira, pura. Existe porque a versão anterior morava
 *  no componente e desfazia a própria regra: um fallback de "última contagem
 *  visível" segurava a linha na tela justamente quando o guia completava, e
 *  ela renderizava a contagem velha (4/5) pra sempre, com o clique levando a
 *  uma seção já resolvida. Aqui a ordem das saídas é explícita e testável.
 *
 *  `probes: null` = nenhuma leitura assentou ainda (nada de contagem piscando
 *  no boot). */
export function guideView(p: {
  probes: ProbeMap | null
  caps: GuideCapabilities
  ready: boolean
  dismissed: boolean
  /** Durante o onboarding o wizard já faz esse trabalho; dois lugares cobrando
   *  setup ao mesmo tempo é ruído. */
  onboarded: boolean
}): GuideView | null {
  if (!p.onboarded) return null
  if (p.probes === null) return null
  const items = buildItems(p.caps, p.probes)
  const visible = shouldShowGuide({
    ready: p.ready,
    complete: isComplete(items),
    dismissed: p.dismissed,
  })
  if (!visible) return null
  return { items, ...guideProgress(items) }
}

/** Anel de progresso: o traço a desenhar, com clamps defensivos (total 0 não
 *  divide por zero; done fora da faixa não vaza do anel). */
export function ringDash(
  done: number,
  total: number,
  circumference: number,
): number {
  const t = Math.max(total, 1)
  const d = Math.min(Math.max(done, 0), t)
  return circumference * (1 - d / t)
}
