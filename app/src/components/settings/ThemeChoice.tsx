import { Button } from "@/components/ui/button"
import { useApp } from "@/store/app"

export function ThemeChoice() {
  const preference = useApp((s) => s.themePreference)
  const setTheme = useApp((s) => s.setTheme)
  return (
    <div role="group" aria-label="Tema" className="flex gap-1">
      {(
        [
          ["light", "Claro"],
          ["dark", "Escuro"],
          ["system", "Sistema"],
        ] as const
      ).map(([value, label]) => (
        <Button
          key={value}
          size="compacto"
          variant={preference === value ? "secondary" : "ghost"}
          aria-pressed={preference === value}
          onClick={() => setTheme(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}
