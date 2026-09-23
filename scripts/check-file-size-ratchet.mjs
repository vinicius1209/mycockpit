#!/usr/bin/env node
/**
 * GUARDA: ratchet de tamanho de arquivo em `app/src` e, desde o ADR-232, em
 * `app/src-tauri/src` (caminhos prefixados com `src-tauri/` na baseline).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SE ESTA GUARDA DISPARAR: DIVIDA O ARQUIVO.                               │
 * │ Nunca suba o teto, nunca edite a baseline pra cima, nunca adicione       │
 * │ exceção. A catraca só gira num sentido.                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Por que isso é guarda e não gosto: `MessageList.tsx` chegou a 2.8k linhas e
 * foi exatamente ali que 11 varreduras O(N) se esconderam. Arquivo grande não
 * é feio, é opaco — ninguém revisa o que não cabe na cabeça.
 *
 * Tetos: 500 linhas (.ts) · 700 (.tsx) · 900 (teste). Arquivo que já estava
 * acima entra na baseline congelado e não pode crescer; arquivo novo nasce
 * abaixo do teto. A baseline SÓ ENCOLHE: quando um arquivo baixa, o número
 * novo vira o limite dele.
 *
 * Uso:
 *   node scripts/check-file-size-ratchet.mjs             verifica
 *   node scripts/check-file-size-ratchet.mjs --update    aperta a catraca
 *   node scripts/check-file-size-ratchet.mjs --bootstrap congela o estado atual
 *
 * `--update` só desce números; ele RECUSA rodar se algum arquivo está acima do
 * limite (senão viraria a válvula de escape que anula a guarda). `--bootstrap`
 * congela o estado atual e existe pra UMA vez: a criação desta guarda. Usar de
 * novo é apagar a catraca.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  avaliarRatchet,
  baselineDesatualizada,
  contarLinhas,
  REGRAS_PADRAO,
} from "./lints/fileSizeRatchet.mjs";
import { lerFontes } from "./lints/walk.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.join(REPO_ROOT, "app", "src");
const RAIZ_RUST = path.join(REPO_ROOT, "app", "src-tauri", "src");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts", "lints", "file-size-baseline.json");
const EXTENSOES = new Set([".ts", ".tsx"]);

const atualizar = process.argv.includes("--update");
const bootstrap = process.argv.includes("--bootstrap");

const baselineEmDisco = await lerBaseline();
const fontes = [
  ...(await lerFontes(RAIZ, EXTENSOES)),
  ...(await lerFontes(RAIZ_RUST, new Set([".rs"]))).map((f) => ({ ...f, relPath: `src-tauri/${f.relPath}` })),
];
const arquivos = fontes.map(({ relPath, source }) => ({
  relPath,
  linhas: contarLinhas(source),
}));

// No bootstrap a baseline de partida é o próprio estado atual: nada viola, e o
// que já está acima do teto sai congelado onde está.
const baseline = bootstrap
  ? Object.fromEntries(arquivos.map(({ relPath, linhas }) => [relPath, linhas]))
  : baselineEmDisco;

const { violacoes, encolheram, obsoletos, baselineNova } = avaliarRatchet(arquivos, baseline, REGRAS_PADRAO);

if (bootstrap) {
  await gravarBaseline(baselineNova);
  console.log(
    `baseline criada · ${Object.keys(baselineNova).length} arquivo(s) congelado(s) em ${caminhoCurto(BASELINE_PATH)}\n` +
      "Daqui pra frente esses números só descem. Se a guarda disparar, divida o arquivo.",
  );
  process.exit(0);
}

if (atualizar) {
  if (violacoes.length > 0) {
    console.error("`--update` recusado: há arquivo acima do limite. Divida o arquivo primeiro.");
    imprimirViolacoes();
    process.exit(1);
  }
  await gravarBaseline(baselineNova);
  console.log(`baseline regravada · ${Object.keys(baselineNova).length} arquivo(s) congelado(s) em ${caminhoCurto(BASELINE_PATH)}`);
  process.exit(0);
}

let falhou = false;

if (violacoes.length > 0) {
  falhou = true;
  console.error(`ratchet de tamanho: ${violacoes.length} arquivo(s) acima do limite`);
  imprimirViolacoes();
  console.error(
    "\nDIVIDA O ARQUIVO. Não suba o teto, não edite a baseline à mão, não adicione exceção.",
  );
}

if (baselineDesatualizada(baseline, baselineNova)) {
  falhou = true;
  console.error("\nratchet de tamanho: baseline frouxa (a catraca precisa apertar)");
  for (const item of encolheram) {
    console.error(`- ${item.relPath}: baseline ${item.de} → ${item.para} linhas (encolheu, o limite acompanha)`);
  }
  for (const relPath of obsoletos) {
    console.error(`- ${relPath}: saiu da baseline (abaixo do teto, renomeado ou apagado)`);
  }
  console.error("\nRode `bun run check:file-size -- --update` e commite a baseline.");
}

if (falhou) process.exit(1);

const total = Object.keys(baselineNova).length;
console.log(
  `ratchet de tamanho ok · ${arquivos.length} arquivos varridos · ${total} na baseline congelada · ` +
    `tetos ${REGRAS_PADRAO.map((r) => `${r.id}:${r.maxLines}`).join(" · ")}`,
);

function imprimirViolacoes() {
  for (const violacao of violacoes) {
    const de = violacao.novo ? "novo" : `baseline ${violacao.baseLines}`;
    console.error(
      `- ${violacao.relPath}: ${violacao.linhas} linhas (${de}, limite ${violacao.limite}, teto ${violacao.regra} ${violacao.teto})`,
    );
  }
}

async function lerBaseline() {
  try {
    const bruto = await fs.readFile(BASELINE_PATH, "utf8");
    const json = JSON.parse(bruto);
    return json.arquivos ?? {};
  } catch (erro) {
    if (erro.code === "ENOENT") return {};
    throw erro;
  }
}

async function gravarBaseline(mapa) {
  const conteudo = {
    _leia:
      "Baseline do ratchet de tamanho (scripts/check-file-size-ratchet.mjs). " +
      "Gerada, não editada à mão. Cada número é o teto CONGELADO daquele arquivo: " +
      "ele não pode crescer, e quando encolher o número desce junto. " +
      "Se a guarda disparar, divida o arquivo.",
    _tetos: Object.fromEntries(REGRAS_PADRAO.map((r) => [r.id, r.maxLines])),
    arquivos: mapa,
  };
  await fs.writeFile(BASELINE_PATH, `${JSON.stringify(conteudo, null, 2)}\n`, "utf8");
}

function caminhoCurto(absoluto) {
  return path.relative(REPO_ROOT, absoluto).split(path.sep).join("/");
}
