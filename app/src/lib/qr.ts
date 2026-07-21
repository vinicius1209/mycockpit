// QR Code encoder CASEIRO (byte mode, ECC M, versões 1–10) — zero dependência
// de runtime. Decisão (onda 3 do Companion): o único consumidor é o QR de
// pareamento (URL ~100 chars, cabe folgado em v6-M); a dep npm "qrcode"
// traria kanji/40 versões/ECC configurável de que não precisamos. Validação:
// qr.test.ts round-tripa a matriz com o DECODER independente jsQR
// (devDependency de teste) — vetor conhecido de verdade, não expectativa
// copiada do próprio encoder.
//
// Estrutura padrão (ISO/IEC 18004): bitstream byte-mode → Reed-Solomon por
// bloco → interleave → matriz (finders/timing/alignment) → máscara de menor
// penalidade → format bits. Algoritmos de referência: qrcodegen (Nayuki).

/** Máximo de BYTES (UTF-8) suportado: capacidade byte-mode de v10-M. */
export const QR_MAX_BYTES = 213

// ── tabelas ECC M, versões 1–10 (índice = versão; [0] é sentinela) ──────────

/** Codewords de DADOS por versão. */
const DATA_CW = [0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216]
/** Codewords de ECC por bloco. */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
/** Estrutura de blocos: [blocosG1, dadosG1, blocosG2, dadosG2]. */
const BLOCKS: [number, number, number, number][] = [
  [0, 0, 0, 0],
  [1, 16, 0, 0],
  [1, 28, 0, 0],
  [1, 44, 0, 0],
  [2, 32, 0, 0],
  [2, 43, 0, 0],
  [4, 27, 0, 0],
  [4, 31, 0, 0],
  [2, 38, 2, 39],
  [3, 36, 2, 37],
  [4, 43, 1, 44],
]
/** Centros dos alignment patterns por versão. */
const ALIGN: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
]

// ── GF(256) + Reed-Solomon (polinômio 0x11D, o do QR) ───────────────────────

function gfMul(a: number, b: number): number {
  let r = 0
  while (b > 0) {
    if (b & 1) r ^= a
    b >>>= 1
    a <<= 1
    if (a & 0x100) a ^= 0x11d
  }
  return r
}

/** Divisor RS monic de grau `degree` (coeficientes sem o 1 líder, maior→menor). */
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1 // começa como o polinômio 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    // multiplica por (x - r^i)
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}

/** Resto da divisão polinomial (os codewords de ECC do bloco). */
function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => {
      result[i] ^= gfMul(coef, factor)
    })
  }
  return result
}

// ── bitstream byte-mode + padding ───────────────────────────────────────────

function chooseVersion(nBytes: number): number {
  for (let v = 1; v <= 10; v++) {
    // mode(4) + count(8 ou 16) bits ⇒ 2 (v≤9) ou 3 (v10) codewords de overhead
    const capacity = DATA_CW[v] - (v <= 9 ? 2 : 3)
    if (nBytes <= capacity) return v
  }
  throw new Error(`QR: payload de ${nBytes} bytes excede o máximo (${QR_MAX_BYTES})`)
}

function buildCodewords(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = []
  const push = (val: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  push(0b0100, 4) // modo byte
  push(bytes.length, version <= 9 ? 8 : 16)
  for (const b of bytes) push(b, 8)

  const capBits = DATA_CW[version] * 8
  push(0, Math.min(4, capBits - bits.length)) // terminador
  push(0, (8 - (bits.length % 8)) % 8) // alinha no byte
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8)

  const out: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
    out.push(b)
  }
  return out
}

/** Divide em blocos, calcula ECC e INTERLEAVA (dados coluna a coluna, ECC após). */
function interleave(dataCw: number[], version: number): number[] {
  const [g1, d1, g2, d2] = BLOCKS[version]
  const divisor = rsDivisor(ECC_PER_BLOCK[version])
  const dataBlocks: number[][] = []
  const eccBlocks: number[][] = []
  let off = 0
  for (let b = 0; b < g1 + g2; b++) {
    const len = b < g1 ? d1 : d2
    const blk = dataCw.slice(off, off + len)
    off += len
    dataBlocks.push(blk)
    eccBlocks.push(rsRemainder(blk, divisor))
  }
  const out: number[] = []
  const maxLen = Math.max(d1, d2)
  for (let i = 0; i < maxLen; i++)
    for (const blk of dataBlocks) if (i < blk.length) out.push(blk[i])
  for (let i = 0; i < ECC_PER_BLOCK[version]; i++)
    for (const e of eccBlocks) out.push(e[i])
  return out
}

// ── matriz ──────────────────────────────────────────────────────────────────

interface Grid {
  size: number
  /** true = módulo escuro. */
  modules: boolean[][]
  /** true = módulo de função (não recebe dados nem máscara). */
  isFunc: boolean[][]
}

function set(g: Grid, x: number, y: number, dark: boolean): void {
  g.modules[y][x] = dark
  g.isFunc[y][x] = true
}

function getBit(v: number, i: number): boolean {
  return ((v >>> i) & 1) !== 0
}

function drawFinder(g: Grid, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || x >= g.size || y < 0 || y >= g.size) continue
      const dist = Math.max(Math.abs(dx), Math.abs(dy))
      set(g, x, y, dist !== 2 && dist !== 4) // anéis: escuro-claro-escuro + separador
    }
  }
}

function drawAlignment(g: Grid, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      set(g, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
}

/** Format bits (ECC M + máscara) nas DUAS cópias + dark module. BCH(15,5). */
function drawFormatBits(g: Grid, mask: number): void {
  const data = (0b00 << 3) | mask // ECC M = 00
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((data << 10) | rem) ^ 0x5412
  const n = g.size
  // cópia 1 (canto superior esquerdo, contornando o timing)
  for (let i = 0; i <= 5; i++) set(g, 8, i, getBit(bits, i))
  set(g, 8, 7, getBit(bits, 6))
  set(g, 8, 8, getBit(bits, 7))
  set(g, 7, 8, getBit(bits, 8))
  for (let i = 9; i < 15; i++) set(g, 14 - i, 8, getBit(bits, i))
  // cópia 2 (bordas inferior-esquerda + superior-direita)
  for (let i = 0; i < 8; i++) set(g, n - 1 - i, 8, getBit(bits, i))
  for (let i = 8; i < 15; i++) set(g, 8, n - 15 + i, getBit(bits, i))
  set(g, 8, n - 8, true) // dark module
}

/** Version info (só v≥7): 18 bits BCH(18,6) nos dois blocos 3×6. */
function drawVersionInfo(g: Grid, version: number): void {
  if (version < 7) return
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  const bits = (version << 12) | rem
  for (let i = 0; i < 18; i++) {
    const bit = getBit(bits, i)
    const a = g.size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    set(g, a, b, bit)
    set(g, b, a, bit)
  }
}

function drawFunctionPatterns(g: Grid, version: number): void {
  const n = g.size
  for (let i = 0; i < n; i++) {
    set(g, 6, i, i % 2 === 0) // timing vertical
    set(g, i, 6, i % 2 === 0) // timing horizontal
  }
  drawFinder(g, 3, 3)
  drawFinder(g, n - 4, 3)
  drawFinder(g, 3, n - 4)
  const pos = ALIGN[version]
  const last = pos.length - 1
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      // pula os 3 cantos ocupados pelos finders
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0)
      )
        continue
      drawAlignment(g, pos[i], pos[j])
    }
  }
  drawFormatBits(g, 0) // reserva as áreas (valor real vem após a máscara)
  drawVersionInfo(g, version)
}

/** Zigzag padrão: colunas de 2 da direita pra esquerda, pulando a coluna 6.
 *  Bits além do stream (remainder) ficam claros — a máscara cuida deles. */
function drawCodewords(g: Grid, cw: number[]): void {
  const n = g.size
  let i = 0
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? n - 1 - vert : vert
        if (!g.isFunc[y][x] && i < cw.length * 8) {
          g.modules[y][x] = getBit(cw[i >>> 3], 7 - (i & 7))
          i++
        }
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function applyMask(g: Grid, mask: number): void {
  const fn = MASKS[mask]
  for (let y = 0; y < g.size; y++)
    for (let x = 0; x < g.size; x++)
      if (!g.isFunc[y][x] && fn(x, y)) g.modules[y][x] = !g.modules[y][x]
}

/** Penalidades N1–N4 do padrão (só decide a máscara; qualquer uma decodifica). */
function penalty(m: boolean[][]): number {
  const n = m.length
  let score = 0
  const runScore = (line: (i: number) => boolean) => {
    let color = line(0)
    let run = 1
    for (let i = 1; i <= n; i++) {
      if (i < n && line(i) === color) run++
      else {
        if (run >= 5) score += 3 + run - 5
        if (i < n) {
          color = line(i)
          run = 1
        }
      }
    }
  }
  for (let y = 0; y < n; y++) runScore((x) => m[y][x])
  for (let x = 0; x < n; x++) runScore((y) => m[y][x])
  // N2: blocos 2×2
  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++) {
      const c = m[y][x]
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1])
        score += 3
    }
  // N3: padrão finder-like 1011101 com 4 claros de um lado
  const P = [true, false, true, true, true, false, true]
  const finderLike = (line: (i: number) => boolean) => {
    for (let i = 0; i + 11 <= n; i++) {
      let clearBefore = true
      let clearAfter = true
      for (let j = 0; j < 4; j++) {
        if (line(i + j)) clearBefore = false
        if (line(i + 7 + j)) clearAfter = false
      }
      if (clearBefore && P.every((p, j) => line(i + 4 + j) === p)) score += 40
      if (clearAfter && P.every((p, j) => line(i + j) === p)) score += 40
    }
  }
  for (let y = 0; y < n; y++) finderLike((x) => m[y][x])
  for (let x = 0; x < n; x++) finderLike((y) => m[y][x])
  // N4: desvio da proporção 50% escuro (10 pontos por passo de 5%)
  let dark = 0
  for (const row of m) for (const c of row) if (c) dark++
  const total = n * n
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}

// ── API ─────────────────────────────────────────────────────────────────────

/** Codifica `text` (UTF-8, ≤213 bytes) num QR ECC M. Retorna a matriz de
 *  módulos (true = escuro), sem quiet zone. Lança se exceder a capacidade. */
export function qrModules(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text)
  const version = chooseVersion(bytes.length)
  const size = 17 + 4 * version
  const cw = interleave(buildCodewords(bytes, version), version)

  const base: Grid = {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    isFunc: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  }
  drawFunctionPatterns(base, version)
  drawCodewords(base, cw)

  // melhor máscara pela menor penalidade (empate → menor índice)
  let best: boolean[][] | null = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const g: Grid = {
      size,
      modules: base.modules.map((r) => r.slice()),
      isFunc: base.isFunc,
    }
    applyMask(g, mask)
    drawFormatBits(g, mask)
    const s = penalty(g.modules)
    if (s < bestScore) {
      bestScore = s
      best = g.modules
    }
  }
  return best as boolean[][]
}

/** Renderiza `text` num canvas: sempre escuro-sobre-claro (leitores de QR
 *  preferem), com quiet zone de 4 módulos. Dimensiona o canvas sozinho. */
export function drawQr(
  canvas: HTMLCanvasElement,
  text: string,
  opts: { moduleSize?: number; dark?: string; light?: string } = {},
): void {
  const { moduleSize = 4, dark = "#16181d", light = "#ffffff" } = opts
  const quiet = 4
  const m = qrModules(text)
  const px = (m.length + quiet * 2) * moduleSize
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  ctx.fillStyle = light
  ctx.fillRect(0, 0, px, px)
  ctx.fillStyle = dark
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m.length; x++)
      if (m[y][x])
        ctx.fillRect(
          (x + quiet) * moduleSize,
          (y + quiet) * moduleSize,
          moduleSize,
          moduleSize,
        )
}
