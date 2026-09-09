// Camada A da inteligência de modelos: wiring do catálogo dinâmico de preços
// (models.dev, snapshot local mantido pelo Rust). O front só dispara o refresh
// (best-effort: rede falhou = silêncio, o snapshot anterior segue valendo) e lê
// o snapshot. O backend resolve o app_data_dir sozinho — invokes sem argumento.

import { invoke } from "@tauri-apps/api/core"
import { hidratarJanelasDoCatalogo } from "@/lib/contextWindow"
import { isTauri } from "@/lib/db"
import { useApp } from "@/store/app"

/** Espelha CatalogModel do Rust (snake_case). Preços em US$/1M tokens. */
export interface CatalogModel {
  provider: string
  id: string
  name: string
  input: number | null
  output: number | null
  cache_read: number | null
  context: number | null
  release_date: string | null
}

/** Baixa/atualiza o snapshot do catálogo (rede). null = falhou (best-effort). */
export async function refreshModelsCatalog(): Promise<number | null> {
  if (!isTauri()) return null
  try {
    const n = await invoke<number>("refresh_models_catalog")
    return typeof n === "number" ? n : null
  } catch {
    return null
  }
}

/** Snapshot local do catálogo. [] = indisponível/sem snapshot (nunca lança). */
export async function getModelsCatalog(): Promise<CatalogModel[]> {
  if (!isTauri()) return []
  try {
    const rows = await invoke<CatalogModel[]>("get_models_catalog")
    if (!Array.isArray(rows)) return []
    // O `limit.context` de cada modelo alimenta o anel de contexto. Fica AQUI,
    // no ponto único de leitura do catálogo, porque o furo de 09/09/2026 foi
    // exatamente uma segunda fonte que ninguém religava: o número certo estava
    // em disco e o anel usava um palpite escrito à mão.
    hidratarJanelasDoCatalogo(rows)
    return rows
  } catch {
    return []
  }
}

/** Preço de um modelo, $/1M tokens, com a procedência (espelho de `ModelPrice`
 *  no Rust). `fromCatalog: false` = veio da tabela SEED embutida, que é preço
 *  de verdade e datado, só não é o catálogo vivo. */
export interface ModelPrice {
  input: number
  cached: number
  output: number
  fromCatalog: boolean
}

/** O app sabe o preço deste modelo? Pergunta à MESMA régua que estima o custo
 *  do turno (pricing.rs), de propósito: se o front reimplementasse o preço,
 *  nasceria uma segunda verdade e o seletor poderia recusar por "sem preço" um
 *  modelo cujo custo o medidor mostra na tela.
 *
 *  `null` = o app não sabe cobrar este modelo (resposta, não falha). Falha de
 *  verdade REJEITA (ADR-017): quem promove precisa distinguir "não tem preço"
 *  de "não deu pra perguntar", senão reprova candidato por erro nosso. */
export async function modelPrice(model: string): Promise<ModelPrice | null> {
  const p = await invoke<ModelPrice | null>("model_price", { model })
  return p ?? null
}

/** Refresh + registro em GlobalSettings (lastCatalogRefresh + catalogCount).
 *  Falha NÃO zera o que já foi registrado; devolve `false` pra quem pediu por
 *  gesto poder dizer que não deu (o boot chama em void, best-effort). */
export async function refreshCatalogIntoSettings(): Promise<boolean> {
  const n = await refreshModelsCatalog()
  if (n === null) return false
  useApp
    .getState()
    .setSettings({ lastCatalogRefresh: Date.now(), catalogCount: n })
  return true
}
