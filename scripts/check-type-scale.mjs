#!/usr/bin/env node
/**
 * GUARDA: a escala tipográfica do STYLEGUIDE §3 é fechada.
 *
 * 11 / 12 / 13 / 14 (corpo) + 20 / 30 / 38 (heros declaradas). Mais nada.
 * Meio-pixel não existe, `text-[0.9rem]` não existe, e classe nomeada do
 * Tailwind (`text-sm`) só vive dentro de `components/ui/` (primitives shadcn).
 *
 * SE ESTA GUARDA DISPARAR: mova o valor pra parada mais próxima (o erro já diz
 * qual). Precisa de um tamanho que a escala não tem? Isso é ADR em
 * `docs/decisions.md` + linha no §3, não exceção neste script.
 *
 * Uso: node scripts/check-type-scale.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { acharViolacoesDeEscala, ESCALA, explicarViolacao } from "./lints/typeScale.mjs";
import { lerFontes } from "./lints/walk.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.join(REPO_ROOT, "app", "src");
const EXTENSOES = new Set([".ts", ".tsx", ".css"]);

/**
 * Exceções declaradas. Chave `caminho:trecho` — sempre estreita, sempre com
 * motivo. Hoje: vazia. O SVG da marca (`AgentLogo.tsx`) é o único lugar do app
 * com valor de terceiro embutido e não carrega tamanho de fonte; se um dia
 * carregar, entra aqui com o motivo escrito.
 * @type {Map<string, string>}
 */
const EXCECOES = new Map();

const arquivos = await lerFontes(RAIZ, EXTENSOES);
const violacoes = [];

for (const { relPath, source } of arquivos) {
  for (const hit of acharViolacoesDeEscala(source, relPath)) {
    if (EXCECOES.has(`${relPath}:${hit.trecho}`)) continue;
    violacoes.push({ relPath, ...hit });
  }
}

if (violacoes.length === 0) {
  console.log(`escala tipográfica ok · ${arquivos.length} arquivos varridos em app/src · escala {${ESCALA.join(", ")}}px`);
  process.exit(0);
}

console.error(`escala tipográfica: ${violacoes.length} violação(ões) do STYLEGUIDE §3`);
for (const violacao of violacoes) {
  console.error(`- ${explicarViolacao(violacao)}`);
}
console.error(
  "\nA escala é lei: 11/12/13/14 no corpo, 20/30/38 nas heros declaradas. " +
    "Ênfase acima de 14 se faz com peso (font-medium/semibold), não com tamanho. " +
    "Tamanho novo exige ADR + linha no §3, não exceção aqui.",
);
process.exit(1);
