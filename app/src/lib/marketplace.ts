// Lógica PURA do marketplace de Especialistas (E2) — o que dá pra testar sem
// React: categorias, filtro do grid, resumo do card e a montagem do input de
// criação (slug/seed/preview). A UI (components/settings/Especialistas.tsx) só
// desenha; a decisão mora aqui.

import { slugify, type AgentDef } from "@/lib/agentDefs"
import { DEFAULT_AVATAR_STYLE } from "@/lib/avatar"
import { parseSkillsText } from "@/lib/presets"
import type { AgentPresetInput } from "@/lib/db"

export const ALL_CATEGORY = "Todos"

/** Categoria "efetiva" de uma persona (arquivo antigo sem o campo = "Geral"). */
export function categoriaDe(d: Pick<AgentDef, "category">): string {
  return d.category?.trim() || "Geral"
}

/** Categorias presentes na lista, ordenadas, com "Todos" na frente (o chip de
 *  filtro do topo). */
export function marketplaceCategories(
  defs: Pick<AgentDef, "category">[],
): string[] {
  const set = new Set<string>()
  for (const d of defs) set.add(categoriaDe(d))
  return [
    ALL_CATEGORY,
    ...[...set].sort((a, b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
    ),
  ]
}

/** Filtro do grid: categoria + busca livre (nome, categoria, briefing, slug).
 *  Categoria "Todos" não filtra; busca vazia não filtra. */
export function filterEspecialistas<
  T extends Pick<AgentDef, "name" | "category" | "personalityMd" | "slug">,
>(defs: T[], category: string, query: string): T[] {
  const q = query.trim().toLowerCase()
  return defs.filter((d) => {
    if (category !== ALL_CATEGORY && categoriaDe(d) !== category) return false
    if (!q) return true
    const hay = `${d.name} ${categoriaDe(d)} ${d.personalityMd} ${d.slug}`
    return hay.toLowerCase().includes(q)
  })
}

/** Resumo curto do card = 1ª linha não-vazia do briefing (sem o "#" de heading),
 *  truncada. O resumo NÃO é um campo do arquivo (o plano só adiciona category/
 *  rubric/avatar) — é derivado do briefing, fonte única. */
export function especialistaResumo(personalityMd: string, max = 120): string {
  const line =
    personalityMd
      .split("\n")
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find(Boolean) ?? ""
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** Seed do avatar no criar: base = slug do nome; "variar" soma um sufixo
 *  numérico. Salt 0 devolve o próprio slug (= o default, que o serialize omite
 *  do arquivo). Determinístico. */
export function previewSeed(name: string, salt: number): string {
  const base = slugify(name || "especialista")
  return salt > 0 ? `${base}-${salt}` : base
}

/** Estado do form de criação (o que a UI segura). Sentinela "default" em
 *  model/effort como no resto do app. */
export interface CreateFormState {
  name: string
  category: string
  personalityMd: string
  rubric: string[]
  skillsText: string
  policy: string
  backend: string
  model: string
  effort: string
  avatarStyle: string
  avatarSalt: number
}

export function emptyCreateForm(): CreateFormState {
  return {
    name: "",
    category: "Geral",
    personalityMd: "",
    rubric: [],
    skillsText: "",
    policy: "",
    backend: "claude-code",
    model: "default",
    effort: "default",
    avatarStyle: DEFAULT_AVATAR_STYLE,
    avatarSalt: 0,
  }
}

/** Form → input de persona (o mesmo AgentPresetInput do CRUD existente). PURO:
 *  aplica os defaults (category "Geral", seed = slug quando não variou) e a
 *  sentinela de model/effort. */
export function buildCreateInput(f: CreateFormState): AgentPresetInput {
  const name = f.name.trim()
  return {
    name,
    personalityMd: f.personalityMd,
    skills: parseSkillsText(f.skillsText),
    policy: f.policy.trim() ? f.policy.trim() : null,
    backend: f.backend,
    model: f.model === "default" ? null : f.model,
    effort: f.effort === "default" ? null : f.effort,
    category: f.category.trim() || "Geral",
    rubric: f.rubric,
    avatarStyle: f.avatarStyle,
    avatarSeed: previewSeed(name, f.avatarSalt),
  }
}

/** O criar pode salvar? Nome e briefing são obrigatórios (mesma régra do
 *  save do PresetSettings — persona sem personalidade é fail-closed no 1º run). */
export function canCreate(f: CreateFormState): boolean {
  return !!f.name.trim() && !!f.personalityMd.trim()
}

// ---------------------------------------------------------------------------
// Equipe inicial (semente que resolve o cold start do marketplace)
// ---------------------------------------------------------------------------

/** Molde de um especialista da equipe inicial. NÃO seta estilo: todos herdam o
 *  sistema (thumbs) e a COR vem da categoria (lib/avatar.avatarFor). O resto é
 *  default: claude-code, model/effort herdados, seed = slug. */
function membro(
  name: string,
  category: string,
  personalityMd: string,
  rubric: string[],
  policy: string | null = null,
): AgentPresetInput {
  return {
    name,
    personalityMd,
    skills: [],
    policy,
    backend: "claude-code",
    model: null,
    effort: null,
    category,
    rubric,
    // vazio = default do sistema (thumbs) e seed = slug; arquivo limpo, cor
    // derivada da categoria.
    avatarStyle: "",
    avatarSeed: "",
  }
}

/** Especialistas semeados no primeiro uso (escopo GLOBAL — valem em todo
 *  projeto). São personas de arquivo normais: @menção, parecer e volante já
 *  funcionam sem tocar no pipeline. A voz é da própria persona; a categoria dá
 *  a COR (cada domínio uma cor distinta). */
export const STARTER_TEAM: AgentPresetInput[] = [
  membro(
    "Aline",
    "Engenharia",
    "Sou a Aline, arquiteta de sistemas. Antes de uma linha ser escrita eu travo a fronteira e o acoplamento: quem é dono de quê, onde a mudança dói e o que sobrevive a um reinício. Aponto o desenho certo, a implementação é sua.",
    [
      "Fronteiras e responsabilidade única",
      "Acoplamento e pontos de mudança",
      "Idempotência e estados de corrida",
      "Sobrevive a reinício?",
    ],
    "Propõe, não escreve: aponta o caminho, a mão no código é sua.",
  ),
  membro(
    "Vault",
    "Segurança",
    "Sou o Vault, revisão de segurança. Passo a rubrica de risco e permissões pelo diff e sinalizo o que precisa fechar antes de seguir. Na dúvida, fail-closed. Eu aponto, não ajo por conta.",
    [
      "Fail-closed em toda dúvida",
      "Trilha de auditoria",
      "Superfície de permissão",
      "Segredos e dados sensíveis",
    ],
    "Só leitura: aponta o risco, nunca aplica a correção sozinho.",
  ),
  membro(
    "Marco",
    "Estratégia",
    "Sou o Marco, estratégia de produto. Antes de refinar eu pergunto se isso é a coisa certa pra construir agora: resolve o problema real, que comportamento premia, qual o custo de oportunidade e se dá pra voltar atrás.",
    [
      "Resolve o problema real?",
      "Que comportamento é premiado?",
      "Custo de oportunidade",
      "Reversibilidade",
    ],
  ),
  membro(
    "Nero",
    "Ops",
    "Sou o Nero, a lente de custo e performance. Olho tokens por turno, latência percebida, trabalho redundante e polling que podia ser evento. Se está caro ou lento sem precisar, eu mostro onde.",
    [
      "Tokens por turno",
      "Latência percebida",
      "Trabalho redundante",
      "Polling vs evento",
    ],
  ),
  membro(
    "Íris",
    "Design",
    "Sou a Íris, design de produto. Avalio contra um padrão-ouro: primeiro uso sem fricção, hierarquia visual clara, estados vazios e de erro bem resolvidos e consistência com o resto do sistema.",
    [
      "Primeiro uso sem fricção",
      "Hierarquia visual",
      "Estados vazios e de erro",
      "Consistência do sistema",
    ],
  ),
  membro(
    "Testa",
    "Qualidade",
    "Sou a Testa, qualidade e testes. Caço o caminho não-feliz: bordas de tempo, corridas, concorrência e o que ninguém cobriu. Se um caso pode quebrar e não tem teste, eu acho.",
    [
      "Caminho não-feliz",
      "Corridas e concorrência",
      "Bordas de tempo",
      "Regressão",
    ],
  ),
]
