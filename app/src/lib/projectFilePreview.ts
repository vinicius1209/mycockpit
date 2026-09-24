export type ProjectFilePreviewKind =
  | "markdown"
  | "code"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "svg"
  | "unsupported"

export interface RasterDimensions {
  width: number
  height: number
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
}

const BINARY_EXTENSIONS = new Set([
  "7z",
  "a",
  "bin",
  "dmg",
  "doc",
  "docx",
  "gz",
  "jar",
  "o",
  "ppt",
  "pptx",
  "tar",
  "ttf",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "zip",
])

export const MAX_RASTER_SIDE = 32_768
export const MAX_RASTER_PIXELS = 32 * 1024 * 1024

function extension(path: string): string {
  const name = path.split("/").pop() ?? path
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

export function imageMimeType(path: string): string | null {
  return IMAGE_MIME[extension(path)] ?? null
}

/** Mídia servida pelo protocolo `frota-arquivo` com leitura em partes
 *  (ADR-240): o player pede pedaços, nada vem inteiro pela ponte. */
const VIDEO = new Set(["mp4", "m4v", "mov", "webm"])
const AUDIO = new Set(["mp3", "wav", "m4a", "ogg", "oga"])

export function projectFilePreviewKind(path: string): ProjectFilePreviewKind {
  const ext = extension(path)
  if (ext === "md" || ext === "mdx") return "markdown"
  if (IMAGE_MIME[ext]) return "image"
  if (VIDEO.has(ext)) return "video"
  if (AUDIO.has(ext)) return "audio"
  if (ext === "pdf") return "pdf"
  // SVG como imagem pelo protocolo: `<img>` não roda o script de dentro.
  if (ext === "svg") return "svg"
  if (BINARY_EXTENSIONS.has(ext)) return "unsupported"
  return "code"
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

function readPng(bytes: Uint8Array): RasterDimensions | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    ascii(bytes, 1, 3) !== "PNG" ||
    ascii(bytes, 12, 4) !== "IHDR"
  ) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function readGif(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 10 || !["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
}

function readBmp(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 26 || ascii(bytes, 0, 2) !== "BM") return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    width: Math.abs(view.getInt32(18, true)),
    height: Math.abs(view.getInt32(22, true)),
  }
}

function readIco(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0 || bytes[2] !== 1) {
    return null
  }
  return {
    width: bytes[6] || 256,
    height: bytes[7] || 256,
  }
}

function readJpeg(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    offset += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 2 > bytes.length) return null
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) return null
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isStartOfFrame && length >= 7) {
      return {
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
      }
    }
    offset += length
  }
  return null
}

function readWebp(bytes: Uint8Array): RasterDimensions | null {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP"
  ) {
    return null
  }
  const kind = ascii(bytes, 12, 4)
  if (kind === "VP8X") {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    }
  }
  if (kind === "VP8L" && bytes[20] === 0x2f && bytes.length >= 25) {
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height:
        1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    }
  }
  if (
    kind === "VP8 " &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    }
  }
  return null
}

/** Lê só o cabeçalho codificado, antes de entregar a imagem ao decoder. */
export function rasterDimensions(
  bytes: Uint8Array,
  mime: string,
): RasterDimensions | null {
  switch (mime) {
    case "image/png":
      return readPng(bytes)
    case "image/jpeg":
      return readJpeg(bytes)
    case "image/gif":
      return readGif(bytes)
    case "image/webp":
      return readWebp(bytes)
    case "image/bmp":
      return readBmp(bytes)
    case "image/x-icon":
      return readIco(bytes)
    default:
      return null
  }
}

export function assertSafeRasterImage(
  bytes: Uint8Array,
  mime: string,
): RasterDimensions {
  const dimensions = rasterDimensions(bytes, mime)
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error("Não foi possível validar as dimensões desta imagem.")
  }
  if (
    dimensions.width > MAX_RASTER_SIDE ||
    dimensions.height > MAX_RASTER_SIDE ||
    dimensions.width * dimensions.height > MAX_RASTER_PIXELS
  ) {
    throw new Error("A imagem é grande demais para uma pré-visualização segura.")
  }
  return dimensions
}

/** O endereço de um arquivo do projeto no protocolo `frota-arquivo` (ADR-240).
 *  O Rust resolve e cerca o caminho igual ao visualizador. Puro. */
export function urlDoArquivo(root: string, path: string): string {
  const q = new URLSearchParams({ raiz: root, caminho: path })
  return `frota-arquivo://localhost/?${q.toString()}`
}

/** Tamanho do arquivo pelo protocolo, sem baixá-lo: um Range de 1 byte e o
 *  total do Content-Range. `null` quando não dá para saber. */
export async function tamanhoPeloProtocolo(url: string): Promise<number | null> {
  return (await sondaDoProtocolo(url)).tamanho
}

/** O tamanho, e se o arquivo saiu do disco (o protocolo responde 404 só
 *  para isso, ADR-243). Falha de rede não é "sumiu": fica `false`. */
export async function sondaDoProtocolo(url: string): Promise<{ tamanho: number | null; sumiu: boolean }> {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-0" } })
    const total = r.headers.get("content-range")?.split("/")[1]
    return { tamanho: total ? Number(total) : null, sumiu: r.status === 404 }
  } catch {
    return { tamanho: null, sumiu: false }
  }
}

/** O erro de leitura diz que o arquivo não existe (ENOENT, como o Rust o
 *  escreve no macOS e no Linux)? Puro. */
export function arquivoSumiu(erro: string): boolean {
  return /\(os error 2\)|no such file or directory/i.test(erro)
}
