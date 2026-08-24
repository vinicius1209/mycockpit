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
  GitPullRequest,
  Network,
  PanelTop,
  Palette,
  Radar,
  ShieldCheck,
  Smartphone,
  SquareTerminal,
  Users,
  Sparkles,
  Waypoints,
} from "lucide-react"

export type SectionId =
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
  | "models"
  | "hooks"
  | "ledger"
  | "integrations"
  | "github"
  | "companion"
  | "about"

export type GroupId =
  | "interface"
  | "conversas"
  | "agentes"
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
}

export const SETTINGS_GROUPS: { id: GroupId; label: string }[] = [
  { id: "interface", label: "Interface" },
  { id: "conversas", label: "Conversas" },
  { id: "agentes", label: "Agentes e uso" },
  { id: "conexoes", label: "Conexões" },
  { id: "app", label: "App" },
]

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "appearance",
    label: "Aparência",
    title: "Aparência",
    question: "Como o app se parece e o que ele lembra entre reinícios.",
    icon: Palette,
    group: "interface",
  },
  {
    id: "tray",
    label: "Barra de menus",
    title: "Barra de menus",
    question: "O que acontece ao fechar a janela e o que o instrumento mostra.",
    icon: PanelTop,
    group: "interface",
  },
  {
    id: "new-chats",
    label: "Novas conversas",
    title: "Novas conversas",
    question: "Com o que uma conversa nova começa: agent, modelo e esforço.",
    icon: Bot,
    group: "conversas",
  },
  {
    id: "autopilot",
    label: "Vigias e automação",
    title: "Vigias e automação",
    question:
      "O que o app faz sozinho enquanto ninguém olha: retomar, vigiar e responder.",
    icon: Radar,
    group: "conversas",
  },
  {
    id: "presets",
    label: "Especialistas",
    title: "Especialistas",
    question: null,
    icon: Users,
    group: "conversas",
  },
  {
    id: "suggestions",
    label: "Sugestões",
    title: "Sugestões",
    question: "Qual modelo escreve as sugestões automáticas do composer.",
    icon: Sparkles,
    group: "conversas",
  },
  {
    id: "dictation",
    label: "Ditado",
    title: "Ditado",
    question: "Falar no lugar de digitar, em pt-BR e sem sair da máquina.",
    icon: Mic,
    group: "conversas",
  },
  {
    id: "missions",
    label: "Missões",
    title: "Missões (beta)",
    question: "Cada missão executa um plano de voo salvo, em fases com gates.",
    icon: Waypoints,
    group: "conversas",
  },
  {
    id: "machine",
    label: "Agentes na máquina",
    title: "Agentes na máquina",
    question: "Quais CLIs de agent existem aqui, em que versão e logadas ou não.",
    icon: Cpu,
    group: "agentes",
  },
  {
    id: "sandbox",
    label: "Confinamento",
    title: "Confinamento",
    question:
      "O que o sistema operacional barra quando um agente roda aqui, e em quais modos.",
    icon: ShieldCheck,
    group: "agentes",
  },
  {
    id: "models",
    label: "Modelos",
    title: "Modelos",
    question: "Quais modelos entram no seletor dos agents e quanto custam.",
    icon: Layers,
    group: "agentes",
  },
  {
    id: "hooks",
    label: "Sessões no terminal",
    title: "Sessões no terminal",
    question:
      "Sessões abertas fora do app aparecendo no Painel e no tray, só de leitura.",
    icon: SquareTerminal,
    group: "agentes",
  },
  {
    id: "ledger",
    label: "Uso e custo",
    title: "Uso e custo",
    question:
      "Quanto da janela do plano já foi usada e quanto os turnos custaram em US$.",
    icon: CircleDollarSign,
    group: "agentes",
  },
  {
    id: "github",
    label: "GitHub",
    title: "GitHub",
    question:
      "Qual CLI e quais contas o app usa para PRs e checks, e qual está ativa.",
    icon: GitPullRequest,
    group: "conexoes",
  },
  {
    id: "integrations",
    label: "Integrações MCP",
    title: "Integrações MCP",
    question: null,
    icon: Network,
    group: "conexoes",
  },
  {
    id: "companion",
    label: "Companion",
    title: "Companion",
    question: "Ver e responder os agents pelo celular, na mesma rede local.",
    icon: Smartphone,
    group: "conexoes",
  },
  {
    id: "about",
    label: "Sobre",
    title: "Sobre",
    question: null,
    icon: Info,
    group: "app",
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

/** Metadados de uma seção (título/pergunta do cabeçalho). */
export function sectionDef(id: SectionId): SettingsSection {
  return (
    SETTINGS_SECTIONS.find((s) => s.id === id) ??
    SETTINGS_SECTIONS[0]
  )
}
