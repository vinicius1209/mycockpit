/** AMBIENTE do prédio — lógica PURA (sem Pixi, sem DOM): fase do dia pela hora
 *  real, paleta de luz por fase, geometria dos cartões do kanban do whiteboard,
 *  estatísticas da TV da sala comum, janela das caixas de mudança e contagem da
 *  pilha de entregas do boss. 100% testável (environment.test.ts).
 *
 *  Regra de ouro (§ princípios): tudo aqui REFLETE estado real — hora do
 *  relógio, snapshot do runtime — nunca teatro aleatório. */

import type { OfficeMissionPhaseStatus } from "../engine/types"

// ---------------------------------------------------------------------------
// Dia/noite REAL — fase do dia pela hora local
// ---------------------------------------------------------------------------

export type DayPhase = "morning" | "midday" | "afternoon" | "night"

/** Fase do dia pela hora REAL (0–23): manhã 6–11 (luz fria suave), meio-dia
 *  11–15 (neutra), tarde 15–19 (quente — o crepúsculo 18–19 fica na luz
 *  quente), noite 19–6 (escurecida, luminárias acesas). */
export function dayPhase(hour: number): DayPhase {
  if (hour >= 19 || hour < 6) return "night"
  if (hour < 11) return "morning"
  if (hour < 15) return "midday"
  return "afternoon"
}

export type DaylightSpec = {
  /** Cor do quad de tint por sala (multiplicado pelo alpha abaixo). */
  overlayColor: number
  /** 0 ⇒ overlay invisível (meio-dia neutro). SUTIL por princípio. */
  overlayAlpha: number
  /** Tint multiplicativo do piso do corredor/laje (faixa externa). */
  groundTint: number
  /** Multiplicador dos alphas do glow das luminárias (aceso à noite). */
  lampBoost: number
  /** Tint das luminárias (âmbar mais quente à noite). */
  lampTint: number
}

/** Paleta por fase — direção de arte intacta: overlays de baixíssimo alpha,
 *  nunca re-tesselação (só tint/alpha em objetos já desenhados). */
export const DAYLIGHT: Record<DayPhase, DaylightSpec> = {
  morning: {
    overlayColor: 0xbcd6ee,
    overlayAlpha: 0.05,
    groundTint: 0xeaf1f8,
    lampBoost: 1,
    lampTint: 0xffe79b,
  },
  midday: {
    overlayColor: 0xffffff,
    overlayAlpha: 0,
    groundTint: 0xffffff,
    lampBoost: 1,
    lampTint: 0xffe79b,
  },
  afternoon: {
    overlayColor: 0xffb46a,
    overlayAlpha: 0.06,
    groundTint: 0xffeacf,
    lampBoost: 1,
    lampTint: 0xffe79b,
  },
  night: {
    overlayColor: 0x0d1530,
    overlayAlpha: 0.16,
    groundTint: 0x8b91a8,
    lampBoost: 1.9,
    lampTint: 0xffc36b,
  },
}

// ---------------------------------------------------------------------------
// Whiteboard = kanban da missão (RoomSnapshot.mission)
// ---------------------------------------------------------------------------

/** Cor do cartão por status da fase (tokens sage do app — mesma família do
 *  DARK_TOKEN_FALLBACK de scene/logic). running pulsa na cena (alpha). */
export const KANBAN_COLORS: Record<OfficeMissionPhaseStatus, number> = {
  done: 0x5bd6a0,
  running: 0x5bb8e8,
  queued: 0x9aa39c,
  error: 0xf2766b,
  aborted: 0x687078,
}

export type KanbanRect = { x: number; y: number; w: number; h: number }

/** Área útil do quadro branco (coords locais planas do prop whiteboard —
 *  a cena cisalha y += x/2 ao desenhar). */
export const KANBAN_AREA = { x: -41, y: -79, w: 82, h: 32 } as const

/** Geometria dos N cartões numa fileira centrada dentro da área útil.
 *  Cartão nunca passa de 20px de largura; gap fixo; n<=0 ⇒ []. */
export function kanbanCardRects(
  n: number,
  area: { x: number; y: number; w: number; h: number } = KANBAN_AREA,
): KanbanRect[] {
  if (n <= 0) return []
  const gap = 4
  const w = Math.min(20, (area.w - (n - 1) * gap) / n)
  if (w <= 0) return []
  const h = Math.min(24, area.h)
  const total = n * w + (n - 1) * gap
  const x0 = area.x + (area.w - total) / 2
  const y = area.y + (area.h - h) / 2
  const rects: KanbanRect[] = []
  for (let i = 0; i < n; i++) {
    rects.push({ x: x0 + i * (w + gap), y, w, h })
  }
  return rects
}

// ---------------------------------------------------------------------------
// TV da sala comum — custo total do dia + top-3 salas
// ---------------------------------------------------------------------------

export type TvStats = {
  totalUsd: number
  /** Até 3 barras (maiores custos > 0), frações relativas ao maior custo. */
  bars: { frac: number; color?: string }[]
}

/** Estatísticas REAIS do snapshot para a tela da TV. Salas sem custo não
 *  ganham barra; frações relativas ao maior custo (sempre ≤ 1). */
export function tvStats(
  rooms: readonly { costUsd: number; color?: string }[],
): TvStats {
  let totalUsd = 0
  for (const r of rooms) totalUsd += r.costUsd
  const top = [...rooms]
    .filter((r) => r.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 3)
  const max = top[0]?.costUsd ?? 0
  return {
    totalUsd,
    bars: top.map((r) => ({ frac: max > 0 ? r.costUsd / max : 0, color: r.color })),
  }
}

/** Formato curto pt-BR do custo na TV ("US$ 12,34"). */
export function formatTvUsd(v: number): string {
  return `US$ ${v.toFixed(2).replace(".", ",")}`
}

// ---------------------------------------------------------------------------
// Caixas de mudança — sala nova depois do boot fica ~2min com caixas
// ---------------------------------------------------------------------------

export const MOVING_BOX_MS = 120_000
export const MOVING_BOX_FADE_MS = 3_000

/** Alpha das caixas pela idade da sala nova: 1 até começar o fade, decai
 *  linearmente nos últimos MOVING_BOX_FADE_MS, 0 ⇒ remover. */
export function movingBoxAlpha(elapsedMs: number): number {
  if (elapsedMs <= MOVING_BOX_MS - MOVING_BOX_FADE_MS) return 1
  return Math.max(0, (MOVING_BOX_MS - elapsedMs) / MOVING_BOX_FADE_MS)
}

// ---------------------------------------------------------------------------
// Pilha de entregas na mesa do boss
// ---------------------------------------------------------------------------

export const DELIVERY_PILE_MAX = 8

/** Papéis visíveis na pilha: clamp 0..8 (0 ⇒ mesa limpa). */
export function deliveryPileCount(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(DELIVERY_PILE_MAX, Math.floor(n)))
}
