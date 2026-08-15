// Sessões EXTERNAS observadas pelos hooks (H1), prontas para a tray.
//
// Extraído do App.tsx porque a catraca de tamanho disparou e a regra da casa é
// dividir o arquivo, nunca subir o teto. É unidade fechada: uma pergunta ("que
// sessões estão rodando fora do app?"), uma resposta já resolvida.
//
// O rótulo e o projeto são resolvidos AQUI, no TypeScript: o Rust da bandeja só
// exibe o que chega pronto. Isso mantém o lado nativo burro de propósito — ele
// não conhece registry de motor nem lista de projetos, e não precisa conhecer.

import {
  engineLabel,
  sessionPlace,
  visibleSessions,
  useExternalSessions,
} from "@/lib/externalSessions"
import type { TrayExternalSession } from "@/lib/tray"
import type { Project } from "@/lib/types"

export function trayExternalSessions(projects: Project[]): TrayExternalSession[] {
  return visibleSessions(useExternalSessions.getState().sessions).map((s) => ({
    agent: engineLabel(s.agent),
    place: sessionPlace(s, projects),
    status: s.status,
    lastSeen: s.lastSeen,
  }))
}
