#!/usr/bin/env node
// GUARDA: avisos só pela porta única (ADR-261). O porquê mora no núcleo,
// `lints/avisos.mjs`.

import { fileURLToPath } from "node:url"
import { lerFontes } from "./lints/walk.mjs"
import { acharAvisosCrus } from "./lints/avisos.mjs"

const RAIZ = fileURLToPath(new URL("../app/src", import.meta.url))
const fontes = await lerFontes(RAIZ, new Set([".ts", ".tsx"]))
const falhas = fontes.flatMap(({ relPath, source }) => acharAvisosCrus(relPath, source))

if (falhas.length) {
  console.error("avisos: fora da porta única")
  for (const f of falhas) console.error(`- ${f}`)
  console.error("\nADR-261: pedido é cartão da fila; feito, nota, evento e erro passam por `avisar`.")
  process.exit(1)
}
console.log(`avisos ok · ${fontes.length} arquivos · sonner só na porta, sem caixa nativa`)
