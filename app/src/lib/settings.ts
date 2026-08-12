import {
  type MissionPreset,
  DEFAULT_MISSION_PRESETS,
} from "@/lib/missionTypes"
import type { AgentProbe } from "@/lib/detect"
import { DEFAULT_DICTATION_HOTKEY } from "@/lib/dictationHotkey"

// Preferências GLOBAIS do app (persistidas via zustand persist → localStorage,
// que o webview do Tauri guarda em disco entre reinícios). Distinto do config
// POR-PROJETO (.mycockpit/config.toml), que segue vivendo no ContextPanel.
export interface GlobalSettings {
  /** Agent pré-selecionado ao abrir uma conversa nova. */
  defaultAgent: string
  /** Modelo default (null = default do agent, "default"). */
  defaultModel: string | null
  /** Effort default (null = "default"). */
  defaultEffort: string | null
  /** Modelo helper das sugestões quando o projeto não define um no config.toml.
   *  null = sugestões desligadas por padrão. */
  helperModel: string | null
  /** Liga/desliga o botão de ditado (mic) globalmente. */
  dictationEnabled: boolean
  /** Atalho do ditado, serializado "modificadores+e.code" (ex. "alt+Space",
   *  "ctrl+alt+KeyD" — ver lib/dictationHotkey). null = atalho desativado
   *  (o mic segue clicável). */
  dictationHotkey: string | null
  /** Termos extras de vocabulário do ditado (somados aos fixos do MicButton). */
  dictationVocab: string[]
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
  /** Fechar a janela mantém o motor vivo e acessível pela barra de menus. */
  keepInTrayOnClose: boolean
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
  /** Epoch ms do último refresh do catálogo de modelos (models.dev via Rust).
   *  0 = nunca. Alimenta a linha "Tabela de preços" em Configurações ▸ Agents. */
  lastCatalogRefresh: number
  /** Nº de modelos no snapshot local do catálogo (informativo). */
  catalogCount: number
  /** Epoch ms da última rodada do curador de modelos (máx. 1x/semana). */
  lastCuratorRun: number
  /** Companion Web (celular na LAN): liga o servidor local + a ponte de push.
   *  OPT-IN (default false) — abre uma porta na rede local. */
  companionEnabled: boolean
  /** Vigia de turno mudo: minutos de silêncio (turno running sem NENHUM item
   *  novo) até notificar. 0 = desligado. */
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
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  defaultAgent: "claude-code",
  defaultModel: "claude-opus-5[1m]",
  defaultEffort: null,
  helperModel: "haiku",
  dictationEnabled: true,
  dictationHotkey: DEFAULT_DICTATION_HOTKEY,
  dictationVocab: [],
  autoResume: false,
  autoResumeMaxTries: 5,
  missionEnabled: false,
  missionPresets: DEFAULT_MISSION_PRESETS,
  onboarded: false,
  setupGuideDismissed: false,
  keepInTrayOnClose: true,
  trayCloseHintShown: false,
  detected: {},
  lastUpdateCheck: 0,
  lastNotifiedVersions: {},
  lastCatalogRefresh: 0,
  catalogCount: 0,
  lastCuratorRun: 0,
  companionEnabled: false,
  stalledAfterMin: 10,
  unattendedAnswerAfterMin: 10,
  usageMeterEnabled: true,
  usageMeterCtaDismissed: false,
  observedResolutions: {},
}
