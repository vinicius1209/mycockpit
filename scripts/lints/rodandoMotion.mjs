#!/usr/bin/env node
// GUARDA: o círculo do "rodando" tem que degradar sem movimento.
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
// (`animation-duration: 0.001ms`), o que congelaria o anel num arco quebrado —
// que lê como falha de renderização, não como estado. Por isso a `.conv-spin`
// precisa de regra PRÓPRIA que troque movimento pelo mesmo ponto sólido dos
// outros estados do slot (pede/falhou): vocabulário único na coluna.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const css = readFileSync(
  fileURLToPath(new URL("../../app/src/index.css", import.meta.url)),
  "utf8",
)

const falhas = []

const bloco = css.match(
  /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.conv-spin\s*\{([^}]*)\}/,
)
if (!bloco) {
  falhas.push(
    "falta o bloco `@media (prefers-reduced-motion: reduce) { .conv-spin { … } }`",
  )
} else {
  const regra = bloco[1]
  if (!/animation:\s*none\s*!important/.test(regra)) {
    falhas.push(
      "o bloco reduced-motion da .conv-spin não desliga a animação (`animation: none !important`)",
    )
  }
  // Estático mas VISÍVEL: o mesmo ponto azul sólido dos outros estados — um
  // anel de borda transparente parado não desenharia nada.
  if (!/background:\s*var\(--st-running\)/.test(regra)) {
    falhas.push(
      "o bloco reduced-motion da .conv-spin não deixa um ponto visível (`background: var(--st-running)`)",
    )
  }
}

if (!/@keyframes conv-spin/.test(css)) {
  falhas.push("sumiu o `@keyframes conv-spin`")
}
if (!/animation:\s*conv-spin\s+[\d.]+s[^;]*infinite/.test(css)) {
  falhas.push(
    "a .conv-spin não está presa a uma animação CSS infinita — se o movimento virou timer de JS, o círculo pode sobreviver ao fim do turno",
  )
}

// O SINAL DE VIVO (ADR-256, ADR-259): o "rodando" saiu da `.conv-spin` (que
// segue como carregamento) para o `CometaVivo` e o `TextoVivo`, movidos por um
// relógio único em JS, porque `@keyframes` congela na oclusão da janela do
// macOS. As duas condições do §6 continuam, cobradas no fonte: o relógio
// respeita reduced-motion (pose parada e visível) e os sinais não dependem de
// animação de CSS, que era o que travava.
const ler = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
const relogio = ler("../../app/src/lib/relogioDoVivo.ts")
if (!/prefers-reduced-motion: reduce/.test(relogio)) {
  falhas.push("o relógio do vivo não respeita `prefers-reduced-motion` (lib/relogioDoVivo.ts)")
}
// Sem comentários: os próprios arquivos explicam por que NÃO usam `@keyframes`.
for (const sinal of ["components/ui/cometa-vivo.tsx", "components/ui/texto-vivo.tsx"]) {
  const fonte = ler(`../../app/src/${sinal}`).replace(/\/\/.*$/gm, "")
  if (/animate-(?:spin|pulse|cockpit)|@keyframes/.test(fonte)) {
    falhas.push(`o sinal de vivo voltou a depender de animação de CSS (${sinal})`)
  }
}

if (falhas.length) {
  console.error("círculo do 'rodando': regra de movimento violada")
  for (const f of falhas) console.error(`- ${f}`)
  console.error(
    "\nADR-043: movimento é pra vivo, e quem pede reduced-motion não pode ficar sem o sinal.",
  )
  process.exit(1)
}

console.log("sinal de 'rodando' ok · .conv-spin com ponto estático · cometa e texto vivos pelo relógio, com reduced-motion")
