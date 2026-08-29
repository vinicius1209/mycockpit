#!/usr/bin/env node
/**
 * GUARDA (catraca): controle tem altura da ESCADA (§13 do STYLEGUIDE).
 *
 * A régua e o núcleo testável vivem em `scripts/lints/geometriaDeControle.mjs`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Se ela disparar, ADOTE A ESCADA no controle novo:                        │
 * │   className={cn(controle("chip"), "…")}   ← 24px, chrome denso           │
 * │   className={cn(controle("compacto"), …)} ← 28px, secundário em painel   │
 * │   <Button size="padrao">                  ← 32px, controle de superfície │
 * │   <Button>                                ← 36px, ação primária          │
 * │ Nunca edite a baseline pra cima. Degrau novo entra por ADR, não aqui.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Uso:
 *   node scripts/check-geometria-de-controle.mjs             confere
 *   node scripts/check-geometria-de-controle.mjs --update    aperta a catraca
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compararComBaseline,
  contarControlesAMao,
} from "./lints/geometriaDeControle.mjs";
import { lerFontes } from "./lints/walk.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.join(REPO_ROOT, "app", "src");
const BASELINE = path.join(REPO_ROOT, "scripts", "lints", "geometria-baseline.json");

const atualizar = process.argv.includes("--update");

const arquivos = await lerFontes(RAIZ, new Set([".ts", ".tsx"]));
const atual = contarControlesAMao(arquivos);

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
    `baseline apertada · ${Object.keys(ordenada).length} arquivos · ${total} controles à mão` +
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
  console.log(
    `geometria de controle ok · ${Object.keys(atual).length} arquivos · ` +
      `${total} controles à mão na baseline${nota}`,
  );
  process.exit(0);
}

console.error(`geometria de controle: ${piorou.length} arquivo(s) acima da baseline`);
for (const v of piorou) {
  console.error(
    `- ${v.relPath}: ${v.de} → ${v.para}${v.novo ? "  (arquivo novo nasce em ZERO)" : ""}`,
  );
}
console.error(
  "\nUse a escada do §13: controle(\"chip\"|\"compacto\") pro botão à mão, " +
    "<Button size=\"padrao\"|…> pro resto. Nunca edite a baseline pra cima.",
);
process.exit(1);
