// O tamanho da página do navegador do projeto (ADR-285). Gêmeo de
// `browser_tamanho.rs`: os presets daqui e de lá são conferidos por teste. A
// emulação mora no Rust; aqui só o que a tela lê e pede.

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

export interface TamanhoDaPagina {
  preset: string
  largura: number
  altura: number
  celular: boolean
  girado: boolean
}

export interface PresetDeTamanho {
  id: string
  rotulo: string
  largura: number
  altura: number
  celular: boolean
  tipo: "celular" | "tablet" | "notebook" | "desktop"
}

export const PRESETS: readonly PresetDeTamanho[] = [
  { id: "celular", rotulo: "Celular", largura: 390, altura: 844, celular: true, tipo: "celular" },
  { id: "celular-grande", rotulo: "Celular grande", largura: 430, altura: 932, celular: true, tipo: "celular" },
  { id: "tablet", rotulo: "Tablet", largura: 820, altura: 1180, celular: true, tipo: "tablet" },
  { id: "notebook", rotulo: "Notebook", largura: 1280, altura: 800, celular: false, tipo: "notebook" },
  { id: "desktop", rotulo: "Desktop", largura: 1440, altura: 900, celular: false, tipo: "desktop" },
]

export const PERSONALIZADO = "personalizado"
export const LADO_MIN = 200
export const LADO_MAX = 3840

export const TAMANHO_PADRAO: TamanhoDaPagina = { preset: "notebook", largura: 1280, altura: 800, celular: false, girado: false }

export function ehPadrao(t: TamanhoDaPagina): boolean {
  return t.preset === "notebook" && !t.girado
}

/** Largura e altura da página, já giradas. Puro. */
export function medidas(t: TamanhoDaPagina): { largura: number; altura: number } {
  return t.girado ? { largura: t.altura, altura: t.largura } : { largura: t.largura, altura: t.altura }
}

/** "Celular", "Personalizado". Puro. */
export function nomeDoTamanho(t: TamanhoDaPagina): string {
  return PRESETS.find((p) => p.id === t.preset)?.rotulo ?? "Personalizado"
}

/** "390×844 · como celular" para a linha embaixo do quadro. Puro. */
export function medidaDoTamanho(t: TamanhoDaPagina): string {
  const { largura, altura } = medidas(t)
  return `${largura}×${altura}${t.celular ? " · como celular" : ""}`
}

/** O pedido de um preset, mantendo a orientação escolhida. Puro. */
export function doPreset(id: string, girado: boolean): TamanhoDaPagina {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[3]
  return { preset: p.id, largura: p.largura, altura: p.altura, celular: p.celular, girado }
}

/** Lado digitado no personalizado, ou null se fora da faixa. Puro. */
export function ladoValido(texto: string): number | null {
  const n = Number(texto.trim())
  return Number.isInteger(n) && n >= LADO_MIN && n <= LADO_MAX ? n : null
}

export async function lerTamanho(projectPath: string): Promise<TamanhoDaPagina> {
  if (!isTauri()) return TAMANHO_PADRAO
  return invoke<TamanhoDaPagina>("browser_tamanho", { projectPath })
}

export async function definirTamanho(projectPath: string, tamanho: TamanhoDaPagina): Promise<TamanhoDaPagina> {
  return invoke<TamanhoDaPagina>("set_browser_tamanho", { projectPath, tamanho })
}
