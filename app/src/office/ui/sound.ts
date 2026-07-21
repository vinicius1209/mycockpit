/** Sons DISCRETOS do Agent Office — WebAudio 100% SINTETIZADO (zero assets).
 *
 *  Opt-in, DEFAULT OFF: nada toca até o usuário ligar no Hud (🔊). O estado
 *  persiste em localStorage `mc.office.sound` ("1" = ligado). Volume sempre
 *  baixo (master gain MASTER_GAIN) — presença ambiente, nunca notificação.
 *
 *  Eventos (chamados pelos pontos REAIS do runtime — nada de teatro):
 *    footstep — tick filtrado enquanto há walkers ativos (passinhos)
 *    typing   — ruído curtíssimo, proporcional ao nº de mesas digitando
 *    coffee   — borbulha curta no INÍCIO de um café
 *    delivery — sino sutil de entrega
 *
 *  MÓDULO FOLHA (zero imports, sem React/Pixi/stores — padrão engine/): vive
 *  em ui/ porque o Hud é o dono do toggle, mas a cena (packs de comportamento)
 *  pode chamar notifySound sem criar ciclo nem arrastar camada nenhuma.
 *  Sem AudioContext (testes node/jsdom) tudo vira no-op silencioso. */

export type OfficeSoundEvent = "footstep" | "typing" | "coffee" | "delivery"

const LS_KEY = "mc.office.sound"
/** Teto global de volume — os sons são presença, não alerta. */
const MASTER_GAIN = 0.15

/** Piso entre disparos do MESMO evento (s) — anti-metralhadora, mesmo que o
 *  chamador exagere. typing 0.5s ⇒ máx. 2/s por contrato. */
const MIN_GAP_S: Record<OfficeSoundEvent, number> = {
  footstep: 0.22,
  typing: 0.5,
  coffee: 1.2,
  delivery: 0.7,
}

function readEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(LS_KEY) === "1"
  } catch {
    return false
  }
}

let enabled = readEnabled()
let audio: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
const lastAt: Record<OfficeSoundEvent, number> = {
  footstep: -9,
  typing: -9,
  coffee: -9,
  delivery: -9,
}

/** Cria/acorda o AudioContext sob demanda (o toggle do Hud é o gesto do
 *  usuário que os browsers exigem). null = ambiente sem WebAudio. */
function ensureAudio(): AudioContext | null {
  if (typeof window === "undefined") return null
  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!audio) {
    audio = new Ctor()
    master = audio.createGain()
    master.gain.value = MASTER_GAIN
    master.connect(audio.destination)
  }
  if (audio.state === "suspended") void audio.resume().catch(() => {})
  return audio
}

/** Buffer de ruído branco compartilhado (0.25s, alocado uma vez). */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise) return noise
  const len = Math.floor(ctx.sampleRate * 0.25)
  noise = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return noise
}

/** Sopro de ruído filtrado (passos/teclado): envelope curto, tudo se
 *  auto-desliga no fim (nós descartáveis — zero estado retido). */
function playNoise(
  ctx: AudioContext,
  opts: { type: BiquadFilterType; freq: number; q: number; peak: number; durS: number },
): void {
  if (!master) return
  const t0 = ctx.currentTime
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  // início aleatório dentro do buffer: dois passos nunca soam idênticos
  const offset = Math.random() * 0.18
  const filter = ctx.createBiquadFilter()
  filter.type = opts.type
  filter.frequency.value = opts.freq
  filter.Q.value = opts.q
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(opts.peak, t0)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.durS)
  src.connect(filter)
  filter.connect(gain)
  gain.connect(master)
  src.start(t0, offset, opts.durS + 0.02)
  src.stop(t0 + opts.durS + 0.05)
}

/** Tom senoidal com glide opcional e decaimento exponencial (borbulha/sino). */
function playTone(
  ctx: AudioContext,
  opts: { from: number; to?: number; peak: number; durS: number; atS?: number },
): void {
  if (!master) return
  const t0 = ctx.currentTime + (opts.atS ?? 0)
  const osc = ctx.createOscillator()
  osc.type = "sine"
  osc.frequency.setValueAtTime(opts.from, t0)
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.durS)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(opts.peak, t0 + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.durS)
  osc.connect(gain)
  gain.connect(master)
  osc.start(t0)
  osc.stop(t0 + opts.durS + 0.05)
}

/** O usuário ligou os sons do escritório? (fonte: localStorage, default OFF) */
export function soundEnabled(): boolean {
  return enabled
}

/** Liga/desliga (persistido). Ligar toca um sino curtíssimo de confirmação —
 *  feedback imediato de que há áudio, dentro do gesto do usuário. */
export function setSoundEnabled(on: boolean): void {
  enabled = on
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LS_KEY, on ? "1" : "0")
  } catch {
    // storage indisponível: o toggle vale só para a sessão
  }
  if (on) {
    const ctx = ensureAudio()
    if (ctx) {
      playTone(ctx, { from: 880, peak: 0.22, durS: 0.35 })
      playTone(ctx, { from: 1318.5, peak: 0.08, durS: 0.3, atS: 0.02 })
    }
  }
}

/** Dispara um som de evento (no-op com som desligado/sem WebAudio). Throttle
 *  interno por evento — os chamadores não precisam se coordenar. */
export function notifySound(event: OfficeSoundEvent): void {
  if (!enabled) return
  const ctx = ensureAudio()
  if (!ctx) return
  const now = ctx.currentTime
  if (now - lastAt[event] < MIN_GAP_S[event]) return
  lastAt[event] = now

  switch (event) {
    case "footstep":
      // tick surdo e macio (passinho no carpete)
      playNoise(ctx, {
        type: "lowpass",
        freq: 380 + Math.random() * 140,
        q: 0.8,
        peak: 0.3,
        durS: 0.055,
      })
      break
    case "typing":
      // clique de tecla: ruído curtíssimo e agudo, tom variando por disparo
      playNoise(ctx, {
        type: "bandpass",
        freq: 1900 + Math.random() * 1400,
        q: 1.1,
        peak: 0.22,
        durS: 0.03,
      })
      break
    case "coffee":
      // borbulha dupla subindo (máquina servindo)
      playTone(ctx, { from: 300 + Math.random() * 40, to: 520, peak: 0.28, durS: 0.09 })
      playTone(ctx, { from: 420, to: 700 + Math.random() * 60, peak: 0.22, durS: 0.09, atS: 0.13 })
      break
    case "delivery":
      // sino sutil: fundamental + parcial aguda decaindo juntas
      playTone(ctx, { from: 880, peak: 0.26, durS: 0.5 })
      playTone(ctx, { from: 1318.5, peak: 0.1, durS: 0.42, atS: 0.015 })
      break
  }
}
