// Passo 2 — aparência. Salva NA SELEÇÃO: o preview ao vivo é o app inteiro
// atrás do overlay virando junto (inclusive esta janela). Quem PULA este passo
// leva o tema de volta pro que estava (regra do Orca) — a reversão fica no
// wizard, que é quem sabe como o passo foi deixado.

import { Moon, Sun } from "lucide-react"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"
import type { Theme } from "./flow"

const TILES: { id: Theme; label: string; hint: string }[] = [
  { id: "dark", label: "Escuro", hint: "o padrão do cockpit" },
  { id: "light", label: "Claro", hint: "para sala clara" },
]

export function ThemeStep() {
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)

  function pick(target: Theme) {
    if (theme !== target) toggleTheme()
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[14px] font-semibold text-foreground">
          Escuro ou claro?
        </h2>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
          Vale pro app inteiro, inclusive a janelinha da barra de menus. Clique
          para ver na hora.
        </p>
      </div>
      <div role="radiogroup" className="grid grid-cols-2 gap-3">
        {TILES.map((t) => {
          const selected = theme === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => pick(t.id)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border px-4 py-6 transition-colors",
                selected
                  ? "border-brass/70 bg-brass/10"
                  : "border-border/60 hover:border-border",
              )}
            >
              {t.id === "dark" ? (
                <Moon
                  className={cn(
                    "size-5",
                    selected ? "text-brass" : "text-muted-foreground",
                  )}
                />
              ) : (
                <Sun
                  className={cn(
                    "size-5",
                    selected ? "text-brass" : "text-muted-foreground",
                  )}
                />
              )}
              <span className="text-[13px] text-foreground">{t.label}</span>
              <span className="text-[11px] text-muted-foreground">{t.hint}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
