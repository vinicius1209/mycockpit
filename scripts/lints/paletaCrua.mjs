#!/usr/bin/env node
// GUARDA: cor da paleta crua do Tailwind não entra — cor no Frota vem de TOKEN.
//
// POR QUE ESTA GUARDA EXISTE
// -------------------------
// Em 16/08/2026 uma passada no popover do medidor entrou com
// `bg-amber-500/15 text-amber-500` e `bg-emerald-500/10 text-emerald-600
// dark:text-emerald-400`. Passou por TODAS as guardas: a de escala só olha
// tamanho de fonte, a de verde-ambiente só olha `st-success`, e a de barra de
// acento só olha filete colado em aresta. Ou seja, o sistema de tokens inteiro
// podia ser contornado sem que nada percebesse — bastava não usar os nomes que
// as regras conheciam.
//
// O estrago não é estético. `--st-warning` e `--st-success` têm PAR claro/escuro
// auditado (o `#3fb950` nativo do GitHub, por exemplo, é ilegível sobre fundo
// claro — está escrito no index.css). `amber-500` não tem par: é o mesmo pixel
// nos dois temas. E o §2 dá a cada tinta UM trabalho; uma cor sem token não tem
// papel declarado, então não há como dizer se ela está sendo usada errado.
//
// A REGRA
// -------
// Status usa `st-*`. Marca usa `brass`. Superfície usa os tokens semânticos
// (`background`, `card`, `rail`, `sel`, `muted`, `border`…). Domínio git usa
// `git-*`. Identidade categórica usa `id-*`. Se falta um papel, o caminho é
// ADR + token novo no `index.css` + linha no §2 — nunca uma cor solta no JSX.

import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, relative } from "node:path"

const RAIZ = fileURLToPath(new URL("../../app/src", import.meta.url))

/** Famílias da paleta padrão do Tailwind. Nenhuma delas tem papel no §2. */
const FAMILIAS = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
].join("|")

// utilidade-de-cor + família + tom (com opacidade e variante opcionais).
// `text-red-500`, `bg-amber-500/15`, `dark:text-emerald-400`, `border-sky-300`.
const PADRAO = new RegExp(
  `\\b(?:dark:|hover:|focus:|active:|group-hover:|data-\\[[^\\]]+\\]:)*` +
    `(?:bg|text|border|ring|fill|stroke|from|via|to|decoration|outline|shadow|accent|caret|divide|placeholder)-` +
    `(?:${FAMILIAS})-(?:50|[1-9]00|950)(?:/\\d{1,3})?\\b`,
  "g",
)

function varrer(dir, saida = []) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    const st = statSync(caminho)
    if (st.isDirectory()) varrer(caminho, saida)
    else if (/\.(tsx?|css)$/.test(nome)) saida.push(caminho)
  }
  return saida
}

const falhas = []
let varridos = 0

for (const arquivo of varrer(RAIZ)) {
  varridos++
  const linhas = readFileSync(arquivo, "utf8").split("\n")
  linhas.forEach((linha, i) => {
    // Comentário que MENCIONA a cor (como o cabeçalho desta guarda, ou um
    // registro histórico de "isto saiu daqui") não é uso.
    const semComentario = linha.replace(/\/\/.*$|\/\*.*?\*\//g, "")
    for (const achado of semComentario.matchAll(PADRAO)) {
      falhas.push(`${relative(RAIZ, arquivo)}:${i + 1}: \`${achado[0]}\``)
    }
  })
}

if (falhas.length) {
  console.error(`paleta crua: ${falhas.length} uso(s) de cor fora do sistema de tokens`)
  for (const f of falhas) console.error(`- ${f}`)
  console.error(
    "\nCor no Frota vem de TOKEN (STYLEGUIDE §2): status em `st-*`, marca em" +
      "\n`brass`, superfície nos semânticos, git em `git-*`, identidade em `id-*`." +
      "\nA paleta crua não tem par claro/escuro auditado nem papel declarado." +
      "\nFalta um papel? ADR + token no index.css + linha no §2 — não cor solta.",
  )
  process.exit(1)
}

console.log(
  `paleta crua ok · ${varridos} arquivos varridos em app/src · ${FAMILIAS.split("|").length} famílias barradas`,
)
