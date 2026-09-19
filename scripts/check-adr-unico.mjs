#!/usr/bin/env node
/**
 * GUARDA: dois donos para o mesmo número de ADR não é detalhe.
 *
 * A régua e o núcleo testável vivem em `scripts/lints/adrUnico.mjs`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Se ela disparar: renumere a ADR MENOS citada no código, não a mais.      │
 * │ Deixe nota no corpo dela dizendo que mudou e por quê — quem vier pelo    │
 * │ histórico (commit antigo, comentário velho) precisa achar o caminho.     │
 * │ E mantenha a ADR no lugar CRONOLÓGICO: só o id muda, não a data.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { readFileSync } from "node:fs"
import { avaliar } from "./lints/adrUnico.mjs"

const ARQUIVO = "docs/decisions.md"
const { mapa, problemas, proximo } = avaliar(
  readFileSync(new URL(`../${ARQUIVO}`, import.meta.url), "utf8"),
)

if (problemas.length) {
  console.error(`\nADR: ${problemas.length} problema(s) de numeração em ${ARQUIVO}\n`)
  for (const p of problemas) console.error(`- ${p}`)
  console.error(
    `\nO próximo número livre é ${proximo}. Confira a lista antes de numerar:` +
      ` a colisão nasce de duas frentes somando um na mesma última linha.\n`,
  )
  process.exit(1)
}

const nums = [...mapa.keys()].sort((a, b) => a - b)
console.log(
  `ADR ok · ${nums.length} decisões · de ${nums[0]} a ${nums[nums.length - 1]}` +
    ` · sem número repetido nem buraco`,
)
