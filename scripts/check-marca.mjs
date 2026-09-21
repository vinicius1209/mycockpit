#!/usr/bin/env node
/**
 * GUARDA: o produto se chama Frota, e "mycockpit" só pode DIMINUIR (ADR-222).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SE ESTA GUARDA DISPARAR: TROQUE O NOME.                                  │
 * │ Não adicione exceção, não edite a baseline pra cima. A catraca só gira   │
 * │ num sentido.                                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ATENÇÃO, mudou em 21/09/2026: até a ADR-222 esta guarda cobria só a MARCA
 * VISÍVEL (`MyCockpit` com maiúsculas, em string, dentro de `app/src`), e o
 * cabeçalho dela ensinava que os nomes persistidos (`mycockpit.db`,
 * `.mycockpit/`, `mc.app`, `dev.vinicius.mycockpit`, `mycockpit.flight-plan`,
 * `mc-work`) NÃO mudavam. **Essa decisão foi revogada.** O dono do produto
 * decidiu renomear tudo, e a guarda agora cobre o repositório inteiro, em
 * qualquer casing, inclusive comentário.
 *
 * A UMA exceção permanente é a SQL das migrações: migração é história e não se
 * edita, porque a string já rodou no banco de alguém. Ela vive na baseline como
 * qualquer outra entrada, com a razão registrada em `_permanentes`.
 *
 * Exceção de JANELA (leitura dupla do nome antigo durante a migração) também
 * entra na baseline, mas com prazo escrito: some quando a janela fechar.
 *
 * Uso:
 *   node scripts/check-marca.mjs             verifica
 *   node scripts/check-marca.mjs --update    aperta a catraca
 *   node scripts/check-marca.mjs --bootstrap congela o estado atual (UMA vez)
 *
 * Plano completo do rename: docs/frota-rename-plan.md
 */

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  avaliarMarca,
  baselineDesatualizada,
  contarOcorrencias,
  linhasComMarca,
} from "./lints/marcaRatchet.mjs";
import { relPosix } from "./lints/walk.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts", "lints", "marca-baseline.json");

/** Extensões de texto que importam. Binário e lockfile ficam de fora. */
const EXTENSOES = new Set([
  ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".toml", ".yml", ".yaml", ".html", ".css",
  ".sh", ".plist", ".txt", ".svg", ".sql",
]);

/** Arquivo gerado ou lockfile: o nome ali é consequência, não decisão. A
 *  própria baseline entra aqui, senão ela se conta e a guarda nunca fecha. */
const ARQUIVOS_FORA = new Set([
  "bun.lock", "bun.lockb", "package-lock.json", "Cargo.lock", "marca-baseline.json",
]);

/**
 * O conjunto varrido é o que o GIT considera do repositório: rastreado, mais
 * o não-rastreado que não está ignorado (ou seja, o que entraria num commit).
 *
 * Não é preciosismo. Varrendo o disco cru, a guarda contava
 * `.mycockpit/context/*.md`, que são handoffs LOCAIS e gitignorados: 321
 * arquivos viravam ruído que nunca desceria, e a catraca ficaria travada em
 * lixo de máquina. Quem decide o que é do repositório já é o `.gitignore`.
 */
function arquivosDoRepo() {
  const saida = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return saida.split("\0").filter(Boolean);
}

const atualizar = process.argv.includes("--update");
const bootstrap = process.argv.includes("--bootstrap");

/** @returns {Promise<{baseline: Record<string, number>, meta: object}>} */
async function lerBaseline() {
  try {
    const bruto = JSON.parse(await fs.readFile(BASELINE_PATH, "utf8"));
    const { _leia, _permanentes, _janela, ...arquivos } = bruto;
    return { baseline: arquivos, meta: { _leia, _permanentes, _janela } };
  } catch {
    return { baseline: {}, meta: {} };
  }
}

/** @param {Record<string, number>} baselineNova @param {object} meta */
async function gravarBaseline(baselineNova, meta) {
  const corpo = {
    _leia:
      "Baseline da catraca de marca (scripts/check-marca.mjs, ADR-222). Gerada, não editada à mão. " +
      "Cada número é quantas vezes 'mycockpit' aparece naquele arquivo HOJE, e é o teto dele: " +
      "não pode crescer, e quando baixar o número desce junto. Arquivo fora desta lista tem teto ZERO.",
    _permanentes: meta._permanentes ?? {
      "app/src-tauri/src/lib.rs":
        "Parte das ocorrências é SQL de migração e nome de banco dentro de migração: migração é história e não se edita (ADR-222).",
      "app/src-tauri/src/conversation_items.rs":
        "Strings de migração (pub const FTS_*). Mesma razão: já rodaram no banco de alguém.",
    },
    _janela: meta._janela ?? {
      "_leia":
        "Exceções TEMPORÁRIAS da janela de compatibilidade (leitura dupla do nome antigo). " +
        "Cada uma sai quando a janela fechar, por ADR. Ver docs/frota-rename-plan.md, passo 8.",
    },
    ...baselineNova,
  };
  await fs.writeFile(BASELINE_PATH, `${JSON.stringify(corpo, null, 2)}\n`, "utf8");
}

const alvos = arquivosDoRepo()
  .filter((rel) => EXTENSOES.has(path.extname(rel)))
  .filter((rel) => !ARQUIVOS_FORA.has(path.basename(rel)))
  .sort();

const arquivos = [];
for (const relPath of alvos) {
  let source;
  try {
    source = await fs.readFile(path.join(REPO_ROOT, relPath), "utf8");
  } catch {
    // `ls-files` lista o índice; arquivo apagado e ainda não commitado some daqui.
    continue;
  }
  arquivos.push({ relPath, source, ocorrencias: contarOcorrencias(source) });
}

const { baseline: baselineEmDisco, meta } = await lerBaseline();
const baseline = bootstrap
  ? Object.fromEntries(arquivos.filter((a) => a.ocorrencias > 0).map((a) => [a.relPath, a.ocorrencias]))
  : baselineEmDisco;

// A janela é declarada À MÃO na baseline, com o motivo e o prazo. É a única
// porta para um arquivo NOVO citar o nome antigo, e ela pede uma frase escrita.
const janela = new Set(Object.keys(meta._janela ?? {}).filter((k) => !k.startsWith("_")));
const { violacoes, encolheram, obsoletos, baselineNova, total } = avaliarMarca(
  arquivos,
  baseline,
  janela,
);

if (bootstrap) {
  await gravarBaseline(baselineNova, meta);
  console.log(
    `baseline de marca criada · ${Object.keys(baselineNova).length} arquivo(s) · ` +
      `${total} ocorrência(s) congeladas em ${relPosix(REPO_ROOT, BASELINE_PATH)}\n` +
      "A partir daqui o número SÓ DESCE.",
  );
  process.exit(0);
}

if (violacoes.length) {
  console.error(`\nmarca: ${violacoes.length} arquivo(s) com "mycockpit" a mais do que a catraca permite\n`);
  for (const v of violacoes) {
    const fonte = arquivos.find((a) => a.relPath === v.relPath);
    console.error(`- ${v.relPath}: ${v.ocorrencias} ocorrência(s), teto ${v.base}${v.novo ? " (arquivo novo ou já limpo)" : ""}`);
    for (const { linha, texto } of linhasComMarca(fonte.source).slice(0, 5)) {
      console.error(`    ${v.relPath}:${linha}: ${texto.slice(0, 110)}`);
    }
  }
  console.error(
    "\nO produto se chama Frota (ADR-222). Troque o nome.\n" +
      "Se for nome PERSISTIDO (banco, pasta, chave, identificador), ele também muda,\n" +
      "mas com janela de leitura dupla: ver docs/frota-rename-plan.md.\n",
  );
  process.exit(1);
}

if (atualizar) {
  await gravarBaseline(baselineNova, meta);
  console.log(
    `baseline de marca regravada · ${Object.keys(baselineNova).length} arquivo(s) · ${total} ocorrência(s)`,
  );
  process.exit(0);
}

if (baselineDesatualizada(baseline, baselineNova)) {
  if (encolheram.length) {
    console.error(`\nmarca: ${encolheram.length} arquivo(s) melhoraram e a baseline não acompanhou\n`);
    for (const e of encolheram.slice(0, 20)) console.error(`- ${e.relPath}: ${e.de} → ${e.para}`);
  }
  if (obsoletos.length) {
    console.error(`\n${obsoletos.length} entrada(s) obsoleta(s) (arquivo limpo, apagado ou renomeado):`);
    for (const o of obsoletos.slice(0, 20)) console.error(`- ${o}`);
  }
  console.error("\nRode `bun run check:marca -- --update` e commite a baseline.\n");
  process.exit(1);
}

console.log(
  `marca ok · ${alvos.length} arquivos varridos · ${total} ocorrência(s) de "mycockpit" restantes · produto: Frota`,
);
