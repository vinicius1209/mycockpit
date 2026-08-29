#!/usr/bin/env node
/**
 * GUARDA (catraca): o filete tem DOIS papéis (§4 e §14 do STYLEGUIDE).
 *
 * A régua e o núcleo testável vivem em `scripts/lints/filete.mjs`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Se ela disparar, use o set fechado:                                      │
 * │   `border` / `border-border`   ← a ARESTA de uma superfície              │
 * │   `border-border/40`           ← o DIVISOR dentro de uma superfície      │
 * │ Opacidade intermediária é deriva, não decisão: alguém escolheu um degrau │
 * │ perto de onde estava. Nunca edite a baseline pra cima.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Uso:
 *   node scripts/check-filete.mjs             confere
 *   node scripts/check-filete.mjs --update    aperta a catraca
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compararComBaseline } from "./lints/geometriaDeControle.mjs";
import { contarFiletesDerivados, inventario } from "./lints/filete.mjs";
import { lerFontes } from "./lints/walk.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.join(REPO_ROOT, "app", "src");
const BASELINE = path.join(REPO_ROOT, "scripts", "lints", "filete-baseline.json");

const atualizar = process.argv.includes("--update");

const arquivos = await lerFontes(RAIZ, new Set([".ts", ".tsx"]));
const atual = contarFiletesDerivados(arquivos);

/** @type {Record<string, number>} */
let baseline = {};
let existia = true;
try {
  baseline = JSON.parse(await fs.readFile(BASELINE, "utf8"));
} catch {
  existia = false;
  if (!atualizar) {
    console.error(`baseline ausente: ${BASELINE}\nRode com --update pra criá-la.`);
    process.exit(1);
  }
}

const { piorou, folgou } = compararComBaseline(atual, baseline);

if (atualizar) {
  // Bootstrap: sem baseline, TUDO é novo, e recusar aqui seria a catraca se
  // recusando a nascer. A recusa vale a partir da segunda vez, que é quando
  // ela protege de verdade.
  if (existia && piorou.length > 0) {
    console.error(
      "recusando apertar a catraca: há arquivo acima da baseline.\n" +
        "Aperte depois de migrar, não antes — senão o débito novo entra congelado.",
    );
    for (const v of piorou) {
      console.error(`- ${v.relPath}: ${v.de} → ${v.para}${v.novo ? " (novo)" : ""}`);
    }
    process.exit(1);
  }
  const ordenada = Object.fromEntries(
    Object.entries(atual).sort(([a], [b]) => a.localeCompare(b)),
  );
  await fs.writeFile(BASELINE, `${JSON.stringify(ordenada, null, 2)}\n`);
  const total = Object.values(ordenada).reduce((s, n) => s + n, 0);
  console.log(
    `baseline apertada · ${Object.keys(ordenada).length} arquivos · ${total} filetes fora do set` +
      (folgou.length > 0 ? ` · ${folgou.length} arquivo(s) desceram` : ""),
  );
  process.exit(0);
}

if (piorou.length === 0) {
  const total = Object.values(atual).reduce((s, n) => s + n, 0);
  const nota =
    folgou.length > 0
      ? `\n${folgou.length} arquivo(s) desceram: rode --update pra apertar a catraca.`
      : "";
  const tokens = Object.entries(inventario(arquivos))
    .sort(([, a], [, b]) => b - a)
    .map(([t, n]) => `${t}×${n}`)
    .join(" · ");
  console.log(
    `filete ok · ${Object.keys(atual).length} arquivos · ${total} fora do set` +
      `${tokens ? ` (${tokens})` : ""}${nota}`,
  );
  process.exit(0);
}

console.error(`filete: ${piorou.length} arquivo(s) acima da baseline`);
for (const v of piorou) {
  console.error(
    `- ${v.relPath}: ${v.de} → ${v.para}${v.novo ? "  (arquivo novo nasce em ZERO)" : ""}`,
  );
}
console.error(
  "\nO set é fechado (§4): `border` pra ARESTA de superfície, `border-border/40` " +
    "pro DIVISOR interno. Nunca edite a baseline pra cima.",
);
process.exit(1);
