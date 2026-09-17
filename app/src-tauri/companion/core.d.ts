// Tipos do núcleo puro do Companion Web (core.js, UMD → global CompanionCore).
// O runtime é SEMPRE o core.js servido pelo binário; este .d.ts só descreve o
// shape pro tsc (o vitest importa o .js real por efeito colateral e lê o
// global). Mudou o core.js? Este arquivo acompanha.
export {}

declare global {
  interface CompanionWebRoute {
    screen: "brief" | "agents" | "chat" | "launch" | "painel"
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

  /** Faixa contígua do fio (C3): itens + índice do primeiro no fio completo. */
  interface CompanionWebThread {
    items: unknown[]
    start: number
  }

  interface CompanionWebHomeConversation {
    convId: string
    projectId: string
    projectName: string
    /** Motor da conversa, ou o primeiro utilizável do projeto; null = não abre. */
    agent: string | null
    title: string
    updatedAt: number
    running: boolean
    pedeVoce: boolean
  }

  var CompanionCore: {
    homeConversations(snap: unknown, projectId?: string | null): CompanionWebHomeConversation[]
    machineName(raw: string | null | undefined): string | null
    notificationTitle(machine: string | null | undefined, text: string): string
    parseChatShortcut(
      text: string | null | undefined,
    ): { kind: "stop" } | { kind: "message"; text: string }
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
    renderMarkdown(text: string | null | undefined): string
    elapsedLabel(nowMs: number, atMs: number | null | undefined): string
    mergeThreadTail(
      cur: CompanionWebThread | null | undefined,
      tail: CompanionWebThread | null | undefined,
    ): CompanionWebThread | null
    mergeThreadOlder(
      cur: CompanionWebThread | null | undefined,
      older: CompanionWebThread | null | undefined,
    ): CompanionWebThread | null
    adoptConvOnVerdict(
      chat: { convId?: string | null; projectId?: string; agent?: string } | null | undefined,
      verdict: { ok?: boolean; convId?: unknown; projectId?: string; agent?: string } | null | undefined,
    ): boolean
    blobUrlPath(path: unknown): string | null
    pairTokenFromHash(hash: string | null | undefined): string | null
    deviceLabel(ua: string | null | undefined): string
    effectiveTheme(
      stored: string | null | undefined,
      systemDark: boolean,
    ): "light" | "dark"
    SNAP_MAX_AGE_MS: number
    snapshotRestorable(nowMs: number, atMs: number | null | undefined): boolean
    titleBadge(base: string | null | undefined, n: number | null | undefined): string
  }
}
