// Mapa de calor de custo por hora (14 dias × hora) — a seção 3 da
// Retrospectiva (ver o cabeçalho de MissionControl.tsx para a anatomia da
// tela). Saiu de lá porque a Retrospectiva passou do teto de tamanho: este
// bloco é autocontido (só precisa do ledger da janela de 30 dias) e é o único
// consumidor de `hourlyHeatmap`, `peakHour`, `heatTone` e `heatFillPct`.
//
// Ele é um MEDIDOR e obedece a régua única do §2 do STYLEGUIDE: cinza em rampa
// até 60% do pico, âmbar de 60 a 80, vermelho acima. Nada de escala de cor
// própria.

import { useMemo } from "react"
import { SectionTitle } from "@/components/panel/SectionTitle"
import type { LedgerEntry } from "@/lib/db"
import { heatFillPct, heatTone, hourlyHeatmap, peakHour } from "@/lib/retro"
import { fmtCost } from "@/lib/format"

/** A janela do mapa é fixa em 14 dias: é o recorte em que uma célula de hora
 *  ainda é legível, e ele não muda com o seletor da tela. */
const HEATMAP_DAYS = 14

/** O fundo de uma célula do mapa: cinza-rampa até 60% do pico, âmbar de 60 a
 *  80, vermelho acima (a régua ÚNICA de medidor, lib/meter.ts). */
function cellBackground(value: number, peak: number): string {
  const tone = heatTone(value, peak)
  if (tone === "none")
    return "color-mix(in srgb, var(--muted-foreground) 8%, transparent)"
  if (tone === "warn") return "var(--st-queued)"
  if (tone === "danger") return "var(--st-error)"
  return `color-mix(in srgb, var(--muted-foreground) ${heatFillPct(value, peak)}%, transparent)`
}

/** Só existe se alguém gastou algo na janela (§5 camada 2: seção sem conteúdo
 *  não renderiza título nem moldura). */
export function CostHeatmap({ ledger }: { ledger: LedgerEntry[] }) {
  const heat = useMemo(
    () => hourlyHeatmap(ledger, HEATMAP_DAYS, Date.now()),
    [ledger],
  )
  const hottest = useMemo(() => peakHour(heat), [heat])
  if (heat.total <= 0) return null

  return (
    <section aria-label="Mapa de calor de custo por hora">
      <SectionTitle>
        Onde o dinheiro queimou · {HEATMAP_DAYS} dias × hora
      </SectionTitle>
      {/* Densidade: a célula é 10px de altura (padrão de heatmap de
          contribuição) e os rótulos vão com `leading-none` — sem isso, o texto
          de 11px, não a célula, é quem dita a altura da linha, e as 14 linhas
          incham ~45% à toa. A coluna do total é `whitespace-nowrap` com largura
          pro pior caso da janela: número que muda não quebra em duas linhas
          (§B2.1 — quem cede é o rótulo, nunca o número). */}
      <div className="flex flex-col gap-[2px]">
        {heat.days.map((day) => (
          <div key={day.dayStart} className="flex items-center gap-[2px]">
            <span className="w-[46px] shrink-0 font-mono text-[11px] leading-none text-faint tabular-nums">
              {day.label}
            </span>
            {day.hours.map((v, h) => (
              <span
                key={h}
                title={`${day.label}, ${String(h).padStart(2, "0")}h · ${v > 0 ? fmtCost(v) : "sem gasto"}`}
                className="h-2.5 min-w-[6px] flex-1 rounded-[2px]"
                style={{ background: cellBackground(v, heat.peak) }}
              />
            ))}
            <span className="w-[14ch] shrink-0 pl-1.5 text-right font-mono text-[11px] leading-none whitespace-nowrap text-faint tabular-nums">
              {day.total > 0 ? fmtCost(day.total) : ""}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-[2px] pt-0.5">
          <span className="w-[46px] shrink-0" />
          {Array.from({ length: 24 }, (_, h) => (
            <span
              key={h}
              className="min-w-[6px] flex-1 text-center font-mono text-[11px] leading-none text-faint tabular-nums"
            >
              {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
            </span>
          ))}
          <span className="w-[14ch] shrink-0" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-3.5 rounded-[2px]"
            style={{ background: cellBackground(0, heat.peak) }}
          />
          sem gasto
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-3.5 rounded-[2px]"
            style={{ background: cellBackground(heat.peak * 0.3, heat.peak) }}
          />
          até {fmtCost(heat.peak * 0.6)}/h
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-3.5 rounded-[2px]"
            style={{ background: "var(--st-queued)" }}
          />
          {fmtCost(heat.peak * 0.6)} a {fmtCost(heat.peak * 0.8)}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-3.5 rounded-[2px]"
            style={{ background: "var(--st-error)" }}
          />
          daí pra cima
        </span>
        <span className="font-mono text-[11px] text-faint tabular-nums">
          pico {fmtCost(heat.peak)}/h · 60% e 80% do pico, a régua de medidor do
          §2
        </span>
      </div>
      {hottest && (
        <p className="mt-2.5 px-1 text-[13px] text-muted-foreground">
          Hora mais cara:{" "}
          <span className="text-foreground">
            {hottest.dayLabel}, {String(hottest.hour).padStart(2, "0")}h
          </span>{" "}
          <span className="font-mono tabular-nums">
            {fmtCost(hottest.costUsd)}
          </span>
          , {Math.round(hottest.shareOfDay * 100)}% do dia inteiro.
        </p>
      )}
    </section>
  )
}
