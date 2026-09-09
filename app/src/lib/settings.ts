import type { MissionPreset } from "@/lib/missionTypes"
import { DEFAULT_MISSION_PRESETS } from "@/lib/missionDefaults"
import { snapshotMissionPlan } from "@/lib/missionPlans"
import type { AgentProbe } from "@/lib/detect"
import { DEFAULT_DICTATION_HOTKEY } from "@/lib/dictationHotkey"
import {
  DEFAULT_USER_PREFERENCES,
  DEFAULT_USER_PROFILE,
  type UserPreferences,
  type UserProfile,
} from "@/lib/userProfile"
import {
  DEFAULT_UTILITY_INFERENCE,
  type UtilityInferenceSettings,
} from "@/lib/utility/types"

// Preferências GLOBAIS do app (persistidas via zustand persist → localStorage,
// que o webview do Tauri guarda em disco entre reinícios). Distinto do config
// POR-PROJETO (.mycockpit/config.toml), que segue vivendo no ContextPanel.
export interface GlobalSettings {
  /** Escala de leitura do transcript (0.8–1.6). Não altera chrome nem composer;
   *  atalhos padrão: ⌘/Ctrl +, ⌘/Ctrl - e ⌘/Ctrl 0. */
  conversationScale: number
  /** Agent pré-selecionado ao abrir uma conversa nova. */
  defaultAgent: string
  /** Modelo default (null = default do agent, "default"). */
  defaultModel: string | null
  /** Effort default (null = "default"). */
  defaultEffort: string | null
  /** Modelo helper das sugestões quando o projeto não define um no config.toml.
   *  null = sugestões desligadas por padrão. */
  helperModel: string | null
  /** Inferências auxiliares, separadas dos runs. A política remota é por
   *  finalidade; autorizar pills não autoriza ler o histórico da conversa. */
  utilityInference: UtilityInferenceSettings
  /** Liga/desliga o botão de ditado (mic) globalmente. */
  dictationEnabled: boolean
  /** Atalho do ditado, serializado "modificadores+e.code" (ex. "alt+Space",
   *  "ctrl+alt+KeyD" — ver lib/dictationHotkey). null = atalho desativado
   *  (o mic segue clicável). */
  dictationHotkey: string | null
  /** Termos extras de vocabulário do ditado (somados aos fixos do MicButton). */
  dictationVocab: string[]
  /** UID do microfone escolhido. null = padrão do sistema (o único
   *  comportamento que existia antes). Guardamos o UID e não o nome: nome muda
   *  com o idioma do SO e se repete entre dois headsets iguais. */
  dictationDevice: string | null
  /** Segurar o sono da máquina: "on" sempre · "agent" enquanto um agente
   *  trabalha (default) · "off" nunca. O default é "agent" porque é o único
   *  que só cobra bateria quando há trabalho de verdade em voo — e é
   *  exatamente aí que dormir custa um turno já pago. */
  keepAwake: "on" | "agent" | "off"
  /** Auto-revive: quando o turno termina num rate limit / "vou tentar depois",
   *  reenvia sozinho (após o reset) até concluir de verdade ou bater o cap.
   *  OPT-IN (default false) porque cada resume é um run pago. */
  autoResume: boolean
  /** Teto de tentativas de auto-resume por turno (protege o custo). */
  autoResumeMaxTries: number
  /** Missions (beta): habilita o botão de missão no composer. */
  missionEnabled: boolean
  /** Planos de voo salvos do Mission (rota + time + limites). */
  missionPresets: MissionPreset[]
  /** Onboarding: false = mostra o wizard no boot. Migração seta true p/ quem já
   *  tem estado persistido (não é primeira instalação). */
  onboarded: boolean
  /** Guia de setup da sidebar escondido pelo usuário (menu de contexto). O guia
   *  já some sozinho ao completar; isto é pra quem não quer os itens opcionais
   *  (dismissal persistido, §5.4 do STYLEGUIDE). */
  setupGuideDismissed: boolean
  /** Editor escolhido pra "abrir no editor" (M1). null = usa o primeiro
   *  detectado. Não tem seção própria em Configurações de propósito: com um
   *  editor só a pergunta não existe, e com vários quem escolhe é o próprio
   *  menu do botão, no momento em que a escolha importa. */
  preferredEditor: string | null
  /** Fechar a janela mantém o motor vivo e acessível pela barra de menus. */
  keepInTrayOnClose: boolean
  /** Instrumento persistente nas bordas. Desligado preserva o popover clássico. */
  hudEnabled: boolean
  /** Posição do Dynamic HUD na tela. */
  hudPosition: "notch" | "island" | "left" | "right" | "bottom" | "menubar"
  /** Habilita expansão automática ao passar o mouse sobre o HUD. */
  hudHoverExpand: boolean
  /** Segue a tela ativa com o cursor em setups multi-monitor. */
  hudFollowActiveScreen: boolean
  /** UUID/identificador da tela escolhida. null mantém o modo automático. */
  hudScreenId: string | null
  /** Dedupe persistido do aviso educativo exibido no primeiro hide. */
  trayCloseHintShown: boolean
  /** Último snapshot da detecção de agents (por id). Alimenta o seletor e o
   *  bloco "Agents na máquina" das Configurações. */
  detected: Record<string, AgentProbe>
  /** Epoch ms da última checagem diária de update dos agents (0 = nunca). */
  lastUpdateCheck: number
  /** Última versão `latest` já NOTIFICADA por agent (dedupe: nunca repete a
   *  notificação da mesma versão). */
  lastNotifiedVersions: Record<string, string>
  /** Update de CLI dispensado no sino: agent → versão `latest` dispensada
   *  (dismissal persistido, STYLEGUIDE §5.4). A chave é a VERSÃO, não o agent:
   *  dispensar a v2.1.220 não silencia a v2.1.230. Só "atualização disponível"
   *  é dispensável; "sem login" é impedimento e não sai da lista. */
  updateDismissed: Record<string, string>
  /** Epoch ms do último refresh do catálogo de modelos (models.dev via Rust).
   *  0 = nunca. Alimenta a linha "Tabela de preços" em Configurações ▸ Agents. */
  lastCatalogRefresh: number
  /** Nº de modelos no snapshot local do catálogo (informativo). */
  catalogCount: number
  /** Epoch ms da última rodada do curador de modelos (máx. 1x/semana). */
  lastCuratorRun: number
  /** Epoch ms da última RODADA DE PROMOÇÃO de modelos (M3 do
   *  model-autonomy-plan: lista viva + fumaça + preço). 0 = nunca. É o freio da
   *  agenda diária; o gesto ("Verificar agora" em Configurações ▸ Modelos)
   *  passa por cima dele, e o freio de 60s por motor no Rust segue valendo. */
  lastModelRound: number
  /** Aviso de modelo já dispensado no sino: id do aviso → epoch ms da dispensa.
   *  A chave carrega a ASSINATURA do conteúdo (quais slugs, qual decisão),
   *  mesmo padrão do `updateDismissed`: dispensar o aviso de hoje não silencia
   *  o de amanhã, que fala de outros modelos. */
  modelNewsDismissed: Record<string, number>
  /** Companion Web (celular na LAN): liga o servidor local + a ponte de push.
   *  OPT-IN (default false) — abre uma porta na rede local. */
  companionEnabled: boolean
  /** Vigia: minutos sem evento novo NEM trabalho reportado ativo. 0 desliga. */
  stalledAfterMin: number
  /** Automação DESASSISTIDA: minutos que um pedido bloqueante (permissão ou
   *  pergunta) de um run disparado por automação espera antes do app responder
   *  fail-closed sozinho. Só vale pra run desassistido — conversa que você
   *  digitou espera você pra sempre. 0 = desligado (volta a congelar). */
  unattendedAnswerAfterMin: number
  /** Medidor de janela de uso (rate limits por provider) na barra superior.
   *  Desligar esconde a pill inteira; provider sem capability/fonte nem
   *  aparece com o medidor ligado (4 camadas de esconder do Orca). */
  usageMeterEnabled: boolean
  /** Cadência do poll da janela de uso, em minutos (5 · 10 · 15). Conjunto
   *  fechado: quem valida é `pollCadenceMs`, e valor fora dele vira o padrão.
   *  Encurtar a cadência NÃO acelera o backoff de falha nem o piso do vigia. */
  usagePollMinutes: number
  /** Teto de gasto POR SESSÃO em US$ que o usuário definiu (null = sem teto).
   *  Só existe pra dar régua ao custo da sessão: sem teto o número fica cinza
   *  (medição muda); com teto ele entra na régua de medidor do §2 como
   *  percentual DESSE valor. Não é um freio: nada é bloqueado, o app não
   *  escolhe o número por ninguém. */
  sessionCostLimit: number | null
  /** CTA "Ativar medidor" (instalação da statusline) dispensado pelo usuário:
   *  persistido pra não voltar a cutucar (dismissal do Orca). A seção de
   *  Configurações continua oferecendo a instalação. */
  usageMeterCtaDismissed: boolean
  /** Ledger de resoluções de modelo OBSERVADAS (P2 da auditoria de modelos):
   *  a cada evento `session` o app grava o que o CLI resolveu pro pedido —
   *  resposta prática à falta de enumeração headless (aprende de graça a cada
   *  run real). agent → pedido ("opus", ID exato ou "default") → observação;
   *  `at` = quando ESSA resolução foi vista pela 1ª vez (muda junto com ela). */
  observedResolutions: Record<
    string,
    Record<string, { resolved: string; at: number }>
  >
  /** Perfil do usuário (nome, avatar, cor). */
  userProfile: UserProfile
  /** Preferências de interação do usuário (autor no chat, saudações, atalhos). */
  userPreferences: UserPreferences
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  conversationScale: 1,
  defaultAgent: "claude-code",
  defaultModel: "claude-opus-5[1m]",
  defaultEffort: null,
  helperModel: "haiku",
  utilityInference: DEFAULT_UTILITY_INFERENCE,
  dictationEnabled: true,
  dictationHotkey: DEFAULT_DICTATION_HOTKEY,
  dictationVocab: [],
  dictationDevice: null,
  keepAwake: "agent",
  autoResume: false,
  autoResumeMaxTries: 3,
  missionEnabled: false,
  missionPresets: DEFAULT_MISSION_PRESETS,
  onboarded: false,
  setupGuideDismissed: false,
  preferredEditor: null,
  keepInTrayOnClose: true,
  hudEnabled: false,
  hudPosition: "notch",
  hudHoverExpand: true,
  hudFollowActiveScreen: true,
  hudScreenId: null,
  trayCloseHintShown: false,
  detected: {},
  lastUpdateCheck: 0,
  lastNotifiedVersions: {},
  updateDismissed: {},
  lastCatalogRefresh: 0,
  catalogCount: 0,
  lastCuratorRun: 0,
  lastModelRound: 0,
  modelNewsDismissed: {},
  companionEnabled: false,
  stalledAfterMin: 10,
  unattendedAnswerAfterMin: 10,
  usageMeterEnabled: true,
  usagePollMinutes: 15,
  sessionCostLimit: null,
  usageMeterCtaDismissed: false,
  observedResolutions: {},
  userProfile: DEFAULT_USER_PROFILE,
  userPreferences: DEFAULT_USER_PREFERENCES,
}

/** Atualiza somente planos de fábrica intactos. `factoryRevision` registra a
 * base recebida; `revision` maior prova que houve edição e bloqueia substituição.
 * Assim uma evolução não depende do gesto destrutivo "Restaurar". */
export function reconcileMissionPresets(
  value: unknown,
  factoryPresets: readonly MissionPreset[] = DEFAULT_MISSION_PRESETS,
): MissionPreset[] {
  const stored = Array.isArray(value)
    ? value.filter(
        (plan): plan is MissionPreset =>
          !!plan && typeof plan === "object" && typeof plan.id === "string",
      )
    : []
  const factoryById = new Map(
    factoryPresets.map((plan) => [plan.id, plan]),
  )
  const seen = new Set<string>()
  const reconciled = stored.map((plan) => {
    seen.add(plan.id)
    const factory = factoryById.get(plan.id)
    if (!factory) return plan
    // Plano LEGADO (salvo antes de `factoryRevision` existir) nasceu na base 1.
    // Herdar a base do próprio `revision` fazia toda edição parecer intacta:
    // um plano legado editado (revision 2) tinha base 2, `customized` dava
    // false, e a fábrica seguinte o SUBSTITUÍA em silêncio. Como `patchPlan`
    // sobe o revision em TODA edição, `> 1` é o que separa editado de intacto.
    const baseRevision = plan.factoryRevision ?? 1
    const customized = (plan.revision ?? 1) > baseRevision
    return !customized && baseRevision < (factory.factoryRevision ?? 1)
      ? snapshotMissionPlan(factory)
      : plan
  })
  for (const factory of factoryPresets) {
    if (!seen.has(factory.id)) reconciled.push(snapshotMissionPlan(factory))
  }
  return reconciled.length > 0
    ? reconciled
    : factoryPresets.map(snapshotMissionPlan)
}
