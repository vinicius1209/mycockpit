#!/usr/bin/env node
// GUARDA: a esteira do "rodando" tem que degradar sem movimento.
//
// POR QUE É GUARDA E NÃO TESTE UNITÁRIO
// ------------------------------------
// Isto é invariante de CSS: prova-se lendo o arquivo, não renderizando
// componente. A primeira versão morava em `ConversationSlot.test.tsx` lendo o
// `index.css` com `node:fs`, e isso não podia dar certo: o `tsconfig.app.json`
// declara `types: ["vite/client"]` e cobre `src` inteiro, então nenhum teste de
// lá tem os tipos de Node. Passava no vitest (que não checa tipo) e quebrava só
// no `bun run build`. A segunda tentativa, `import "@/index.css?raw"`, volta
// STRING VAZIA sob o vitest — o pipeline de CSS do Tailwind intercepta — e uma
// asserção contra string vazia passa a testar nada.
//
// Aqui, em Node puro na raiz do repo, ler arquivo é o gesto natural.
//
// A REGRA (ADR-043)
// -----------------
// "Rodando" é o único estado da árvore que se move, e o movimento só é honesto
// porque o turno termina sozinho. Quem pede `prefers-reduced-motion` não pode
// ficar sem o sinal: o bloco global do app só encurta a duração
// (`animation-duration: 0.001ms`), o que congelaria a esteira num quadro
// transparente e deixaria "rodando" MUDO. Por isso a `.conv-wire` precisa de
// regra PRÓPRIA que troque movimento por um traço estático e visível.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const css = readFileSync(
  fileURLToPath(new URL("../../app/src/index.css", import.meta.url)),
  "utf8",
)

const falhas = []

const bloco = css.match(
  /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.conv-wire\s*\{([^}]*)\}/,
)
if (!bloco) {
  falhas.push(
    "falta o bloco `@media (prefers-reduced-motion: reduce) { .conv-wire { … } }`",
  )
} else {
  const regra = bloco[1]
  if (!/animation:\s*none\s*!important/.test(regra)) {
    falhas.push(
      "o bloco reduced-motion da .conv-wire não desliga a animação (`animation: none !important`)",
    )
  }
  // Estático mas VISÍVEL: traço azul sólido, não o gradiente parado (que é
  // transparente na maior parte do ciclo).
  if (!/background:\s*var\(--st-running\)/.test(regra)) {
    falhas.push(
      "o bloco reduced-motion da .conv-wire não deixa um traço visível (`background: var(--st-running)`)",
    )
  }
}

if (!/@keyframes conv-wire/.test(css)) {
  falhas.push("sumiu o `@keyframes conv-wire`")
}
if (!/animation:\s*conv-wire\s+[\d.]+s[^;]*infinite/.test(css)) {
  falhas.push(
    "a .conv-wire não está presa a uma animação CSS infinita — se o movimento virou timer de JS, a esteira pode sobreviver ao fim do turno",
  )
}

if (falhas.length) {
  console.error("esteira do 'rodando': regra de movimento violada")
  for (const f of falhas) console.error(`- ${f}`)
  console.error(
    "\nADR-043: movimento é pra vivo, e quem pede reduced-motion não pode ficar sem o sinal.",
  )
  process.exit(1)
}

console.log("esteira do 'rodando' ok · reduced-motion com traço estático · animação em CSS")
