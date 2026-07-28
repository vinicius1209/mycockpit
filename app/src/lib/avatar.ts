// AVATAR OFFLINE (Especialistas E2) — SISTEMA coeso, não "estilo cru por
// especialista". A cara da persona é gerada LOCALMENTE por DiceBear
// (@dicebear/core + @dicebear/collection), sem NENHUMA chamada de rede (não
// usamos a HTTP api.dicebear.com). Mesmo `style`+`seed`+`cor` sempre produz o
// MESMO SVG: identidade estável, reproduzível e versionável com o arquivo.
//
// A regra do sistema (avatarFor): UM estilo base ("thumbs") + a COR derivada da
// CATEGORIA + seed = nome. A cor passa a SIGNIFICAR o domínio, então o time é
// sempre uma família. `avatarStyle` no arquivo vira um override AVANÇADO (edição
// à mão); a UI não pica mais estilo.

import { createAvatar } from "@dicebear/core"
import {
  bottts,
  funEmoji,
  glass,
  identicon,
  notionists,
  personas,
  shapes,
  thumbs,
} from "@dicebear/collection"
import type { AgentDef } from "@/lib/agentDefs"

// Default = "thumbs" (personagem coeso, colorido pela categoria — a direção
// aprovada em docs/mocks/avatar-system.html). Se mudar, alinhe os literais em
// agentDefs.ts (omit/parse) e db.ts (toPreset).
export const DEFAULT_AVATAR_STYLE = "thumbs"

/** Estilos DiceBear suportados como OVERRIDE avançado (edição à mão do arquivo);
 *  a UI não expõe mais um picker. O default do sistema é "thumbs". */
export const AVATAR_STYLES = [
  ["thumbs", "Thumbs"],
  ["shapes", "Formas"],
  ["bottts", "Bots"],
  ["notionists", "Pessoas"],
  ["personas", "Personas"],
  ["identicon", "Identicon"],
  ["fun-emoji", "Emoji"],
  ["glass", "Vidro"],
] as const

// `createAvatar` é genérico no tipo de opções de cada estilo; a coleção tem um
// generic diferente por estilo, então o mapa é tipado pelo estilo que o próprio
// createAvatar aceita e cada valor é atribuído por cast (o núcleo do DiceBear
// aceita as opções comuns — seed/size/radius/backgroundColor — em todos).
type Style = Parameters<typeof createAvatar>[0]
const REGISTRY: Record<string, Style> = {
  thumbs: thumbs as Style,
  glass: glass as Style,
  shapes: shapes as Style,
  bottts: bottts as Style,
  notionists: notionists as Style,
  personas: personas as Style,
  identicon: identicon as Style,
  "fun-emoji": funEmoji as Style,
}

// ---------------------------------------------------------------------------
// Cor por categoria (a "inteligência" do sistema)
// ---------------------------------------------------------------------------

/** Cor do domínio por categoria (paleta LABEL_COLORS do app + brass). A chave é
 *  normalizada (minúscula, sem acento), então "Estratégia"/"estrategia" batem. */
const CATEGORY_COLOR: Record<string, string> = {
  engenharia: "#60a5fa", // azul
  qualidade: "#34d399", // verde
  estrategia: "#a78bfa", // roxo
  ops: "#fbbf24", // âmbar
  design: "#f472b6", // rosa
  seguranca: "#f87171", // vermelho
}

/** Brass do app: default de "Geral" e de qualquer categoria fora do mapa. */
const DEFAULT_CATEGORY_COLOR = "#e4a862"

function normalizeCategory(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
}

/** Cor (#hex) do domínio. Categoria vazia/"Geral"/desconhecida → brass. */
export function categoryColor(category?: string): string {
  if (!category) return DEFAULT_CATEGORY_COLOR
  return CATEGORY_COLOR[normalizeCategory(category)] ?? DEFAULT_CATEGORY_COLOR
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

/** SVG do avatar. Determinístico e offline. `backgroundColor` (#hex) é passado
 *  pro DiceBear como array sem "#" (o que a lib quer). Estilo desconhecido NÃO
 *  estoura: cai no default — a persona sempre tem cara. Espelha o preview
 *  aprovado (só backgroundColor + radius, sem backgroundType custom). */
export function avatarSvg(
  style: string,
  seed: string,
  size = 64,
  color?: string,
): string {
  const styleKey = REGISTRY[style] ? style : DEFAULT_AVATAR_STYLE
  const st = REGISTRY[styleKey]
  const hex = color ? color.replace(/^#/, "") : null
  // A cor DOMINANTE do thumbs é o CORPO (`shapeColor`), NÃO o `backgroundColor`
  // (por isso a cor da categoria não aparecia — ficava atrás do blob). Pintamos
  // corpo E fundo com a cor do domínio → tile sólido, coeso. Outros estilos
  // (override à mão) usam só `backgroundColor`.
  const colorOpts = hex
    ? styleKey === "thumbs"
      ? { shapeColor: [hex], backgroundColor: [hex] }
      : { backgroundColor: [hex] }
    : {}
  return createAvatar(st, {
    seed: seed || "x",
    size,
    radius: 20,
    ...colorOpts,
  }).toString()
}

/** data-uri pronto pro `src` de um <img> (evita injetar SVG cru no DOM). */
export function avatarDataUri(
  style: string,
  seed: string,
  size = 64,
  backgroundColor?: string,
): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    avatarSvg(style, seed, size, backgroundColor),
  )}`
}

export interface AvatarSpec {
  style: string
  seed: string
  backgroundColor: string
}

/** A REGRA do sistema: dado um especialista, resolve estilo (default do sistema,
 *  salvo override à mão), seed (do arquivo, senão slug/nome) e a cor do domínio
 *  (sempre da categoria). É a fonte única do "como a persona aparece". */
export function avatarFor(
  def: Pick<AgentDef, "category" | "avatarStyle" | "avatarSeed" | "slug" | "name">,
): AvatarSpec {
  return {
    style: def.avatarStyle || DEFAULT_AVATAR_STYLE,
    seed: def.avatarSeed || def.slug || def.name || "x",
    backgroundColor: categoryColor(def.category),
  }
}
