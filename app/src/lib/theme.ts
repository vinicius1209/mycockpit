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

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
  if (isTauri())
    void emit("app://theme", theme).catch((error) =>
      console.error("Falha ao sincronizar tema da bandeja", error),
    )
}
