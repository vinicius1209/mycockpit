// Tipos do núcleo puro do Companion Web (core.js, UMD → global CompanionCore).
// O runtime é SEMPRE o core.js servido pelo binário; este .d.ts só descreve o
// shape pro tsc (o vitest importa o .js real por efeito colateral e lê o
// global). Mudou o core.js? Este arquivo acompanha.
export {}

declare global {
  interface CompanionWebRoute {
    screen: "brief" | "agents" | "chat"
    projectId?: string
    agent?: string
    convId?: string
  }

  interface CompanionWebConnState {
    status: "connecting" | "on" | "reconnecting"
    attempt: number
    retryInMs: number | null
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
    seenAgo(nowMs: number, atMs: number | null | undefined): string
  }
}
