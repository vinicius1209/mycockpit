// Registro das seções de Configurações — ORDEM, AGRUPAMENTO e RESOLUÇÃO DE
// ID viram DADO puro (sem JSX, sem store), pelo mesmo motivo do Orca: o rail
// e qualquer deep link (tray, UsagePill, paleta) leem a mesma lista e não
// podem divergir.
//
// Regra de organização: cada seção responde UMA pergunta do usuário. Se um
// bloco não responde a pergunta do título, ele está na seção errada — foi o
// que aconteceu com "CLIs instaladas" (virou depósito de medidor, hooks e
// curador de modelos).
//
// Id órfão (seção que sumiu/renomeou) NUNCA vira tela branca: `resolveSection`
// traduz pelo mapa de legado ou cai na primeira seção válida — mesma
// disciplina do migrate de viewMode (ADR-035).

import {
  Bot,
  CircleDollarSign,
  Cpu,
  Info,
  Layers,
  Mic,
  MonitorCog,
  GitPullRequest,
  Network,
  PanelTop,
  Palette,
  Puzzle,
  Radar,
  ShieldCheck,
  Smartphone,
  SquareTerminal,
  Users,
  Sparkles,
  Waypoints,
  User,
} from "lucide-react"
import { hooksAgents } from "@/lib/agentRoster"

export type SectionId =
  | "profile"
  | "appearance"
  | "tray"
  | "new-chats"
  | "autopilot"
  | "presets"
  | "suggestions"
  | "dictation"
  | "missions"
  | "machine"
  | "sandbox"
  | "resources"
  | "extensions"
  | "models"
  | "hooks"
  | "ledger"
  | "integrations"
  | "services"
  | "companion"
  | "about"

export type GroupId =
  | "interface"
  | "conversas"
  | "agentes"
  | "capacidades"
  | "extensoes"
  | "conexoes"
  | "app"

export interface SettingsSection {
  id: SectionId
  /** Rótulo no rail (curto). */
  label: string
  /** Título do painel. Igual ao rail quando o rótulo já é honesto. */
  title: string
  /** A pergunta que a seção responde, em uma linha (vira a descrição do
   *  cabeçalho). `null` = a seção traz o próprio cabeçalho (Especialistas,
   *  MCP, Companion desenham chrome próprio). */
  question: string | null
  icon: typeof Bot
  group: GroupId
  /** Selo curto no rail (`BETA`, `OPCIONAL`). Fora do título de propósito:
   *  "Missões (beta)" carregava o estado dentro do texto, e aí ele não podia
   *  ser estilizado nem lido como estado. */
  badge?: string
  /** O que o usuário pode DIGITAR pra chegar aqui — nomes concretos do que a
   *  seção contém, não sinônimos do título.
   *
   *  Obrigatório de propósito: é o que transforma a regra editorial "cada seção
   *  responde UMA pergunta" em algo verificável. Seção que não consegue listar
   *  o que tem dentro é seção que virou depósito, e foi assim que "CLIs
   *  instaladas" acumulou medidor, hooks e curador de modelos. */
  busca: string[]
}

export const SETTINGS_GROUPS: { id: GroupId; label: string }[] = [
  { id: "interface", label: "Interface" },
  { id: "conversas", label: "Conversas" },
  { id: "agentes", label: "Agentes e uso" },
  { id: "capacidades", label: "Capacidades" },
  { id: "extensoes", label: "Extensões" },
  { id: "conexoes", label: "Conexões" },
  { id: "app", label: "App" },
]

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "profile",
    label: "Perfil",
    title: "Perfil e preferências",
    question: "Seu nome, avatar e como você se identifica no app.",
    icon: User,
    group: "interface",
    busca: ["perfil", "avatar", "foto", "imagem", "nome", "usuário", "identidade", "você", "atalho", "som"],
  },
  {
    id: "appearance",
    label: "Aparência",
    title: "Aparência",
    question: "Como o app se parece e o que ele lembra entre reinícios.",
    icon: Palette,
    group: "interface",
    busca: ["tema", "escuro", "claro", "cor", "fonte", "densidade", "aparência"],
  },
  {
    id: "tray",
    label: "Barra de menus",
    title: "Barra de menus",
    question: "O que acontece ao fechar a janela e o que o instrumento mostra.",
    icon: PanelTop,
    group: "interface",
    busca: ["tray", "barra de menus", "menubar", "fechar janela", "ícone", "dock"],
  },
  {
    id: "new-chats",
    label: "Novas conversas",
    title: "Novas conversas",
    question: "Com o que uma conversa nova começa: agent, modelo e esforço.",
    icon: Bot,
    group: "conversas",
    busca: ["agent padrão", "modelo padrão", "esforço", "nova conversa", "default"],
  },
  {
    id: "autopilot",
    label: "Vigias e automação",
    title: "Vigias e automação",
    question:
      "O que o app faz sozinho enquanto ninguém olha: retomar, vigiar e responder.",
    icon: Radar,
    group: "conversas",
    busca: ["auto-revive", "rate limit", "retomar", "vigia", "acordado", "sono", "dormir", "caffeinate"],
  },
  {
    id: "presets",
    label: "Especialistas",
    title: "Especialistas",
    question: null,
    icon: Users,
    group: "conversas",
    busca: ["persona", "especialista", "piloto", "preset"],
  },
  {
    id: "suggestions",
    label: "Sugestões",
    title: "Sugestões",
    question: "Qual modelo escreve as sugestões automáticas do composer.",
    icon: Sparkles,
    group: "conversas",
    busca: ["sugestão", "helper", "haiku", "composer"],
  },
  {
    id: "dictation",
    label: "Ditado",
    title: "Ditado",
    question: "Falar no lugar de digitar, em pt-BR e sem sair da máquina.",
    icon: Mic,
    group: "conversas",
    busca: ["microfone", "mic", "voz", "ditado", "atalho", "vocabulário", "fala", "push-to-talk"],
  },
  {
    id: "missions",
    label: "Missões",
    title: "Missões",
    badge: "beta",
    question: "Cada missão executa um plano de voo salvo, em fases com gates.",
    icon: Waypoints,
    group: "conversas",
    busca: ["missão", "plano de voo", "fase", "gate"],
  },
  {
    id: "machine",
    label: "Agentes na máquina",
    title: "Agentes na máquina",
    question: "Quais CLIs de agent existem aqui, em que versão e logadas ou não.",
    icon: Cpu,
    group: "agentes",
    busca: ["claude", "codex", "antigravity", "agy", "cli", "versão", "instalar", "atualizar", "login", "path"],
  },
  {
    id: "models",
    label: "Modelos",
    title: "Modelos",
    question: "Quais modelos entram no seletor dos agents e quanto custam.",
    icon: Layers,
    group: "agentes",
    busca: ["modelo", "opus", "sonnet", "gpt", "gemini", "preço", "token", "catálogo"],
  },
  {
    id: "hooks",
    label: "Sessões no terminal",
    title: "Sessões no terminal",
    question:
      "Sessões abertas fora do app aparecendo no Painel e no tray, só de leitura.",
    icon: SquareTerminal,
    group: "agentes",
    busca: ["hook", "terminal", "statusline", "sessão externa"],
  },
  {
    id: "ledger",
    label: "Uso e custo",
    title: "Uso e custo",
    question:
      "Quanto da janela do plano já foi usada e quanto os turnos custaram em US$.",
    icon: CircleDollarSign,
    group: "agentes",
    busca: ["custo", "dólar", "gasto", "limite", "janela de uso", "plano", "ledger"],
  },
  {
    id: "sandbox",
    label: "Confinamento",
    title: "Confinamento",
    question:
      "O que o sistema operacional barra quando um agente roda aqui, e em quais modos.",
    icon: ShieldCheck,
    group: "capacidades",
    busca: ["sandbox", "confinamento", "seatbelt", "sandbox-exec", "escrita", "segurança", "modo"],
  },
  {
    id: "resources",
    label: "Navegador e desktop",
    title: "Navegador e desktop",
    question:
      "Quais recursos locais podem ser operados e quem controla o acesso por run.",
    icon: MonitorCog,
    group: "capacidades",
    busca: ["navegador", "browser", "chromium", "chrome", "desktop", "macos", "computer use", "playwright", "recurso", "permissão"],
  },
  {
    id: "extensions",
    label: "Skills e plugins",
    title: "Skills e plugins",
    question:
      "Quais extensões existem, quem as recebe e quais capabilities pedem.",
    icon: Puzzle,
    group: "extensoes",
    busca: ["skill", "plugin", "extensão", "comando", "slash", "manifesto", "capability", "fingerprint"],
  },
  {
    id: "services",
    label: "Serviços",
    title: "Serviços",
    question: "Quais serviços externos o app usa, e com qual conta.",
    icon: GitPullRequest,
    group: "conexoes",
    busca: ["gh", "github", "pr", "pull request", "conta", "merge", "checks", "repositório", "serviço", "integração", "gitlab"],
  },
  {
    id: "integrations",
    label: "MCPs",
    title: "MCPs",
    question: null,
    icon: Network,
    group: "conexoes",
    busca: ["mcp", "servidor", "integração", "ferramenta externa"],
  },
  {
    id: "companion",
    label: "Companion",
    title: "Companion",
    question: "Ver e responder os agents pelo celular, na mesma rede local.",
    icon: Smartphone,
    group: "conexoes",
    busca: ["celular", "mobile", "telefone", "qr", "lan", "rede", "companion"],
  },
  {
    id: "about",
    label: "Sobre",
    title: "Sobre",
    question: null,
    icon: Info,
    group: "app",
    busca: ["versão", "sobre", "onboarding", "refazer"],
  },
]

/** A seção que abre quando não há pedido válido. */
export const DEFAULT_SECTION: SectionId = SETTINGS_SECTIONS[0].id

/** Ids que já existiram → onde o conteúdo deles mora hoje. Entrada aqui é
 *  contrato: some daqui só quando o id não puder mais chegar de lugar nenhum. */
export const LEGACY_SECTION_IDS: Record<string, SectionId> = {
  // "CLIs instaladas" era o depósito: as CLIs ficaram, o resto se mudou.
  tools: "machine",
  // "agents" rotulava os PADRÕES de nova conversa, não os agents da máquina.
  agents: "new-chats",
  // "github" era uma seção por FORNECEDOR: o rail cresceria um item por vendor
  // (ADR-086). Virou "services", com o provedor como CARTÃO.
  github: "services",
}

const KNOWN = new Set<string>(SETTINGS_SECTIONS.map((s) => s.id))

/** Traduz um id vindo de fora (deep link, estado antigo) numa seção que
 *  existe E está visível. Desconhecido, legado sem destino visível, vazio ou
 *  não-string cai na primeira seção disponível — nunca numa tela em branco.
 *  `available` (opcional) é a lista já filtrada por capability: seção que o
 *  build não tem não vira destino. */
export function resolveSection(
  value: unknown,
  available?: readonly SectionId[],
): SectionId {
  const pool = available?.length ? new Set<string>(available) : KNOWN
  const fallback = available?.length ? available[0] : DEFAULT_SECTION
  if (typeof value === "string") {
    if (pool.has(value)) return value as SectionId
    const legacy = LEGACY_SECTION_IDS[value]
    if (legacy && pool.has(legacy)) return legacy
  }
  return fallback
}

/** As seções na ordem do rail, quebradas por grupo. `available` esconde as
 *  seções sem capability (1ª camada de esconder); grupo que ficou sem seção
 *  some junto (nada de rótulo órfão no rail). */
export function sectionsByGroup(available?: readonly SectionId[]): {
  group: { id: GroupId; label: string }
  sections: SettingsSection[]
}[] {
  const pool = available?.length ? new Set<string>(available) : KNOWN
  return SETTINGS_GROUPS.map((group) => ({
    group,
    sections: SETTINGS_SECTIONS.filter(
      (s) => s.group === group.id && pool.has(s.id),
    ),
  })).filter((entry) => entry.sections.length > 0)
}

/** As seções que ESTE BUILD tem, já filtradas por capability.
 *
 *  Mora aqui e não no dialog porque agora existem DOIS consumidores — o rail e
 *  a paleta ⌘K — e a regra tem que ser a mesma nos dois. Seção escondida no
 *  rail e alcançável pela paleta seria um destino fantasma. */
export function secoesDisponiveis(): SectionId[] {
  return SETTINGS_SECTIONS.filter(
    (s) => s.id !== "hooks" || hooksAgents().length > 0,
  ).map((s) => s.id)
}

/** O termo casa com a seção? Junta rótulo, título, a pergunta e as palavras
 *  declaradas — sem acento e em minúsculas, porque ninguém digita "vocabulário"
 *  com acento numa busca apressada. */
export function casaBusca(s: SettingsSection, termo: string): boolean {
  const normaliza = (t: string) =>
    t
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
  const alvo = normaliza(
    [s.label, s.title, s.question ?? "", ...s.busca].join(" "),
  )
  return normaliza(termo)
    .split(/\s+/)
    .filter(Boolean)
    .every((palavra) => alvo.includes(palavra))
}

/** Os fatos que o rail consulta pra decidir onde pintar "precisa de atenção".
 *  Campos OPCIONAIS de propósito: ausente = ainda não olhamos, e não olhar
 *  nunca pode virar alarme. */
export interface FatosDoRail {
  detected?: Record<string, { installed: boolean; auth: string }>
  gh?: { installed: boolean; contas: number }
}

/**
 * A seção precisa de atenção?
 *
 * A REGRA, e ela é a decisão inteira desta função: atenção é **coisa
 * meio-configurada que VOCÊ pode consertar**. Não é capacidade ausente por
 * escolha, e não é limitação da máquina.
 *
 *   CLI instalada e DESLOGADA  → atenção. Você instalou, falta terminar.
 *   CLI não instalada          → não. Talvez você não queira aquele motor.
 *   `gh` instalado e sem conta → atenção. Mesma lógica.
 *   `gh` ausente               → não. É opcional; o resto do app funciona.
 *   máquina sem sandbox        → NUNCA. É fato do sistema, não tem o que
 *                                consertar, e um ponto que não apaga é pior
 *                                que ponto nenhum: ensina a ignorar o ponto.
 */
export function precisaDeAtencao(id: SectionId, f: FatosDoRail): boolean {
  if (id === "machine") {
    return Object.values(f.detected ?? {}).some(
      (p) => p.installed && p.auth === "missing",
    )
  }
  if (id === "services") {
    return f.gh ? f.gh.installed && f.gh.contas === 0 : false
  }
  return false
}

/** Metadados de uma seção (título/pergunta do cabeçalho). */
export function sectionDef(id: SectionId): SettingsSection {
  return (
    SETTINGS_SECTIONS.find((s) => s.id === id) ??
    SETTINGS_SECTIONS[0]
  )
}
