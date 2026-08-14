#!/usr/bin/env node
/**
 * GUARDA: padrões que o STYLEGUIDE já decidiu que NÃO voltam.
 *
 * Hoje são três (as regras vivem em `scripts/lints/deadTokens.mjs`, uma
 * entrada declarativa cada):
 *   · `shadow-md|lg|xl|2xl`  — a elevação tem 3 níveis e só 3 (§4);
 *   · `text-st-success`      — verde é marco raro ou probe real, nunca estado
 *                              ambiente saudável (§2), com ratchet por arquivo;
 *   · travessão em copy de UI — §7, e só em prosa que o usuário LÊ (comentário
 *                              e texto de prompt ficam de fora).
 *
 * SE ESTA GUARDA DISPARAR: quase sempre a saída é usar o token certo (cinza no
 * lugar do verde ambiente, `--shadow-pop` no lugar de `shadow-lg`, vírgula no
 * lugar do travessão). Exceção nova exige ADR em `docs/decisions.md` + linha no
 * STYLEGUIDE, e entra com motivo escrito no mapa da regra.
 *
 * Acrescentar padrão novo = acrescentar um objeto em `DEAD_TOKEN_RULES`.
 *
 * Uso: node scripts/check-dead-tokens.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { avaliarTokensMortos, DEAD_TOKEN_RULES } from "./lints/deadTokens.mjs";
import { lerFontes } from "./lints/walk.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.join(REPO_ROOT, "app", "src");
const EXTENSOES = new Set([".ts", ".tsx"]);

const arquivos = await lerFontes(RAIZ, EXTENSOES);
const { violacoes, excecoesFolgadas } = avaliarTokensMortos(arquivos, DEAD_TOKEN_RULES);

for (const folga of excecoesFolgadas) {
  console.log(
    `nota · ${folga.ruleId}: ${folga.relPath} usa ${folga.uso} de ${folga.max} permitidos. ` +
      "Aperte o número no mapa da regra.",
  );
}

if (violacoes.length === 0) {
  console.log(
    `tokens mortos ok · ${arquivos.length} arquivos varridos em app/src · ` +
      `${DEAD_TOKEN_RULES.length} regras (${DEAD_TOKEN_RULES.map((r) => r.id).join(", ")})`,
  );
  process.exit(0);
}

/** @type {Map<string, typeof violacoes>} */
const porRegra = new Map();
for (const violacao of violacoes) {
  const lista = porRegra.get(violacao.ruleId) ?? [];
  lista.push(violacao);
  porRegra.set(violacao.ruleId, lista);
}

console.error(`tokens mortos: ${violacoes.length} violação(ões)`);
for (const [ruleId, lista] of porRegra) {
  const regra = DEAD_TOKEN_RULES.find((r) => r.id === ruleId);
  console.error(`\n[${ruleId}] ${regra.descricao} (${regra.regra})`);
  for (const violacao of lista) {
    const cota = violacao.permitido > 0 ? ` · exceção do arquivo permite ${violacao.permitido}, achei ${violacao.encontrado}` : "";
    console.error(`- ${violacao.relPath}:${violacao.linha}: ${violacao.trecho}${cota}`);
    if (violacao.dica) console.error(`  ${violacao.dica}`);
  }
}
process.exit(1);
