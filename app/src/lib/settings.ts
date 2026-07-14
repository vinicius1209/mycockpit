import {
  type MissionPreset,
  DEFAULT_MISSION_PRESETS,
} from "@/lib/missionTypes"
import type { AgentProbe } from "@/lib/detect"

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
  /** Times salvos do Mission (papel → agent/modelo). */
  missionPresets: MissionPreset[]
  /** Onboarding: false = mostra o wizard no boot. Migração seta true p/ quem já
   *  tem estado persistido (não é primeira instalação). */
  onboarded: boolean
  /** Último snapshot da detecção de agents (por id). Alimenta o seletor e o
   *  bloco "Agents na máquina" das Configurações. */
  detected: Record<string, AgentProbe>
  /** Epoch ms da última checagem diária de update dos agents (0 = nunca). */
  lastUpdateCheck: number
  /** Última versão `latest` já NOTIFICADA por agent (dedupe: nunca repete a
   *  notificação da mesma versão). */
  lastNotifiedVersions: Record<string, string>
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  defaultAgent: "claude-code",
  defaultModel: "opus",
  defaultEffort: null,
  helperModel: "haiku",
  dictationEnabled: true,
  dictationVocab: [],
  autoResume: false,
  autoResumeMaxTries: 5,
  missionEnabled: false,
  missionPresets: DEFAULT_MISSION_PRESETS,
  onboarded: false,
  detected: {},
  lastUpdateCheck: 0,
  lastNotifiedVersions: {},
}
