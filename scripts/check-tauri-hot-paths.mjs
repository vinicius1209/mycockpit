#!/usr/bin/env node

import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const contracts = [
  ["app/src-tauri/src/context.rs", ["read_project_context"]],
  ["app/src-tauri/src/sources.rs", ["read_project_sources"]],
  ["app/src-tauri/src/project_files.rs", ["list_dir_children", "search_project_files"]],
  [
    "app/src-tauri/src/conversation_items.rs",
    ["save_conversation_item_changes", "load_conversation_items"],
  ],
]

const failures = []
for (const [relative, functions] of contracts) {
  const source = await fs.readFile(path.join(repo, relative), "utf8")
  for (const name of functions) {
    const command = new RegExp(
      `#\\[tauri::command(?:\\([^)]*\\))?\\]\\s*pub\\s+async\\s+fn\\s+${name}\\b`,
    )
    if (!command.test(source)) failures.push(`${relative}: ${name} deixou de ser async`)
  }
}

if (failures.length) {
  console.error("hot paths Tauri voltaram a bloquear a faixa de interação")
  for (const failure of failures) console.error(`- ${failure}`)
  console.error("Filesystem, processo e SQLite síncronos ficam atrás de comando async.")
  process.exit(1)
}

console.log(`hot paths Tauri ok · ${contracts.flatMap(([, names]) => names).length} comandos async`)
