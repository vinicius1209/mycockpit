// A migração do estado persistido do app (`mc.app`), fora do store porque é
// recorte fechado: regra pura, versão a versão, com o risco mais caro do arquivo
// (viewMode órfão = boot em modo inexistente). Saiu do `store/app.ts` quando a
// catraca de tamanho disparou; a porta antiga continua valendo (o `app.ts`
// re-exporta), então nenhum call site mudou.

import type { AppState } from "@/store/app"
import { DEFAULT_SETTINGS } from "@/lib/settings"

/** Os modos de vista que existem hoje. Moram aqui, e não no store, porque quem
 *  precisa deles de verdade é a migração: qualquer valor persistido fora desta
 *  união vira "linear" em vez de virar tela branca. */
export const VIEW_MODES = ["painel", "linear"] as const
export type ViewMode = (typeof VIEW_MODES)[number]

/** Migração PURA do estado persistido (mc.app) — exportada p/ teste porque o
 *  risco dela é o pior tipo: viewMode órfão persistido = boot num modo que não
 *  existe (tela branca) pra TODO usuário existente.
 *  - v<2: estado persistido = usuário existente → onboarded=true (instalação
 *    nova não passa por migrate → wizard aparece).
 *  - v<3: modo Fusion dissolvido (F3) → "fusion" vira "linear".
 *  - v<4: Escritório removido (office-removal-plan R2) → "office" cai em
 *    "linear" (Trabalho), nunca tela branca.
 *  - v<5: Features (SDD) removida (remocao-features-prd D4) → "sdd" e QUALQUER
 *    valor fora de `VIEW_MODES` caem em "linear". A regra do v4 foi absorvida
 *    aqui: "fora da união atual" já cobre "office". */
export function migratePersistedApp(
  persisted: unknown,
  fromVersion: number,
): AppState {
  const p = (persisted ?? {}) as {
    settings?: Record<string, unknown>
    viewMode?: string
  }
  if (fromVersion < 2) {
    p.settings = { ...(p.settings ?? {}), onboarded: true }
  }
  if (fromVersion < 3 && p.viewMode === "fusion") {
    p.viewMode = "linear"
  }
  if (
    fromVersion < 5 &&
    p.viewMode != null &&
    !(VIEW_MODES as readonly string[]).includes(p.viewMode)
  ) {
    p.viewMode = "linear"
  }
  if (p.settings) {
    if (!p.settings.userProfile) {
      p.settings.userProfile = DEFAULT_SETTINGS.userProfile
    }
    if (!p.settings.userPreferences) {
      p.settings.userPreferences = DEFAULT_SETTINGS.userPreferences
    }
  }
  return p as unknown as AppState
}
