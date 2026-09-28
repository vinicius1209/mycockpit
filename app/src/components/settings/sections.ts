// Registro das seções de Configurações: ordem, agrupamento e resolução de id
// como dado puro, para o rail e todo deep link (tray, pill, paleta) lerem a
// mesma lista.
//
// Cada seção responde UMA pergunta de quem usa; bloco que não responde à do
// título está na seção errada. A árvore segue as perguntas (ADR-268): "tem
// algo esperando por mim?", "este motor está pronto?", e as preferências. O
// escopo fica na cara: "Neste Mac" vale para a máquina, "No projeto" para o
// projeto escolhido no rail.
//
// Id órfão nunca vira tela branca: `resolveSection` traduz pelo legado ou cai
// na primeira seção válida (ADR-035).

import {
  Bell,
  Bot,
  CircleDollarSign,
  Cpu,
  Globe,
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
  Users,
  Sparkles,
  SquareTerminal,
  Waypoints,
  User,
} from "lucide-react"
import { hooksAgents, motoresDaMaquina } from "@/lib/agentRoster"
import { pendencias, type FatosDoRail } from "@/components/settings/pendencias"

export type { FatosDoRail } from "@/components/settings/pendencias"

/** Seções fixas. A página de cada motor é `motor:<id do registry>`. */
export type SecaoFixa =
  | "pending"
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
  | "desktop"
  | "resources"
  | "extensions"
  | "models"
  | "ledger"
  | "integrations"
  | "services"
  | "companion"
  | "about"

export type SectionId = SecaoFixa | `motor:${string}`

/** "Neste Mac" vale para a máquina; "No projeto", para o projeto do rail. */
export type Zona = "mac" | "projeto"

export type GroupId =
  | "inicio"
  | "voce"
  | "motores"
  | "uso"
  | "conversas"
  | "automacao"
  | "seguranca"
  | "conexoes"
  | "app"
  | "projeto"

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
  /** O que você pode DIGITAR para chegar aqui: nomes concretos do conteúdo, não
   *  sinônimos do título. Obrigatório porque é o que torna verificável "cada
   *  seção responde uma pergunta": seção que não lista o que tem virou
   *  depósito. */
  busca: string[]
}

export const SETTINGS_GROUPS: { id: GroupId; label: string; zona: Zona }[] = [
  { id: "inicio", label: "Início", zona: "mac" },
  { id: "voce", label: "Você", zona: "mac" },
  { id: "motores", label: "Motores", zona: "mac" },
  { id: "uso", label: "Uso e custo", zona: "mac" },
  { id: "conversas", label: "Conversas", zona: "mac" },
  { id: "automacao", label: "Automação", zona: "mac" },
  { id: "seguranca", label: "Segurança", zona: "mac" },
  { id: "conexoes", label: "Conexões", zona: "mac" },
  { id: "app", label: "Sobre", zona: "mac" },
  { id: "projeto", label: "Deste projeto", zona: "projeto" },
]

/** O id da página de um motor. Único lugar que monta o prefixo. */
export function secaoDoMotor(agentId: string): SectionId {
  return `motor:${agentId}`
}

/** O id do motor de uma seção, ou `null` se ela não é página de motor. */
export function motorDaSecao(id: string): string | null {
  return id.startsWith("motor:") ? id.slice("motor:".length) : null
}

/** Uma página por motor do registry, na ordem dele. Motor novo aparece sozinho. */
const SECOES_DE_MOTOR: SettingsSection[] = motoresDaMaquina().map((a) => ({
  id: secaoDoMotor(a.id),
  label: a.label,
  title: a.label,
  question: `O que a Frota precisa do ${a.label} para trabalhar por inteiro.`,
  icon: Cpu,
  group: "motores",
  busca: [a.label, a.shortLabel, a.id, "acompanhamento", "canal", "hooks", "terminal", "conectar"],
}))

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "pending",
    label: "Precisa de você",
    title: "Precisa de você",
    question: "Tudo que está esperando um gesto seu. Resolveu, some daqui.",
    icon: Bell,
    group: "inicio",
    busca: ["pendência", "atenção", "aviso", "conectar", "login", "falta"],
  },
  {
    id: "profile",
    label: "Perfil",
    title: "Perfil e preferências",
    question: "Seu nome, avatar e como você se identifica no app.",
    icon: User,
    group: "voce",
    busca: ["perfil", "avatar", "foto", "imagem", "nome", "usuário", "identidade", "você", "atalho", "som"],
  },
  {
    id: "appearance",
    label: "Aparência",
    title: "Aparência",
    question: "Como o app se parece e o que ele lembra entre reinícios.",
    icon: Palette,
    group: "voce",
    busca: ["tema", "escuro", "claro", "cor", "fonte", "densidade", "aparência"],
  },
  {
    id: "dictation",
    label: "Ditado",
    title: "Ditado",
    question: "Falar no lugar de digitar, em pt-BR e sem sair da máquina.",
    icon: Mic,
    group: "voce",
    busca: ["microfone", "mic", "voz", "ditado", "atalho", "vocabulário", "fala", "push-to-talk"],
  },
  {
    id: "tray",
    label: "Barra de menus",
    title: "Barra de menus",
    question: "O que acontece ao fechar a janela e o que o instrumento mostra.",
    icon: PanelTop,
    group: "voce",
    busca: ["tray", "barra de menus", "menubar", "fechar janela", "ícone", "dock"],
  },
  {
    id: "machine",
    label: "Todos os motores",
    title: "Motores",
    question: "Quais motores existem aqui, em que versão, e com conta conectada ou não.",
    icon: SquareTerminal,
    group: "motores",
    busca: ["motor", "cli", "versão", "instalar", "atualizar", "login", "path"],
  },
  ...SECOES_DE_MOTOR,
  {
    id: "models",
    label: "Modelos e preços",
    title: "Modelos e preços",
    question: "Quais modelos entram no seletor dos motores e quanto custam.",
    icon: Layers,
    group: "motores",
    busca: ["modelo", "opus", "sonnet", "gpt", "gemini", "preço", "token", "catálogo"],
  },
  {
    id: "ledger",
    label: "Uso e custo",
    title: "Uso e custo",
    question:
      "Quanto da janela do plano já foi usada e quanto os turnos custaram em US$.",
    icon: CircleDollarSign,
    group: "uso",
    busca: ["custo", "dólar", "gasto", "limite", "janela de uso", "plano", "histórico"],
  },
  {
    id: "new-chats",
    label: "Novas conversas",
    title: "Novas conversas",
    question: "Com o que uma conversa nova começa: motor, modelo e esforço.",
    icon: Bot,
    group: "conversas",
    busca: ["agent padrão", "modelo padrão", "esforço", "nova conversa", "default"],
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
    label: "Modelo auxiliar",
    title: "Modelo auxiliar",
    question: "Um modelo leve que faz os trabalhos pequenos em volta das conversas.",
    icon: Sparkles,
    group: "conversas",
    busca: ["sugestão", "helper", "haiku", "composer", "auxiliar", "título", "recibo", "lições"],
  },
  {
    id: "autopilot",
    label: "Vigias e automação",
    title: "Vigias e automação",
    question:
      "O que o app faz sozinho enquanto ninguém olha: retomar, vigiar e responder.",
    icon: Radar,
    group: "automacao",
    busca: ["auto-revive", "rate limit", "retomar", "vigia", "acordado", "sono", "dormir", "caffeinate"],
  },
  {
    id: "missions",
    label: "Missões",
    title: "Missões",
    badge: "beta",
    question: "Cada missão executa um plano de voo salvo, em fases com gates.",
    icon: Waypoints,
    group: "automacao",
    busca: ["missão", "plano de voo", "fase", "gate"],
  },
  {
    id: "sandbox",
    label: "Confinamento",
    title: "Confinamento",
    question:
      "O que o sistema operacional barra quando um agente roda aqui, e em quais modos.",
    icon: ShieldCheck,
    group: "seguranca",
    busca: ["sandbox", "confinamento", "seatbelt", "sandbox-exec", "escrita", "segurança", "modo"],
  },
  {
    id: "desktop",
    label: "Controle do computador",
    title: "Controle do computador",
    question:
      "O que o sistema deixa a Frota ver e operar na tela. Cada turno ainda pede a você.",
    icon: MonitorCog,
    group: "seguranca",
    busca: ["desktop", "computer use", "tela", "acessibilidade", "gravação de tela", "permissão", "macos"],
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
  {
    id: "integrations",
    label: "MCPs",
    title: "MCPs",
    question: null,
    icon: Network,
    group: "projeto",
    busca: ["mcp", "servidor", "integração", "ferramenta externa"],
  },
  {
    id: "extensions",
    label: "Skills e plugins",
    title: "Skills e plugins",
    question:
      "Quais extensões existem neste projeto, que motores as recebem e o que pedem.",
    icon: Puzzle,
    group: "projeto",
    busca: ["skill", "plugin", "extensão", "comando", "slash", "manifesto", "capability", "fingerprint"],
  },
  {
    id: "resources",
    label: "Navegador",
    title: "Navegador do projeto",
    question: "O navegador que a Frota mantém para este projeto, e quem pode ligá-lo.",
    icon: Globe,
    group: "projeto",
    busca: ["navegador", "browser", "chromium", "chrome", "playwright", "recurso", "ligar"],
  },
]

/** A seção que abre quando não há pedido válido: o que espera por você. */
export const DEFAULT_SECTION: SectionId = SETTINGS_SECTIONS[0].id

/** Onde moram os hooks de terminal hoje: na página do primeiro motor que os
 *  tem (ADR-268). Sem nenhum, a visão geral dos motores. */
export function secaoDosHooks(): SectionId {
  const motor = hooksAgents().find((a) => a.kind === "agent" && a.available)
  return motor ? secaoDoMotor(motor.id) : "machine"
}

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
  // "Sessões no terminal" era uma seção com uma linha por motor; cada linha
  // foi para a página do seu motor (ADR-268).
  hooks: secaoDosHooks(),
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
  group: { id: GroupId; label: string; zona: Zona }
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

/** A zona de uma seção: o rail e a barra do painel dizem o escopo por ela. */
export function zonaDaSecao(id: SectionId): Zona {
  const group = sectionDef(id).group
  return SETTINGS_GROUPS.find((g) => g.id === group)?.zona ?? "mac"
}

/** As seções que este build tem, filtradas por capability. Aqui porque o rail
 *  e a paleta ⌘K precisam da mesma regra: escondida num e alcançável no outro
 *  seria destino fantasma. */
export function secoesDisponiveis(): SectionId[] {
  return SETTINGS_SECTIONS.map((s) => s.id)
}

/** O termo casa com a seção? Junta rótulo, título, a pergunta e as palavras
 *  declaradas — sem acento e em minúsculas, porque ninguém digita "vocabulário"
 *  com acento numa busca apressada. */
export function casaBusca(s: SettingsSection, termo: string): boolean {
  const normaliza = (t: string) =>
    t
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
  const alvo = normaliza(
    [s.label, s.title, s.question ?? "", ...s.busca].join(" "),
  )
  return normaliza(termo)
    .split(/\s+/)
    .filter(Boolean)
    .every((palavra) => alvo.includes(palavra))
}

/**
 * A seção precisa de atenção?
 *
 * Lê a MESMA lista da página "Precisa de você" (`pendencias`): o ponto do rail
 * e a lista não podem discordar (ADR-268). A regra de o que é pendência mora
 * lá; aqui só se decide em que seção ela acende:
 *
 *   "Precisa de você"   → qualquer pendência.
 *   "Todos os motores"  → pendência de algum motor.
 *   qualquer outra      → pendência daquela seção.
 */
export function precisaDeAtencao(id: SectionId, f: FatosDoRail): boolean {
  const lista = pendencias(f)
  if (id === "pending") return lista.length > 0
  if (id === "machine") return lista.some((p) => motorDaSecao(p.secao) !== null)
  return lista.some((p) => p.secao === id)
}

/** Metadados de uma seção (título/pergunta do cabeçalho). */
export function sectionDef(id: SectionId): SettingsSection {
  return (
    SETTINGS_SECTIONS.find((s) => s.id === id) ??
    SETTINGS_SECTIONS[0]
  )
}
