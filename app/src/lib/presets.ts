// AGENT PRESETS (Sprint 3 · E2) — personas nomeadas, versionadas por DIGEST,
// montadas fail-closed. O núcleo é PURO e testável (digest canônico, bloco de
// persona, decisão de injeção, preflight, veredito de drift); os orquestradores
// no fim compõem DB (lib/db) + inventário de comandos (lib/sources) + toast.
//
// A persona entra como as lições do learning.ts: BLOCO prependido ao PROMPT do
// PRIMEIRO turno da conversa (o resume nativo do CLI carrega o contexto daí em
// diante). Mission e Fusion ficam FORA — têm contexto/personas próprios.
//
// Limitação aceita no v1 (plano, correção 7): o digest cobre os NOMES das
// skills, não o conteúdo dos arquivos .md — drift de conteúdo não é detectado.

import { toast } from "sonner"
import { getPreset, isTauri, type AgentPreset } from "@/lib/db"
import { readProjectCommands } from "@/lib/sources"

// ---------------------------------------------------------------------------
// Digest canônico
// ---------------------------------------------------------------------------

/** Campos que ENTRAM no digest — a identidade comportamental do preset.
 *  Nome/ids ficam de fora (renomear não muda o comportamento). */
export interface PresetDigestInput {
  personalityMd: string
  skills: string[]
  policy: string | null
  backend: string
  model: string | null
  effort: string | null
}

/** SHA-256 (hex minúsculo) da serialização canônica ESTÁVEL do preset:
 *  chaves em ordem fixa, skills ORDENADAS (a ordem de digitação não é
 *  identidade), null explícito para ausentes. Qualquer mudança de campo
 *  muda o hash; reordenar skills não. */
export async function presetDigest(p: PresetDigestInput): Promise<string> {
  // ordem de chaves FIXA no literal (JSON.stringify preserva a ordem de
  // inserção) — é o contrato de estabilidade do digest.
  const canonical = JSON.stringify({
    backend: p.backend,
    effort: p.effort ?? null,
    model: p.model ?? null,
    personality_md: p.personalityMd,
    policy: p.policy ?? null,
    skills: [...p.skills].sort(),
  })
  const bytes = new TextEncoder().encode(canonical)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** Prefixo curto do digest pra UI (preview nas Settings, labels). */
export function shortDigest(digest: string): string {
  return digest.slice(0, 8)
}

/** Campo de skills das Settings → lista canônica: vírgula OU quebra de linha
 *  separam; "/" do começo é tolerado e removido (o nome não leva barra);
 *  dedup preservando a 1ª ocorrência. */
export function parseSkillsText(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((s) => s.trim().replace(/^\//, ""))
        .filter(Boolean),
    ),
  ]
}

// ---------------------------------------------------------------------------
// Bloco de persona (o que vai no prompt do 1º turno)
// ---------------------------------------------------------------------------

/** Monta o bloco de persona prependido ao prompt do PRIMEIRO turno. Mesmo
 *  cano das lições (learning.ts): bloco no prompt, não bolha visível. */
export function buildPersonaBlock(
  preset: Pick<AgentPreset, "name" | "personalityMd" | "skills" | "policy">,
): string {
  const lines = [
    `<persona name="${preset.name}">`,
    `Você assume a persona "${preset.name}" nesta conversa. Aja de acordo com a personalidade abaixo do primeiro ao último turno.`,
    "",
    preset.personalityMd.trim(),
  ]
  if (preset.policy?.trim()) {
    lines.push("", `Política de atuação: ${preset.policy.trim()}`)
  }
  if (preset.skills.length > 0) {
    lines.push(
      "",
      `Skills deste projeto à sua disposição (invoque com /nome quando fizer sentido): ${preset.skills.map((s) => `/${s}`).join(", ")}`,
    )
  }
  lines.push("</persona>")
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Decisões puras
// ---------------------------------------------------------------------------

/** A conversa já recebeu alguma RESPOSTA de assistant (texto, tool ou result)?
 *  É o sinal de que o prompt do 1º turno CHEGOU no CLI. Puro. */
export function hasAssistantReply(items: { kind: string }[]): boolean {
  return items.some(
    (it) => it.kind === "text" || it.kind === "tool" || it.kind === "result",
  )
}

/** A persona entra no 1º turno de uma conversa com preset — E TAMBÉM (D1)
 *  quando a conversa está travada mas NUNCA recebeu resposta de assistant: o
 *  1º run morreu antes da doutrina chegar (ex.: binário ausente), então o
 *  próximo envio re-injeta e re-carimba, em vez de deixar a persona perdida
 *  pra sempre atrás do lock. `locked` = conv.items.length > 0 (o sinal dos
 *  dois pontos de send); `hasReply` = hasAssistantReply(conv.items). */
export function shouldInjectPersona(
  locked: boolean,
  presetId: string | null | undefined,
  hasReply: boolean,
): boolean {
  if (!presetId) return false
  return !locked || !hasReply
}

export type PreflightResult = { ok: true } | { ok: false; error: string }

/** Preflight FAIL-CLOSED antes do 1º run com preset: personality presente e
 *  cada skill referenciada existe no inventário de comandos/skills do projeto
 *  (read_project_commands). Skill faltando → o run NÃO inicia (não injetamos
 *  persona meia-boca). `available` = nomes invocáveis por "/" (commands E
 *  skills, projeto e globais — a superfície real que o agent enxerga). */
export function preflightPreset(
  preset: Pick<AgentPreset, "name" | "personalityMd" | "skills">,
  available: string[],
): PreflightResult {
  if (!preset.personalityMd.trim()) {
    return {
      ok: false,
      error: `O preset "${preset.name}" está sem personalidade definida. Complete nas Configurações antes de usar.`,
    }
  }
  const have = new Set(available)
  const missing = preset.skills.filter((s) => !have.has(s))
  if (missing.length > 0) {
    return {
      ok: false,
      error: `O preset "${preset.name}" referencia ${missing.length === 1 ? "uma skill que não existe" : "skills que não existem"} neste projeto: ${missing.map((m) => `/${m}`).join(", ")}. Crie em .claude/commands (ou .claude/skills), ou remova do preset. O envio foi abortado.`,
    }
  }
  return { ok: true }
}

export type PresetDriftVerdict = "ok" | "drift" | "deleted"

/** Compara o digest CARIMBADO na conversa com o digest ATUAL do preset.
 *  `current` null = preset apagado. */
export function presetDriftVerdict(
  stamped: string,
  current: string | null,
): PresetDriftVerdict {
  if (current == null) return "deleted"
  return current === stamped ? "ok" : "drift"
}

// ---------------------------------------------------------------------------
// Orquestradores (DB + inventário + toast)
// ---------------------------------------------------------------------------

/** Resultado da resolução da persona no 1º turno. `blocked` = fail-closed:
 *  o caller mostra o erro e NÃO inicia o run. */
export type FirstTurnPersona =
  | { status: "none" }
  | { status: "blocked"; error: string }
  | {
      status: "ready"
      block: string
      presetId: string
      digest: string
      name: string
      agent: string
      model: string | null
      effort: string | null
    }

/** Resolve o preset da conversa pro 1º turno: carrega, faz o preflight
 *  fail-closed (personality + skills contra o inventário REAL do projeto) e
 *  devolve o bloco + o carimbo (digest recomputado dos campos atuais) + o
 *  trio agent/model/effort que o preset define. Qualquer falha no caminho
 *  (preset sumiu, inventário inacessível, skill faltando) BLOQUEIA — persona
 *  é fail-closed, nunca best-effort. */
export async function resolveFirstTurnPersona(opts: {
  locked: boolean
  presetId: string | null | undefined
  /** hasAssistantReply(conv.items) — permite a re-injeção do D1 (1º run que
   *  morreu antes de qualquer resposta). */
  hasReply: boolean
  projectPath: string
}): Promise<FirstTurnPersona> {
  if (!shouldInjectPersona(opts.locked, opts.presetId, opts.hasReply)) {
    return { status: "none" }
  }
  let preset: AgentPreset | null
  try {
    preset = await getPreset(opts.presetId!)
  } catch {
    return {
      status: "blocked",
      error:
        "Não consegui carregar o preset desta conversa. Tente de novo (ou remova o preset).",
    }
  }
  if (!preset) {
    return {
      status: "blocked",
      error:
        'O preset desta conversa não existe mais. Escolha outro (ou "Sem preset") para enviar.',
    }
  }
  let available: string[]
  try {
    available = (await readProjectCommands(opts.projectPath)).map((c) => c.name)
  } catch {
    return {
      status: "blocked",
      error:
        "Não consegui inventariar os comandos do projeto para validar as skills do preset. O envio foi abortado.",
    }
  }
  const pf = preflightPreset(preset, available)
  if (!pf.ok) return { status: "blocked", error: pf.error }
  const digest = await presetDigest(preset)
  return {
    status: "ready",
    block: buildPersonaBlock(preset),
    presetId: preset.id,
    digest,
    name: preset.name,
    agent: preset.backend,
    model: preset.model,
    effort: preset.effort,
  }
}

/** D3 — a doutrina VIAJA no transplant: numa conversa carimbada, o bloco de
 *  persona (versão ATUAL do preset) é prependido ao preâmbulo de handoff — o
 *  agent transplantado assume sob a mesma doutrina, não "pelado" com a label
 *  ainda dizendo "como X". Preset apagado ou DB fora → null e o transplant
 *  segue sem bloco (o warnPresetDrift de "apagado" já dá o aviso formal). */
export async function personaHandoffBlock(
  presetId: string | null | undefined,
  presetDigest: string | null | undefined,
): Promise<string | null> {
  if (!presetId || !presetDigest) return null
  if (!isTauri()) return null
  try {
    const preset = await getPreset(presetId)
    return preset ? buildPersonaBlock(preset) : null
  } catch {
    return null
  }
}

/** Disciplina de aviso de drift: 1 aviso por EPISÓDIO por conversa (mesma
 *  divergência não re-toasta a cada turno; digest voltar a bater fecha o
 *  episódio). Mapa de módulo, padrão do watchdog. */
const driftWarned = new Map<string, string>()

/** (testes) zera a memória de avisos de drift. */
export function _resetPresetDriftWarnings(): void {
  driftWarned.clear()
}

/** S3.4 — verificação de drift no resume/transplant: recomputa o digest do
 *  preset ATUAL e compara com o carimbado na conversa. Divergiu → AVISA (toast
 *  pt-BR) e o turno SEGUE (v1: aviso obrigatório; recusa dura fica como
 *  maturação documentada no plano). Preset apagado → aviso equivalente.
 *  Retorna o veredito (p/ teste); null = nada a verificar. */
export async function warnPresetDrift(
  convId: string,
  presetId: string | null | undefined,
  stampedDigest: string | null | undefined,
): Promise<PresetDriftVerdict | null> {
  if (!presetId || !stampedDigest) return null
  if (!isTauri()) return null
  let preset: AgentPreset | null
  try {
    preset = await getPreset(presetId)
  } catch {
    return null // DB indisponível não é drift — não inventa aviso
  }
  // recomputa dos CAMPOS atuais (não confia no digest gravado): é a régua
  // "a doutrina que vale é a que está na linha agora".
  const current = preset ? await presetDigest(preset) : null
  const verdict = presetDriftVerdict(stampedDigest, current)
  if (verdict === "ok") {
    driftWarned.delete(convId) // episódio fechado: nova divergência avisa de novo
    return verdict
  }
  const episode = `${verdict}:${current ?? "gone"}`
  if (driftWarned.get(convId) === episode) return verdict
  driftWarned.set(convId, episode)
  if (verdict === "deleted") {
    toast(
      "O preset desta conversa foi apagado. O agente segue sem a verificação de persona.",
    )
  } else {
    toast(
      `A persona "${preset!.name}" mudou desde que esta conversa começou (agora v${preset!.version}). O agente segue com o contexto original do 1º turno.`,
    )
  }
  return verdict
}
