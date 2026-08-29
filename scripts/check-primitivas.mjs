#!/usr/bin/env node
/**
 * GUARDA: superfície nova sai da primitiva certa (§12 do STYLEGUIDE).
 *
 * A régua completa e o núcleo testável vivem em `scripts/lints/primitivas.mjs`.
 *
 * Uso: node scripts/check-primitivas.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { acharPrimitivasErradas, comoConsertar } from "./lints/primitivas.mjs";
import { lerFontes } from "./lints/walk.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.join(REPO_ROOT, "app", "src");

const arquivos = await lerFontes(RAIZ, new Set([".ts", ".tsx"]));
const violacoes = acharPrimitivasErradas(arquivos);

if (violacoes.length === 0) {
  console.log(
    `primitivas ok · ${arquivos.length} arquivos varridos em app/src · ` +
      "vendor só em components/ui, nenhum menu vestido de painel",
  );
  process.exit(0);
}

console.error(`primitivas: ${violacoes.length} violação(ões)`);
for (const v of violacoes) {
  console.error(`- ${v.relPath}:${v.linha}: ${v.trecho}`);
}

const regras = [...new Set(violacoes.map((v) => v.regra))];
console.error("");
for (const regra of regras) {
  console.error(`${regra}: ${comoConsertar(regra)}`);
}
process.exit(1);
