import { useState } from "react"
import {
  ChevronsUpDown,
  Info,
  Keyboard,
  Settings,
  SunMoon,
  User,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { AppDialog } from "@/components/ui/app-dialog"
import { Kbd } from "@/components/ui/kbd"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UserAvatar } from "@/components/user/UserAvatar"
import {
  commandMenuShortcut,
  commandMenuKeys,
  currentPlatform,
} from "@/lib/commandMenu"
import { useApp } from "@/store/app"

export function AccountMenu() {
  const profile = useApp((s) => s.settings.userProfile)
  const sendShortcut = useApp((s) => s.settings.userPreferences.composerSendShortcut)
  const preference = useApp((s) => s.themePreference)
  const setTheme = useApp((s) => s.setTheme)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const platform = currentPlatform()
  const shortcut = (key: string) => `${commandMenuKeys(platform)[0]} ${key}`
  const settingsShortcut = shortcut(",")
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="padrao"
            className="min-w-0 flex-1 justify-start gap-2.5"
            aria-label="Perfil do usuário e preferências"
          >
            <UserAvatar size={24} profile={profile} alt="" />
            <span className="min-w-0 flex-1 truncate text-left">
              {profile.name.trim() || "Você"}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-72"
        >
          <DropdownMenuLabel>{profile.name.trim() || "Você"}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSettingsOpen(true, "profile")}>
            <User />
            Perfil
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
            <Settings />
            Configurações
            <DropdownMenuShortcut>{settingsShortcut}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
            <Keyboard />
            Atalhos de teclado
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="flex items-center gap-2">
            <SunMoon className="size-3.5" />
            Tema
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preference}
            className="flex"
            onValueChange={(value) => {
              if (value === "dark" || value === "light" || value === "system")
                setTheme(value)
            }}
          >
            <DropdownMenuRadioItem value="light">Claro</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Escuro</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              Sistema
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSettingsOpen(true, "about")}>
            <Info />
            Sobre a Frota
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AppDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        title="Atalhos de teclado"
      >
        <dl className="space-y-3 text-[13px]">
          {[
            ["Buscar e comandos", commandMenuShortcut(platform)],
            ["Configurações", settingsShortcut],
            ["Enviar mensagem", sendShortcut === "cmd-enter" ? shortcut("Enter") : "Enter"],
            ["Nova linha na mensagem", sendShortcut === "cmd-enter" ? "Enter" : "Shift + Enter"],
            ["Aumentar texto da conversa", shortcut("+")],
            ["Diminuir texto da conversa", shortcut("−")],
            ["Restaurar tamanho do texto", shortcut("0")],
          ].map(([label, key]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4"
            >
              <dt>{label}</dt>
              <dd>
                <Kbd>{key}</Kbd>
              </dd>
            </div>
          ))}
        </dl>
      </AppDialog>
    </>
  )
}
