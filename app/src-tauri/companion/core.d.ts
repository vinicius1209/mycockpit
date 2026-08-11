// Tipos do núcleo puro do Companion Web (core.js, UMD → global CompanionCore).
// O runtime é SEMPRE o core.js servido pelo binário; este .d.ts só descreve o
// shape pro tsc (o vitest importa o .js real por efeito colateral e lê o
// global). Mudou o core.js? Este arquivo acompanha.
export {}

declare global {
  interface CompanionWebRoute {
    screen: "brief" | "agents" | "chat" | "launch"
    projectId?: string
    agent?: string
    convId?: string
  }

  interface CompanionWebStopDisposition {
    can: boolean
    label: string
    reason: string | null
  }

  interface CompanionWebChoice {
    header: string
    question: string
    multiSelect: boolean
    options: { label: string; description: string }[]
  }

  interface CompanionWebPick {
    selected?: string[]
    other?: string
  }

  interface CompanionWebConnState {
    status: "connecting" | "on" | "reconnecting"
    attempt: number
    retryInMs: number | null
  }

  interface CompanionWebOfflineInput {
    mock: boolean
    token: boolean
    screen: string
    conn: string
    connStatus: CompanionWebConnState["status"]
    snapStale: boolean
  }

  var CompanionCore: {
    parseRoute(hash: string): CompanionWebRoute
    routeHash(route: Partial<CompanionWebRoute> | null | undefined): string
    backoffDelay(attempt: number): number
    connReduce(
      state: CompanionWebConnState | null,
      event: string,
    ): CompanionWebConnState
    connLabel(state: CompanionWebConnState | null): string
    offlineBanner(s: CompanionWebOfflineInput | null): boolean
    seenAgo(nowMs: number, atMs: number | null | undefined): string
    stopDisposition(
      item: { finalizing?: boolean } | null | undefined,
    ): CompanionWebStopDisposition
    makeActionId(rand?: () => number): string
    ACTION_REUSE_TTL_MS: number
    launchRetryDisposition(
      nowMs: number,
      sentAtMs: number | null | undefined,
    ): { reuse: boolean; warn: string | null }
    buildQuestionAnswer(
      choices: CompanionWebChoice[] | null | undefined,
      picks: (CompanionWebPick | null | undefined)[] | null | undefined,
    ): { answers: { header: string; selected: string[] }[] } | null
  }
}
