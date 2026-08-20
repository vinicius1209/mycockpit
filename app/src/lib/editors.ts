// Abrir no editor (M1) — a parte que dá pra testar sem editor instalado.
//
// Quem detecta e quem abre é o Rust (`editor.rs`), que é onde mora a contenção
// do caminho. Aqui fica uma regra de produto só: qual editor usar quando existe
// mais de um na máquina.
//
// O alvo é sempre o PROJETO (o Rust manda a raiz junto): abrir arquivo solto
// entrega uma janela órfã, sem árvore nem language server. O `rel`/`line`
// continuam no contrato porque o editor aceita focar um arquivo DENTRO do
// projeto aberto — hoje ninguém usa, e quem usar não precisa mexer no Rust.

import { invoke } from "@tauri-apps/api/core"

export interface DetectedEditor {
  id: string
  label: string
}

/** Editores presentes nesta máquina, em ordem de preferência do registro. */
export async function detectEditors(): Promise<DetectedEditor[]> {
  return invoke<DetectedEditor[]>("detect_editors")
}

/** Abre um arquivo do projeto (ou a raiz, com `rel` vazio) no editor. */
export async function openInEditor(p: {
  editor: string
  projectPath: string
  rel: string
  line?: number | null
}): Promise<void> {
  return invoke("open_in_editor", {
    editor: p.editor,
    projectPath: p.projectPath,
    rel: p.rel,
    line: p.line ?? null,
  })
}

/**
 * Qual editor abrir no clique.
 *
 * A preferência do usuário só vale enquanto o editor ESTIVER instalado — quem
 * escolheu Cursor e desinstalou não pode ficar com um botão que só dá erro. Sem
 * preferência válida, cai no primeiro detectado (a ordem do registro Rust).
 */
export function pickEditor(
  detected: readonly DetectedEditor[],
  preferred: string | null,
): DetectedEditor | null {
  if (detected.length === 0) return null
  return detected.find((e) => e.id === preferred) ?? detected[0]
}
