export type UtilityTaskKind =
  | "composer_suggestions"
  | "turn_receipt"
  | "lesson_distillation"
  | "skill_draft"
  | "model_curator"
  | "commit_message"
  | "conversation_title"

export type UtilityRoutePolicy =
  | "device_only"
  | "free_only"
  | "approved_helper"
  | "off"

export type UtilityLocality = "device" | "local-process" | "remote"

export type UtilityFailureCode =
  | "framework_unavailable"
  | "probe_failed"
  | "input_too_large"
  | "deadline_exceeded"
  | "cancelled"
  | "invalid_request"
  | "invalid_response"
  | "protocol_error"
  | "auth_required"
  | "rate_limited"
  | "spawn_failed"
  | "process_failed"
  | "security_contract_failed"
  | "stale"

export interface UtilityFailure {
  code: UtilityFailureCode
  retryable: boolean
  retryAfterMs?: number
}

export interface UtilityRequest<T> {
  attemptId: string
  task: UtilityTaskKind
  locale: string
  payload: T
  inputDigest: string
  routePolicy: UtilityRoutePolicy
  projectId?: string
  conversationId?: string
  workingDirectory?: string
  deadlineMs: number
  helperModel?: string | null
  /** Defesa no backend contra fallback remoto forjado ou herdado de outra
   *  finalidade. Só é true quando a pessoa autorizou ESTA tarefa. */
  remoteAuthorized?: boolean
}

export interface UtilityResult<T> {
  status:
    | "ok"
    | "unavailable"
    | "timed_out"
    | "invalid"
    | "cancelled"
    | "failed"
  value?: T
  source: { id: string; locality: UtilityLocality } | null
  timing: { startedAt: number; durationMs: number }
  cost?: {
    usd: number | null
    source: "reported" | "estimated" | "unknown"
  }
  fallbackReason?: UtilityFailureCode
}


export interface UtilityTaskPolicySetting {
  route: UtilityRoutePolicy
  helperSourceId: string | null
  helperModel: string | null
  remoteConsent: {
    grantedAt: number
    noticeVersion: number
  } | null
}

export interface UtilityInferenceSettings {
  version: 1
  tasks: Partial<Record<UtilityTaskKind, UtilityTaskPolicySetting>>
}

export const DEFAULT_UTILITY_INFERENCE: UtilityInferenceSettings = {
  version: 1,
  tasks: {},
}
