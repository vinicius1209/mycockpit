#!/usr/bin/env node
/**
 * Extrai um fio REAL do banco para a fixture de fluidez.
 *
 * Por que existe: ADR-016 — fixture inventada esconde bug, e já escondeu. O
 * caso da fluidez é ainda mais estrito que o normal, porque `continuesProse`
 * (`messageNodes.ts`) decide a ESTRUTURA DE NÓS lendo o CONTEÚDO do texto (o
 * último caractere do trecho anterior, a caixa da primeira letra do seguinte,
 * marcador de markdown). Prosa fabricada muda a contagem de nós, e a contagem
 * de nós é exatamente o que a guarda mede. Não há atalho: o payload é real.
 *
 * Este script é a PROVENIÊNCIA da fixture. Sem ele, o arquivo de 2 MB em
 * `app/src/test/` seria um blob sem origem que ninguém sabe refazer.
 *
 * Uso:
 *   node scripts/extrair-fio-real.mjs <caminho-do-db> [id-da-conversa]
 *
 * Sem id, escolhe a conversa com mais itens. Escreve
 * `app/src/test/fio-real.json` e imprime o perfil estrutural para o cabeçalho
 * da guarda.
 */

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = path.join(REPO_ROOT, "app", "src", "test", "fio-real.json");

function sql(db, query) {
  return execFileSync("sqlite3", [db, query], { encoding: "utf8", maxBuffer: 1 << 28 });
}

const db = process.argv[2];
if (!db) {
  console.error("uso: node scripts/extrair-fio-real.mjs <caminho-do-db> [id]");
  process.exit(2);
}

let id = process.argv[3];
if (!id) {
  // Mais ITENS, não mais bytes: o que a guarda mede escala com a contagem de
  // itens do fio, não com o tamanho do payload das tools.
  const linhas = sql(
    db,
    "select id, json_array_length(items) from conversations order by 2 desc limit 1;",
  ).trim();
  id = linhas.split("|")[0];
}

const items = JSON.parse(sql(db, `select items from conversations where id='${id}';`));

const kinds = {};
for (const it of items) kinds[it.kind] = (kinds[it.kind] ?? 0) + 1;

await fs.writeFile(DESTINO, JSON.stringify(items), "utf8");

const bytes = (await fs.stat(DESTINO)).size;
console.log(`fio: ${id}`);
console.log(`itens: ${items.length}`);
console.log(`bytes: ${bytes} (${(bytes / 1048576).toFixed(2)} MB)`);
console.log(`kinds: ${JSON.stringify(kinds)}`);
