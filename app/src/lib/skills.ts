import { invoke } from "@tauri-apps/api/core"
import { suggest } from "@/lib/agent"
import { serializeContext } from "@/lib/fusion"
import type { ChatItem } from "@/store/chat"

/** Rascunho de skill: nome (slug), descrição de 1 linha e o corpo markdown. */
export interface SkillDraft {
  name: string
  description: string
  body: string
}

/** Instrução do Haiku: destila o transcript num `/command` REUSÁVEL. O ponto
 *  é generalizar — os PASSOS do workflow, não os detalhes daquela execução. */
const DRAFT_PROMPT = [
  "Você é um DESTILADOR DE SKILLS: transforma uma conversa vencedora entre um",
  "humano e um agente de código num COMANDO REUTILIZÁVEL (formato de slash",
  "command do Claude Code). Extraia o WORKFLOW genérico — os passos que valem",
  "para tarefas parecidas no futuro — e DESCARTE os detalhes específicos desta",
  "execução (nomes de arquivo pontuais, valores, saídas de comando).",
  "Responda ESTRITAMENTE neste formato, sem prosa fora dele:",
  "NOME: <slug curto, minúsculas e hífens, 2-4 palavras>",
  "DESCRIÇÃO: <uma linha explicando quando usar>",
  "CORPO:",
  "<markdown com as instruções/passos reutilizáveis, no imperativo>",
].join(" ")

/** Template mínimo editável (helper off): não bloqueia o fluxo. */
function fallbackDraft(): SkillDraft {
  return {
    name: "nova-skill",
    description: "Descreva quando usar esta skill.",
    body: [
      "# Passos",
      "",
      "1. Descreva o primeiro passo do workflow.",
      "2. ...",
      "",
      "Ajuste este conteúdo antes de salvar.",
    ].join("\n"),
  }
}

/** Faz o parse da resposta do Haiku no formato NOME/DESCRIÇÃO/CORPO. Tolerante:
 *  campos ausentes caem no template. */
export function parseSkillDraft(raw: string): SkillDraft {
  const fb = fallbackDraft()
  const nameM = raw.match(/^\s*NOME:\s*(.+)$/im)
  const descM = raw.match(/^\s*DESCRI[ÇC][ÃA]O:\s*(.+)$/im)
  const bodyM = raw.match(/CORPO:\s*\n?([\s\S]*)$/i)
  const name = nameM?.[1]?.trim()
  const description = descM?.[1]?.trim()
  const body = bodyM?.[1]?.trim()
  return {
    name: name && name.length ? name : fb.name,
    description: description && description.length ? description : fb.description,
    body: body && body.length ? body : fb.body,
  }
}

/** Rascunha uma skill a partir do transcript. Se o helper estiver desligado
 *  (helperModel null) devolve um template mínimo editável — NÃO bloqueia. */
export async function draftSkill(
  cwd: string,
  helperModel: string | null,
  transcript: ChatItem[],
  run: typeof suggest = suggest,
): Promise<SkillDraft> {
  if (!helperModel) return fallbackDraft()
  try {
    const raw = await run(
      helperModel,
      cwd,
      `${DRAFT_PROMPT}\n\n${serializeContext(transcript)}`,
    )
    return parseSkillDraft(raw)
  } catch {
    return fallbackDraft()
  }
}

/** Grava a skill (comando Rust: sanitiza o nome, não sobrescreve por padrão).
 *  Retorna o caminho relativo gravado. Erro sobe pro chamador (ex.: já existe). */
export async function writeSkill(
  projectPath: string,
  name: string,
  content: string,
): Promise<string> {
  return invoke<string>("write_skill", {
    projectPath,
    name,
    content,
  })
}
