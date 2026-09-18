import type { UtilityTaskKind } from "./types"

export interface UtilityTaskProfile {
  task: UtilityTaskKind
  promptVersion: number
  priority: "high" | "normal" | "low"
  defaultDeadlineMs: number
  maxInputBytes: number
  requiresStructuredOutput: boolean
  canPersist: boolean
  canUseBillableSource: boolean
}

export const UTILITY_PROFILES: Record<UtilityTaskKind, UtilityTaskProfile> = {
  conversation_title: {
    task: "conversation_title",
    promptVersion: 1,
    // Ninguém está esperando: o turno acabou e a sidebar já tem um nome cru.
    priority: "low",
    defaultDeadlineMs: 4_000,
    // O recorte é o pedido + a última resposta, os dois com teto de 600 chars.
    maxInputBytes: 16 * 1024,
    requiresStructuredOutput: false,
    // Persiste em `conversations.title`, que é o campo que já existia.
    canPersist: true,
    canUseBillableSource: true,
  },
  conversation_map: {
    task: "conversation_map",
    promptVersion: 6,
    priority: "normal",
    // Medido no M1 Pro, macOS 26.3: 28,9 s no cold start e 11,5 s aquecido.
    // O trabalho é assíncrono e preserva o snapshot anterior durante a espera.
    defaultDeadlineMs: 45_000,
    maxInputBytes: 256 * 1024,
    requiresStructuredOutput: true,
    canPersist: true,
    canUseBillableSource: true,
  },
  composer_suggestions: {
    task: "composer_suggestions",
    promptVersion: 1,
    priority: "low",
    defaultDeadlineMs: 4_000,
    maxInputBytes: 16 * 1024,
    requiresStructuredOutput: true,
    canPersist: true,
    canUseBillableSource: true,
  },
  turn_receipt: {
    task: "turn_receipt",
    promptVersion: 1,
    priority: "high",
    defaultDeadlineMs: 3_000,
    maxInputBytes: 16 * 1024,
    requiresStructuredOutput: false,
    canPersist: false,
    canUseBillableSource: true,
  },
  lesson_distillation: {
    task: "lesson_distillation",
    promptVersion: 1,
    priority: "low",
    defaultDeadlineMs: 8_000,
    maxInputBytes: 32 * 1024,
    requiresStructuredOutput: true,
    canPersist: true,
    canUseBillableSource: true,
  },
  skill_draft: {
    task: "skill_draft",
    promptVersion: 1,
    priority: "low",
    defaultDeadlineMs: 15_000,
    maxInputBytes: 64 * 1024,
    requiresStructuredOutput: false,
    canPersist: false,
    canUseBillableSource: true,
  },
  model_curator: {
    task: "model_curator",
    promptVersion: 1,
    priority: "low",
    defaultDeadlineMs: 20_000,
    maxInputBytes: 64 * 1024,
    requiresStructuredOutput: true,
    canPersist: true,
    canUseBillableSource: true,
  },
  commit_message: {
    task: "commit_message",
    promptVersion: 2,
    priority: "low",
    // Gesto da pessoa, com spinner no botão. 8s nunca bastou: medido em
    // 15/09/2026 com o diff real de 17 mil caracteres, o helper levou 11,5s
    // mesmo sem raciocínio e sem hooks (a única chamada do dia deu 8,4s e
    // estourou). O gateway limita tudo a 45s.
    defaultDeadlineMs: 30_000,
    maxInputBytes: 64 * 1024,
    requiresStructuredOutput: false,
    canPersist: false,
    canUseBillableSource: true,
  },
}
