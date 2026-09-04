import { invoke } from "@tauri-apps/api/core"
import { generateUtilityText } from "@/lib/utility"
import { loadGitDiffStaged } from "@/lib/git"
import { isTauri } from "@/lib/db"

export interface GeneratedCommitMessage {
  title: string
  body: string
}

/** Teto de caracteres de diff enviado ao prompt para não estourar contexto/custo. */
export const MAX_DIFF_CHARS_FOR_AI = 30_000

export function parseCommitSuggestion(raw: string): GeneratedCommitMessage {
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim()
  const lines = clean.split("\n")
  const title = lines[0]?.trim() ?? ""
  const rest = lines.slice(1).join("\n").trim()
  return { title, body: rest }
}

export function buildCommitPrompt(diff: string): string {
  const truncated =
    diff.length > MAX_DIFF_CHARS_FOR_AI
      ? diff.slice(0, MAX_DIFF_CHARS_FOR_AI) + "\n... [diff truncado]"
      : diff

  return `Você é um assistente sênior de desenvolvimento de software. Gere uma mensagem de commit profissional, concisa e precisa seguindo o padrão Conventional Commits com base no diff fornecido.

Regras fundamentais:
1. Primeira linha (título): <tipo>(<escopo opcional>): <resumo no imperativo em pt-BR>, com no máximo 72 caracteres (idealmente <= 50). Exemplos de tipo: feat, fix, refactor, chore, docs, test, style, perf.
2. Deixe uma linha em branco após o título.
3. Se houver mais detalhes relevantes, adicione uma lista de tópicos (bullets com "- ") concisa explicando o que mudou e o porquê.
4. Não use blocos de formatação markdown (\`\`\`) em volta da resposta.
5. Não adicione saudações ou preâmbulos como "Aqui está a mensagem:". Devolva apenas o texto cru do commit.

Diff das alterações:
${truncated}`
}

export async function generateCommitMessage(
  cwd: string,
  helperModel: string,
): Promise<GeneratedCommitMessage | null> {
  // 1. Puxa diff staged; se vazio, puxa o diff geral
  let patch = await loadGitDiffStaged(cwd)
  if (!patch.trim() && isTauri()) {
    const raw = await invoke<{ patch: string }>("git_diff", { cwd })
    patch = raw.patch
  }
  if (!patch.trim()) return null

  const prompt = buildCommitPrompt(patch)
  const raw = await generateUtilityText({
    task: "commit_message",
    model: helperModel,
    cwd,
    prompt,
  })
  if (!raw.trim()) return null
  const suggestion = parseCommitSuggestion(raw)
  return suggestion.title ? suggestion : null
}
