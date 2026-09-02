// <UserAvatar> — representação da identidade do usuário no app.
// Suporta foto customizada (Data URI otimizada), avatar DiceBear,
// iniciais ou ícone padrão. Sem chamadas externas de rede.

import { useEffect, useMemo, useState } from "react"
import { User } from "lucide-react"
import { useApp } from "@/store/app"
import {
  DEFAULT_USER_PROFILE,
  getInitials,
  resolveDicebearUri,
  safeCustomAvatarDataUri,
  type UserProfile,
} from "@/lib/userProfile"
import { cn } from "@/lib/utils"

interface UserAvatarProps {
  /** Perfil a renderizar. Omitir consome diretamente do store global. */
  profile?: UserProfile
  /** Lado em pixels (quadrado). Padrão: 28px. */
  size?: number
  className?: string
  alt?: string
}

function fontSizeForAvatar(size: number): string {
  if (size <= 24) return "text-[11px]"
  if (size <= 32) return "text-[12px]"
  if (size <= 48) return "text-[14px]"
  return "text-[20px]"
}

export function UserAvatar({
  profile: propProfile,
  size = 28,
  className,
  alt = "Avatar do usuário",
}: UserAvatarProps) {
  const storeProfile = useApp((s) => s.settings.userProfile)
  const profile = propProfile ?? storeProfile ?? DEFAULT_USER_PROFILE
  const [imageError, setImageError] = useState(false)

  const initials = useMemo(
    () => getInitials(profile.initials || profile.name),
    [profile.initials, profile.name],
  )

  const dicebearUri = useMemo(() => {
    if (profile.avatarType !== "dicebear") return null
    return resolveDicebearUri(profile, Math.round(size * 2))
  }, [profile, size])

  const currentImageUri = useMemo(
    () => safeCustomAvatarDataUri(profile.customImageDataUri),
    [profile.customImageDataUri],
  )

  // Uma foto nova merece uma nova tentativa, sem atualizar estado durante o
  // render (isso é especialmente importante no Strict Mode do React).
  useEffect(() => {
    setImageError(false)
  }, [currentImageUri])

  const baseClasses = cn(
    "shrink-0 select-none overflow-hidden rounded-full object-cover",
    className,
  )
  const fallbackA11y = alt
    ? { role: "img", "aria-label": alt }
    : { "aria-hidden": true as const }

  // 1. Foto customizada
  if (profile.avatarType === "image" && currentImageUri && !imageError) {
    return (
      <img
        src={currentImageUri}
        width={size}
        height={size}
        alt={alt}
        onError={() => setImageError(true)}
        draggable={false}
        className={baseClasses}
        style={{ width: size, height: size }}
      />
    )
  }

  // 2. Avatar DiceBear
  if (profile.avatarType === "dicebear" && dicebearUri) {
    return (
      <img
        src={dicebearUri}
        width={size}
        height={size}
        alt={alt}
        draggable={false}
        className={baseClasses}
        style={{ width: size, height: size }}
      />
    )
  }

  // 3. Ícone puro
  if (profile.avatarType === "icon") {
    const iconSize = size <= 24 ? "size-3.5" : size <= 32 ? "size-4" : "size-6"
    return (
      <div
        className={cn(
          "grid place-items-center rounded-full bg-secondary text-muted-foreground",
          baseClasses,
        )}
        style={{ width: size, height: size }}
        {...fallbackA11y}
      >
        <User className={iconSize} />
      </div>
    )
  }

  // 4. Iniciais (padrão e fallback de imagem com erro)
  return (
    <div
      className={cn(
        "grid place-items-center rounded-full bg-foreground/10 font-semibold text-muted-foreground",
        fontSizeForAvatar(size),
        baseClasses,
      )}
      style={{ width: size, height: size }}
      {...fallbackA11y}
    >
      {initials}
    </div>
  )
}
