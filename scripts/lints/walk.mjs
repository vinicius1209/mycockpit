/**
 * I/O compartilhado das guardas: caminhar a árvore e devolver caminho relativo
 * em forma posix (as regras e as exceções são escritas com "/").
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const IGNORADOS = new Set(["node_modules", "dist", ".git", "target", "coverage"]);

/**
 * @param {string} dir
 * @param {Iterable<string>} [ignorarTambem] pastas a pular ALÉM do default.
 *   A catraca de marca varre a raiz do repo e precisa pular `builds/`, que as
 *   guardas de `app/src` nunca alcançam.
 * @returns {Promise<string[]>} caminhos absolutos
 */
export async function listarArquivos(dir, ignorarTambem) {
  const ignorados = ignorarTambem ? new Set([...IGNORADOS, ...ignorarTambem]) : IGNORADOS;
  /** @type {string[]} */
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignorados.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listarArquivos(full, ignorarTambem)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** @param {string} raiz @param {string} absoluto */
export function relPosix(raiz, absoluto) {
  return path.relative(raiz, absoluto).split(path.sep).join("/");
}

/**
 * Lê todos os arquivos de uma raiz com as extensões pedidas.
 *
 * @param {string} raiz
 * @param {Set<string>} extensoes
 * @returns {Promise<Array<{relPath: string, source: string}>>}
 */
export async function lerFontes(raiz, extensoes) {
  const arquivos = await listarArquivos(raiz);
  const alvos = arquivos.filter((abs) => extensoes.has(path.extname(abs)));
  alvos.sort();
  return Promise.all(
    alvos.map(async (abs) => ({
      relPath: relPosix(raiz, abs),
      source: await fs.readFile(abs, "utf8"),
    })),
  );
}
