import {
  type MissionPreset,
  DEFAULT_MISSION_PRESETS,
} from "@/lib/missionTypes"

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
  /** Missions (beta): habilita o botão de missão no composer. */
  missionEnabled: boolean
  /** Times salvos do Mission (papel → agent/modelo). */
  missionPresets: MissionPreset[]
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  defaultAgent: "claude-code",
  defaultModel: "opus",
  defaultEffort: null,
  helperModel: "haiku",
  dictationEnabled: true,
  dictationVocab: [],
  missionEnabled: false,
  missionPresets: DEFAULT_MISSION_PRESETS,
}
