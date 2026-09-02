// Perfil e preferências de usuário do Frota.
// Suporta foto própria (recortada e otimizada em canvas para WebP/PNG),
// avatares ilustrados DiceBear (via lib/avatar.ts), iniciais ou ícone.

import { avatarDataUri } from "@/lib/avatar"

export type UserAvatarType = "image" | "dicebear" | "initials" | "icon"
export type ChatAuthorDisplay = "you" | "name"
export type ComposerSendShortcut = "enter" | "cmd-enter"

export interface UserProfile {
  /** Nome de exibição (ex.: "Vinícius"). */
  name: string
  /** Tipo de avatar em uso. */
  avatarType: UserAvatarType
  /** Data URI da imagem customizada recortada e compactada (quando avatarType === "image"). */
  customImageDataUri: string | null
  /** Estilo do DiceBear (quando avatarType === "dicebear"). */
  dicebearStyle: string
  /** Semente do DiceBear. String vazia usa o próprio nome. */
  dicebearSeed: string
  /** Cor do fundo/domínio do avatar DiceBear (formato hex). */
  dicebearColor: string
  /** Iniciais customizadas (quando avatarType === "initials"). Null calcula do nome. */
  initials: string | null
}

export interface UserPreferences {
  /** Rótulo do autor nas mensagens do chat: "you" ("Você") ou "name" (o nome configurado). */
  chatAuthorDisplay: ChatAuthorDisplay
  /** Inclui o nome do usuário na mensagem de boas-vindas do painel inicial. */
  greetingWithName: boolean
  /** Atalho de envio de mensagem no composer: "enter" (Enter envia) ou "cmd-enter" (⌘+Enter envia). */
  composerSendShortcut: ComposerSendShortcut
  /** Emite um feedback sonoro sutil quando um plano ou turno longo conclui. */
  soundAlertsEnabled: boolean
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  name: "",
  avatarType: "icon",
  customImageDataUri: null,
  dicebearStyle: "personas",
  dicebearSeed: "",
  dicebearColor: "#e4a862",
  initials: null,
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  chatAuthorDisplay: "you",
  greetingWithName: true,
  composerSendShortcut: "enter",
  soundAlertsEnabled: false,
}

export const DICEBEAR_USER_STYLES: readonly [string, string][] = [
  ["personas", "Personas"],
  ["notionists", "Pessoas"],
  ["thumbs", "Thumbs"],
  ["bottts", "Robôs"],
  ["shapes", "Formas"],
  ["fun-emoji", "Emoji"],
] as const

/** Paleta fechada do avatar ilustrado. As cores vivem aqui, e não no
 * componente, porque são dados da ilustração gerada, não tinta de estado da
 * interface. */
export const DICEBEAR_USER_COLORS: readonly {
  label: string
  hex: string
}[] = [
  { label: "Dourado", hex: "#e4a862" },
  { label: "Azul", hex: "#60a5fa" },
  { label: "Verde", hex: "#34d399" },
  { label: "Âmbar", hex: "#fbbf24" },
  { label: "Roxo", hex: "#a78bfa" },
  { label: "Rosa", hex: "#f472b6" },
  { label: "Vermelho", hex: "#f87171" },
] as const

/** Extrai 1 ou 2 letras maiúsculas para o avatar de iniciais. */
export function getInitials(name?: string | null, fallback = "U"): string {
  if (!name || !name.trim()) return fallback
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback
  if (parts.length === 1) {
    const word = parts[0]
    return word.slice(0, Math.min(2, word.length)).toUpperCase()
  }
  const first = parts[0][0] ?? ""
  const last = parts[parts.length - 1][0] ?? ""
  return (first + last).toUpperCase() || fallback
}

const CUSTOM_AVATAR_DATA_URI =
  /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\r\n]+$/i

/** Uma foto customizada nunca pode virar transporte de rede. Estado legado ou
 * adulterado cai no avatar local em vez de entregar uma URL ao WebView. */
export function safeCustomAvatarDataUri(value?: string | null): string | null {
  if (!value || !CUSTOM_AVATAR_DATA_URI.test(value)) return null
  return value
}

/** Resolve a data URI para renderização do avatar DiceBear. */
export function resolveDicebearUri(profile: UserProfile, size = 64): string {
  const seed = (profile.dicebearSeed || profile.name || "user").trim().slice(0, 128)
  const style = profile.dicebearStyle || "personas"
  const color = /^#[0-9a-f]{6}$/i.test(profile.dicebearColor)
    ? profile.dicebearColor
    : "#e4a862"
  return avatarDataUri(style, seed, size, color)
}

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

/**
 * Processa uma imagem selecionada pelo usuário:
 * Valida o formato, realiza crop central quadrado em canvas e converte
 * para Data URI WebP (ou PNG) otimizada para armazenamento local (~15–30 KB).
 */
export async function processAvatarImage(
  file: File,
  maxDimension = 256,
): Promise<string> {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Formato não suportado. Escolha uma imagem PNG, JPG, WebP ou GIF.")
  }

  // Proteção contra arquivos gigantescos antes de decodificar (> 10MB)
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("A imagem é muito grande. Escolha um arquivo de até 10 MB.")
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo de imagem."))
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onerror = () => reject(new Error("Não foi possível decodificar a imagem."))
      img.onload = () => {
        try {
          const minSide = Math.min(img.naturalWidth, img.naturalHeight)
          if (minSide <= 0) {
            reject(new Error("Dimensões inválidas da imagem."))
            return
          }

          const targetSize = Math.min(minSide, maxDimension)
          const sx = (img.naturalWidth - minSide) / 2
          const sy = (img.naturalHeight - minSide) / 2

          const canvas = document.createElement("canvas")
          canvas.width = targetSize
          canvas.height = targetSize
          const ctx = canvas.getContext("2d")
          if (!ctx) {
            reject(new Error("Falha ao inicializar o processador de imagem."))
            return
          }

          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = "high"
          ctx.drawImage(
            img,
            sx,
            sy,
            minSide,
            minSide,
            0,
            0,
            targetSize,
            targetSize,
          )

          // Tenta webp primeiro; se não suportado ou vazio, usa png
          let result = canvas.toDataURL("image/webp", 0.88)
          if (!result.startsWith("data:image/webp")) {
            result = canvas.toDataURL("image/png")
          }
          resolve(result)
        } catch (err) {
          reject(err instanceof Error ? err : new Error("Erro ao recortar imagem."))
        }
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

/** Toca um som sutil sintetizado via Web Audio API ao concluir tarefas. */
export async function playTaskDoneChime(): Promise<boolean> {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!AudioContextClass) return false

    const ctx = new AudioContextClass()
    if (ctx.state === "suspended") await ctx.resume()
    const now = ctx.currentTime

    // Duas notas suaves em acorde (Dó 523Hz e Mi 659Hz)
    const freqs = [523.25, 659.25]
    for (const freq of freqs) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = "sine"
      osc.frequency.setValueAtTime(freq, now)

      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now)
      osc.stop(now + 0.36)
    }

    // Fecha o contexto após o término
    setTimeout(() => {
      // Fechar o contexto é só higiene de recurso; o som já foi entregue.
      void ctx.close().catch(() => {})
    }, 500)
    return true
  } catch {
    return false
  }
}
