// Deslizador por ETAPAS: trilho fino, um ponto por etapa e um botão redondo.
// Escolha discreta com cara de gradação, onde uma faixa de botões gritaria
// (o esforço do seletor de motor, ADR-282). Semântica de slider: setas,
// Home/End, clique no trilho e arrasto.

import { useRef, type KeyboardEvent, type PointerEvent } from "react"
import { cn } from "@/lib/utils"

export interface Etapa {
  value: string
  label: string
}

/** Índice da etapa mais perto de um ponto do trilho (0 a 1). Puro. */
export function etapaMaisPerto(fracao: number, total: number): number {
  if (total <= 1) return 0
  const f = Math.min(1, Math.max(0, fracao))
  return Math.round(f * (total - 1))
}

export function DeslizadorDeEtapas({
  etapas,
  value,
  onChange,
  disabled,
  rotulo,
}: {
  etapas: readonly Etapa[]
  /** Valor atual; fora das etapas (ex.: "deixa o motor escolher"), sem botão. */
  value: string | null
  onChange: (value: string) => void
  disabled?: boolean
  rotulo: string
}) {
  const trilho = useRef<HTMLDivElement>(null)
  const idx = etapas.findIndex((e) => e.value === value)
  const total = etapas.length
  const pos = (i: number) => (total <= 1 ? 0 : (i / (total - 1)) * 100)

  const escolherPeloPonto = (clientX: number) => {
    const r = trilho.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    const i = etapaMaisPerto((clientX - r.left) / r.width, total)
    if (etapas[i] && i !== idx) onChange(etapas[i].value)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    escolherPeloPonto(e.clientX)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    escolherPeloPonto(e.clientX)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || total === 0) return
    const atual = idx < 0 ? 0 : idx
    const alvo =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? Math.min(total - 1, idx < 0 ? 0 : atual + 1)
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? Math.max(0, idx < 0 ? 0 : atual - 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? total - 1
              : null
    if (alvo == null) return
    e.preventDefault()
    if (alvo !== idx) onChange(etapas[alvo].value)
  }

  return (
    <div className={cn("select-none", disabled && "opacity-50")}>
      <div
        ref={trilho}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={rotulo}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, total - 1)}
        aria-valuenow={idx < 0 ? undefined : idx}
        aria-valuetext={idx < 0 ? "o motor escolhe" : etapas[idx].label}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        className="relative mx-2 flex h-5 cursor-pointer items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="absolute inset-x-0 h-1 rounded-full bg-secondary ring-1 ring-border ring-inset" />
        {idx >= 0 && <div className="absolute left-0 h-1 rounded-full bg-foreground" style={{ width: `${pos(idx)}%` }} />}
        {etapas.map((e, i) =>
          i === idx ? null : (
            <div
              key={e.value}
              className="absolute size-1 -translate-x-1/2 rounded-full bg-faint"
              style={{ left: `${pos(i)}%` }}
            />
          ),
        )}
        {idx >= 0 && (
          <div
            className="absolute size-4 -translate-x-1/2 rounded-full border border-border-strong bg-card shadow-[var(--shadow-sm)] transition-[left] duration-150"
            style={{ left: `${pos(idx)}%` }}
          />
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-faint">
        {etapas.map((e, i) => (
          <button
            key={e.value}
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => i !== idx && onChange(e.value)}
            className={cn("transition-colors hover:text-foreground", i === idx && "font-medium text-foreground")}
          >
            {e.label}
          </button>
        ))}
      </div>
    </div>
  )
}
