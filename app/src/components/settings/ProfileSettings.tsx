// Configurações ▸ Perfil.
// Permite ao usuário alterar imagem de perfil (foto, avatar DiceBear, iniciais ou ícone),
// nome de exibição, formato de autor nas mensagens e atalhos do composer.

import { useRef, useState } from "react"
import { Dices, Trash2, Upload } from "lucide-react"
import { avisar, mensagemDe } from "@/lib/avisos"
import { useApp } from "@/store/app"
import { UserAvatar } from "@/components/user/UserAvatar"
import {
  DEFAULT_USER_PREFERENCES,
  DEFAULT_USER_PROFILE,
  DICEBEAR_USER_COLORS,
  DICEBEAR_USER_STYLES,
  playTaskDoneChime,
  processAvatarImage,
  safeCustomAvatarDataUri,
  type ChatAuthorDisplay,
  type ComposerSendShortcut,
  type UserAvatarType,
} from "@/lib/userProfile"
import { Button } from "@/components/ui/button"
import { ColorSwatch } from "@/components/ui/color-swatch"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { RichSelect } from "@/components/ui/RichSelect"
import {
  Block,
  BlockTitle,
  Card,
  Field,
  Note,
  SectionHeader,
} from "@/components/settings/parts"
import { sectionDef } from "@/components/settings/sections"
import { cn } from "@/lib/utils"

const AVATAR_TYPE_LABELS: Record<UserAvatarType, string> = {
  image: "Foto",
  dicebear: "Ilustrado",
  initials: "Iniciais",
  icon: "Ícone",
}

export function ProfileSettings() {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const def = sectionDef("profile")

  const profile = settings.userProfile ?? DEFAULT_USER_PROFILE
  const prefs = settings.userPreferences ?? DEFAULT_USER_PREFERENCES
  const hasCustomImage = safeCustomAvatarDataUri(profile.customImageDataUri) != null
  const displayName = profile.name.trim()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isProcessingImage, setIsProcessingImage] = useState(false)

  function updateProfile(patch: Partial<typeof profile>) {
    setSettings({
      userProfile: { ...profile, ...patch },
    })
  }

  function updatePreferences(patch: Partial<typeof prefs>) {
    setSettings({
      userPreferences: { ...prefs, ...patch },
    })
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    setIsProcessingImage(true)
    try {
      const dataUri = await processAvatarImage(file, 256)
      updateProfile({
        avatarType: "image",
        customImageDataUri: dataUri,
      })
      avisar.feito("Foto de perfil atualizada")
    } catch (err) {
      avisar.erro("Não consegui carregar a imagem.", { detalhe: mensagemDe(err) })
    } finally {
      setIsProcessingImage(false)
    }
  }

  function removeCustomImage() {
    updateProfile({
      customImageDataUri: null,
      avatarType: displayName ? "initials" : "icon",
    })
    avisar.feito(displayName ? "Foto removida. Usando iniciais." : "Foto removida.")
  }

  function randomizeDicebearSeed() {
    const random = Math.random().toString(36).substring(2, 8)
    updateProfile({
      avatarType: "dicebear",
      dicebearSeed: random,
    })
  }

  async function previewTaskDoneChime() {
    if (!(await playTaskDoneChime())) {
      avisar.erro("Não foi possível reproduzir o som nesta máquina.")
    }
  }

  return (
    <div>
      <SectionHeader title={def.title} description={def.question} />

      {/* 1. Identidade visual */}
      <Block>
        <BlockTitle hint="Escolha como você aparece no rodapé e nas mensagens do chat.">
          Identidade visual
        </BlockTitle>

        <Card className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
            <UserAvatar profile={profile} size={64} className="shadow-xs" alt="" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-foreground">
                {displayName || "Você"}
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Tipo atual: {AVATAR_TYPE_LABELS[profile.avatarType]}
              </p>
            </div>
          </div>

          <div className="mt-4 border-t border-border/40 pt-3">
            <div className="text-[12px] font-medium text-muted-foreground mb-2">
              Modo do avatar
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Modo do avatar">
              {(["image", "dicebear", "initials", "icon"] as UserAvatarType[]).map((type) => (
                <Button
                  key={type}
                  type="button"
                  size="compacto"
                  variant={profile.avatarType === type ? "secondary" : "ghost"}
                  aria-pressed={profile.avatarType === type}
                  className={cn(
                    profile.avatarType === type && "font-medium text-foreground",
                  )}
                  onClick={() => updateProfile({ avatarType: type })}
                >
                  {AVATAR_TYPE_LABELS[type]}
                </Button>
              ))}
            </div>
          </div>

          {/* Opções específicas: Foto */}
          {profile.avatarType === "image" && (
            <div className="mt-4 border-t border-border/40 pt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => void handleFileSelected(e)}
                className="hidden"
                aria-label="Selecionar foto de perfil"
              />
              <Button
                type="button"
                variant="outline"
                size="compacto"
                disabled={isProcessingImage}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-3.5" />
                {hasCustomImage ? "Trocar foto..." : "Escolher foto do computador..."}
              </Button>
              {hasCustomImage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="compacto"
                  className="text-muted-foreground hover:text-st-error"
                  onClick={removeCustomImage}
                >
                  <Trash2 className="size-3.5" />
                  Remover foto
                </Button>
              )}
              <Note>
                Imagens em PNG, JPG, WebP ou GIF. O corte e a otimização ocorrem localmente na máquina.
              </Note>
            </div>
          )}

          {/* Opções específicas: DiceBear */}
          {profile.avatarType === "dicebear" && (
            <div className="mt-4 border-t border-border/40 pt-3 flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[12px] text-foreground">Estilo do avatar</span>
                <div className="w-48">
                  <RichSelect
                    value={profile.dicebearStyle || "personas"}
                    onValueChange={(v) => updateProfile({ dicebearStyle: v })}
                    options={DICEBEAR_USER_STYLES.map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[12px] text-foreground">Semente visual</span>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={profile.dicebearSeed}
                    placeholder={displayName || "usuário"}
                    maxLength={128}
                    onChange={(e) => updateProfile({ dicebearSeed: e.target.value })}
                    className="w-36"
                    aria-label="Semente do avatar"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="compacto"
                    onClick={randomizeDicebearSeed}
                    title="Gerar combinação aleatória"
                    aria-label="Gerar combinação aleatória"
                  >
                    <Dices className="size-3.5" />
                    Aleatório
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[12px] text-foreground">Cor de fundo</span>
                <div className="flex items-center gap-1.5" role="group" aria-label="Cor de fundo">
                  {DICEBEAR_USER_COLORS.map((c) => (
                    <ColorSwatch
                      key={c.hex}
                      color={c.hex}
                      label={c.label}
                      selected={profile.dicebearColor === c.hex}
                      onSelect={() => updateProfile({ dicebearColor: c.hex })}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Opções específicas: Iniciais */}
          {profile.avatarType === "initials" && (
            <div className="mt-4 border-t border-border/40 pt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[12px] text-foreground">Iniciais manuais</div>
                <div className="text-[11px] text-muted-foreground">
                  Deixe em branco para derivar automaticamente do seu nome.
                </div>
              </div>
              <Input
                value={profile.initials ?? ""}
                placeholder={displayName ? displayName.slice(0, 2).toUpperCase() : "U"}
                maxLength={3}
                onChange={(e) =>
                  updateProfile({
                    initials: e.target.value.trim() ? e.target.value.trim().toUpperCase() : null,
                  })
                }
                className="w-20 text-center font-mono uppercase"
                aria-label="Iniciais manuais"
              />
            </div>
          )}
        </Card>
      </Block>

      {/* 2. Nome e exibição */}
      <Block>
        <BlockTitle hint="Configure como você é identificado e cumprimentado.">
          Nome e identificação
        </BlockTitle>

        <div className="divide-y divide-border/40">
          <Field
            label="Nome de exibição"
            hint="Aparece no rodapé da barra lateral e na tela inicial."
          >
            <Input
              value={profile.name}
              onChange={(e) => updateProfile({ name: e.target.value })}
              placeholder="Seu nome"
              maxLength={80}
              className="w-48"
              aria-label="Nome de exibição"
            />
          </Field>

          <Field
            label="Identificação nas mensagens"
            hint="Nome no cabeçalho dos seus turnos no chat."
          >
            <div className="w-48">
              <RichSelect
                value={prefs.chatAuthorDisplay}
                onValueChange={(v) =>
                  updatePreferences({ chatAuthorDisplay: v as ChatAuthorDisplay })
                }
                options={[
                  {
                    value: "you",
                    label: "Você",
                    description: "Padrão clássico de conversas",
                  },
                  {
                    value: "name",
                    label: displayName || "Seu nome",
                    description: "Exibe o nome configurado",
                  },
                ]}
              />
            </div>
          </Field>

          <Field
            label="Nome na tela de início"
            hint="Inclui seu nome na saudação ao abrir uma conversa vazia."
          >
            <Switch
              checked={prefs.greetingWithName}
              onCheckedChange={(v) => updatePreferences({ greetingWithName: v })}
              aria-label="Nome na tela de início"
            />
          </Field>
        </div>
      </Block>

      {/* 3. Composer e interação */}
      <Block>
        <BlockTitle hint="Preferências de digitação e resposta de tarefas.">
          Composer e interação
        </BlockTitle>

        <div className="divide-y divide-border/40">
          <Field
            label="Atalho de envio"
            hint="Como o teclado despacha prompts no campo de texto."
          >
            <div className="w-56">
              <RichSelect
                value={prefs.composerSendShortcut}
                onValueChange={(v) =>
                  updatePreferences({
                    composerSendShortcut: v as ComposerSendShortcut,
                  })
                }
                options={[
                  {
                    value: "enter",
                    label: "Enter envia",
                    description: "Shift+Enter insere quebra de linha",
                  },
                  {
                    value: "cmd-enter",
                    label: "⌘+Enter envia",
                    description: "Enter insere quebra de linha",
                  },
                ]}
              />
            </div>
          </Field>

          <Field
            label="Som ao concluir tarefas"
            hint="Toca um acorde suave quando um plano ou turno longo terminar."
          >
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="compacto"
                onClick={() => void previewTaskDoneChime()}
                title="Ouvir demonstração do som"
                aria-label="Ouvir som"
              >
                Testar som
              </Button>
              <Switch
                checked={prefs.soundAlertsEnabled}
                onCheckedChange={(v) => updatePreferences({ soundAlertsEnabled: v })}
                aria-label="Som ao concluir tarefas"
              />
            </div>
          </Field>
        </div>
      </Block>
    </div>
  )
}
