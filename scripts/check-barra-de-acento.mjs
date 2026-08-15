#!/usr/bin/env node
/**
 * GUARDA: a barra de acento não volta (§2 e §10 do STYLEGUIDE, ADR-043).
 *
 * Seleção não é cor. O filete tingido colado numa aresta — a barra brass de
 * 2,5px da sidebar (Fase 1) e o sublinhado brass da aba (Fase 2) — é a forma
 * mais barata de trazer o brass-como-seleção de volta, e ele voltaria em
 * arquivo novo, sem autor, semanas depois. É o cenário que o §0 descreve.
 *
 * SE ESTA GUARDA DISPARAR: a saída é a receita única do §2 — preenchimento
 * neutro (`--sel`) + peso 500 + pip neutro no gutter, com os helpers de
 * `app/src/lib/selection.ts`. Não existe exceção por arquivo aqui: a regra é
 * de forma, não de orçamento.
 *
 * Uso: node scripts/check-barra-de-acento.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { acharBarrasDeAcento } from "./lints/barraDeAcento.mjs";
import { lerFontes } from "./lints/walk.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.join(REPO_ROOT, "app", "src");

const arquivos = await lerFontes(RAIZ, new Set([".ts", ".tsx"]));
const violacoes = acharBarrasDeAcento(arquivos);

if (violacoes.length === 0) {
  console.log(
    `barra de acento ok · ${arquivos.length} arquivos varridos em app/src · ` +
      "nenhum filete tingido colado em aresta",
  );
  process.exit(0);
}

console.error(`barra de acento: ${violacoes.length} violação(ões)`);
for (const v of violacoes) {
  console.error(`- ${v.relPath}:${v.linha}: ${v.trecho}`);
}
console.error(
  "\nSeleção não é cor (§2, ADR-043): preenchimento neutro `--sel` + peso 500 +" +
    " pip neutro no gutter. Use `SELECTED_FILL`/`UNSELECTED` de `lib/selection.ts`.",
);
process.exit(1);
