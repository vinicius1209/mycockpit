#!/usr/bin/env node
/**
 * GUARDA (catraca): cartão e selo das Configurações vêm do VOCABULÁRIO.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SE ESTA GUARDA DISPARAR: use `Card`/`CardHead`/`CardBody`/`Row`/`Selo`   │
 * │ de `components/settings/parts`. Não suba a baseline, não abra exceção.   │
 * │ A catraca só gira num sentido.                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * O porquê e a medida que a originou estão em `lints/superficies.mjs`.
 *
 * Uso:
 *   node scripts/check-superficies.mjs
 *   node scripts/check-superficies.mjs --update   (só depois de ENCOLHER)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { auditarSuperficies } from "./lints/superficies.mjs";
import { lerFontes } from "./lints/walk.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.join(REPO_ROOT, "app", "src");
const BASELINE = path.join(REPO_ROOT, "scripts", "lints", "superficies-baseline.json");

const atualizar = process.argv.includes("--update");
const fontes = new Map(
  (await lerFontes(RAIZ, new Set([".tsx"]))).map((f) => [f.relPath, f.source]),
);
const baseline = JSON.parse(await fs.readFile(BASELINE, "utf8").catch(() => "{}"));
const { estouros, frouxos, atual } = auditarSuperficies(fontes, baseline);

// Semear é diferente de apertar. Baseline vazia = a catraca está nascendo, e aí
// o estado atual É o teto inicial. Depois disso `--update` só aceita descida —
// senão a catraca viraria um carimbo em qualquer crescimento.
const semeando = Object.keys(baseline).length === 0;

if (atualizar) {
  if (estouros.length && !semeando) {
    console.error("\nsuperfícies: não dá pra atualizar com arquivo ACIMA do teto.\n");
    for (const e of estouros) console.error(`- ${e.arquivo}: ${e.agora} (teto ${e.teto})`);
    process.exit(1);
  }
  const ordenado = Object.fromEntries(Object.entries(atual).sort());
  await fs.writeFile(BASELINE, `${JSON.stringify(ordenado, null, 2)}\n`);
  console.log(`baseline regravada · ${Object.keys(ordenado).length} arquivo(s)`);
  process.exit(0);
}

if (estouros.length) {
  console.error(`\nsuperfícies: ${estouros.length} arquivo(s) com cartão/selo à mão a mais\n`);
  for (const e of estouros) {
    console.error(
      `- ${e.arquivo}: ${e.agora} superfície(s) à mão (limite ${e.teto}${e.teto === 0 ? ", arquivo novo" : ""})`,
    );
  }
  console.error(
    "\nUse `Card`/`CardHead`/`CardBody`/`Row`/`Selo` de components/settings/parts.\n" +
      "A catraca só desce: arquivo novo nasce em zero.\n",
  );
  process.exit(1);
}

if (frouxos.length) {
  console.error("\nsuperfícies: baseline frouxa (a catraca precisa apertar)\n");
  for (const f of frouxos) {
    console.error(`- ${f.arquivo}: baseline ${f.teto} → ${f.agora} (migrou, o limite acompanha)`);
  }
  console.error("\nRode `bun run check:superficies -- --update` e commite a baseline.\n");
  process.exit(1);
}

const total = Object.values(atual).reduce((a, b) => a + b, 0);
console.log(
  `superfícies ok · ${Object.keys(atual).length} arquivo(s) com ${total} superfície(s) à mão · catraca só desce`,
);
