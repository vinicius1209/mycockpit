// <AgentAvatar> — a cara da persona (Especialistas E2). O SISTEMA (lib/avatar):
// estilo base do sistema + COR derivada da categoria + seed = nome. Passa um
// `def` (o caminho normal, resolvido por avatarFor) OU `style`/`seed`/`category`
// diretos (o preview ao vivo do criar, que ainda não tem def). Determinístico e
// offline: mesma persona, mesma cara; mesma categoria, mesma cor.

import { useMemo } from "react"
import {
  avatarDataUri,
  avatarFor,
  categoryColor,
  DEFAULT_AVATAR_STYLE,
} from "@/lib/avatar"
import { cn } from "@/lib/utils"
import type { AgentDef } from "@/lib/agentDefs"

interface Props {
  /** A persona (o caminho normal) — estilo/seed/cor via avatarFor. */
  def?: Pick<AgentDef, "category" | "avatarStyle" | "avatarSeed" | "slug" | "name">
  /** Overrides diretos — o preview ao vivo do criar passa isto (sem def). A
   *  `category` define a COR mesmo sem def. */
  style?: string
  seed?: string
  category?: string
  /** Lado em px (o SVG é gerado no dobro pra ficar nítido em telas retina). */
  size?: number
  rounded?: boolean
  className?: string
}

export function AgentAvatar({
  def,
  style,
  seed,
  category,
  size = 40,
  rounded = false,
  className,
}: Props) {
  const base = def ? avatarFor(def) : undefined
  const st = style ?? base?.style ?? DEFAULT_AVATAR_STYLE
  const sd = seed ?? base?.seed ?? "x"
  // cor: override explícito da categoria (preview) → categoria do def → brass.
  const bg =
    category !== undefined
      ? categoryColor(category)
      : base?.backgroundColor ?? categoryColor()
  const uri = useMemo(
    () => avatarDataUri(st, sd, Math.round(size * 2), bg),
    [st, sd, size, bg],
  )
  return (
    <img
      src={uri}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        "shrink-0 rounded-[9px] bg-card object-cover",
        rounded && "rounded-full",
        className,
      )}
      style={{ width: size, height: size }}
    />
  )
}
