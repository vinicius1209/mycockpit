// Soltar arquivos do sistema no composer (capricho PRD R6): regras puras.
// Imagem e PDF viram anexo (a mesma allowlist do Rust); o resto vira menção
// `@caminho`, relativo quando mora no projeto. Pasta vira menção de pasta.

import { MAX_ATTACH_BYTES, MAX_ATTACH_COUNT, MAX_ATTACH_MB } from "@/lib/attachments"

export interface CaminhoSolto {
  path: string
  pasta: boolean
  bytes: number
}

export interface PlanoDaSoltura {
  /** Caminhos absolutos que vão para `attachPath`, na ordem soltada. */
  anexos: string[]
  /** Texto das menções, na ordem soltada. */
  mencoes: string[]
  /** Frases prontas para avisar o que ficou de fora. */
  recusados: string[]
}

/** Extensões que o anexo aceita (espelho de `ext_for_mime` em attachments.rs). */
const ANEXAVEIS = new Set(["png", "jpg", "jpeg", "webp", "gif", "pdf"])

function nomeDe(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function extensao(path: string): string {
  const nome = nomeDe(path)
  const ponto = nome.lastIndexOf(".")
  return ponto > 0 ? nome.slice(ponto + 1).toLowerCase() : ""
}

/** `@src/app.ts` dentro do projeto, `@/caminho/absoluto` fora dele. Caminho
 *  com espaço vai entre aspas, senão a menção termina no primeiro espaço. */
export function mencaoDoCaminho(path: string, projectPath: string | null): string {
  const raiz = projectPath?.replace(/\/+$/, "")
  const relativo = raiz && path.startsWith(`${raiz}/`) ? path.slice(raiz.length + 1) : path
  return /\s/.test(relativo) ? `@"${relativo}"` : `@${relativo}`
}

export function planoDaSoltura(
  itens: readonly CaminhoSolto[],
  contexto: { projectPath: string | null; anexosAtuais: number },
): PlanoDaSoltura {
  const plano: PlanoDaSoltura = { anexos: [], mencoes: [], recusados: [] }
  let anexos = contexto.anexosAtuais
  for (const item of itens) {
    if (!item.pasta && ANEXAVEIS.has(extensao(item.path))) {
      if (item.bytes > MAX_ATTACH_BYTES) {
        plano.recusados.push(`"${nomeDe(item.path)}" excede ${MAX_ATTACH_MB} MB`)
      } else if (anexos >= MAX_ATTACH_COUNT) {
        plano.recusados.push(`"${nomeDe(item.path)}" ficou de fora: máx. ${MAX_ATTACH_COUNT} anexos por mensagem`)
      } else {
        plano.anexos.push(item.path)
        anexos++
      }
      continue
    }
    const mencao = mencaoDoCaminho(item.path, contexto.projectPath)
    if (!plano.mencoes.includes(mencao)) plano.mencoes.push(mencao)
  }
  return plano
}

/** A posição do evento do Tauri vem em pixels físicos; o retângulo do DOM, em
 *  CSS. Dentro do composer? */
export function dentroDoRetangulo(
  posicao: { x: number; y: number },
  escala: number,
  ret: { left: number; top: number; right: number; bottom: number },
): boolean {
  const x = posicao.x / (escala || 1)
  const y = posicao.y / (escala || 1)
  return x >= ret.left && x <= ret.right && y >= ret.top && y <= ret.bottom
}

/** Rótulo do estado de arrasto. */
export function rotuloDaSoltura(quantos: number): string {
  return quantos === 1 ? "Solte para anexar · 1 item" : `Solte para anexar · ${quantos} itens`
}
