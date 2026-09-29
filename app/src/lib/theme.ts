import { emit } from "@tauri-apps/api/event"
import { isTauri } from "@/lib/db"

export type Theme = "dark" | "light"
export type ThemePreference = Theme | "system"
export const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)"

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
): Theme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference
}

export function currentTheme(preference: ThemePreference): Theme {
  return resolveTheme(
    preference,
    typeof matchMedia === "function" && matchMedia(SYSTEM_THEME_QUERY).matches,
  )
}

/** O que viaja em `app://theme` para as outras janelas (bandeja, HUD). */
export interface TemaDoApp {
  tema: Theme
  preferencia: ThemePreference
}

/**
 * O tema a pedir ao `setTheme` da janela nativa. No macOS esse pedido vale
 * para o APP inteiro, não só para a janela: fixar "claro" numa janela trava o
 * `prefers-color-scheme` de todas, e "Sistema" deixa de seguir o macOS.
 * `null` devolve a aparência ao sistema.
 */
export function temaNativo(preferencia: ThemePreference): Theme | null {
  return preferencia === "system" ? null : preferencia
}

/** Lê a preferência persistida antes do React (entradas da bandeja e do
 *  painel do navegador). Sem nada salvo, escuro. */
export function preferenciaPersistida(estado: { state?: Record<string, unknown> } | null): ThemePreference {
  const p = estado?.state?.themePreference
  if (p === "system" || p === "light" || p === "dark") return p
  return estado?.state?.theme === "light" ? "light" : "dark"
}

export function applyTheme(theme: Theme, preferencia: ThemePreference = theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
  if (!isTauri()) return
  const payload: TemaDoApp = { tema: theme, preferencia }
  void emit("app://theme", payload).catch((error) =>
    console.error("Falha ao sincronizar tema da bandeja", error),
  )
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(temaNativo(preferencia)))
    .catch((error) => console.error("Falha ao aplicar o tema nativo", error))
}
