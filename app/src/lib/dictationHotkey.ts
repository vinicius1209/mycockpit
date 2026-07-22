// Atalho de ditado estilo Wispr Flow (in-app), CONFIGURÁVEL: TAP (<350ms)
// alterna o ditado no alvo ativo; HOLD (≥350ms) é push-to-talk — grava
// enquanto segura, soltar para e insere. Este módulo é PURO e testável:
// createDictationHotkey recebe todas as dependências; startDictationHotkey
// pluga no window com as deps reais.
//
// O COMBO vem de settings.dictationHotkey (lido REATIVAMENTE, por evento) no
// formato serializado "modificadores ordenados + e.code" — ex. "alt+Space",
// "ctrl+alt+KeyD". e.code (posição física da tecla) dá independência de
// layout. null ⇒ atalho desativado (handler inerte).
//
// O ALVO é um registro fino: cada dono de mic (MicButton no Trabalho, docks do
// office) se registra ao montar e sai ao desmontar. O último registrado E
// disponível vence — abrir o dock do office o coloca na frente do composer do
// Trabalho; fechar devolve. `isAvailable` cobre superfícies que ficam MONTADAS
// mas escondidas na troca de modo (ChatPanel vira `hidden`): botão sem
// offsetParent = fora de cena, pulado.
//
// Regras de teclado (macOS): combos com ⌥ inserem caracteres (⌥Espaço = NBSP)
// em campos de texto — preventDefault SEMPRE que o atalho trata (inclusive key
// repeat, que senão pinga caracteres no textarea durante o hold).

export type DictationTarget = {
  start: () => void | Promise<void>
  stop: () => void | Promise<void>
  cancel: () => void | Promise<void>
  isRecording: () => boolean
  /** false ⇒ pulado na escolha (dono montado porém invisível). Ausente = ok. */
  isAvailable?: () => boolean
}

const targets: DictationTarget[] = []

/** Registra um dono de mic como alvo do atalho. Retorna o unregister. */
export function registerDictationTarget(t: DictationTarget): () => void {
  targets.push(t)
  return () => {
    const i = targets.indexOf(t)
    if (i >= 0) targets.splice(i, 1)
  }
}

/** O alvo ativo: último registrado que estiver disponível. */
export function activeDictationTarget(): DictationTarget | null {
  for (let i = targets.length - 1; i >= 0; i--) {
    if (targets[i].isAvailable?.() !== false) return targets[i]
  }
  return null
}

/** Só para testes: zera o registro entre casos. */
export function _resetDictationTargets(): void {
  targets.length = 0
}

/** Fronteira TAP × HOLD (ms entre keydown e keyup). */
export const HOLD_MS = 350

/** Subconjunto de KeyboardEvent que o handler usa (eventos fake nos testes). */
export type HotkeyEvent = {
  code: string
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  repeat: boolean
  preventDefault: () => void
}

// ── Combo serializado ────────────────────────────────────────────────────────

/** Padrão de fábrica: ⌥Espaço. */
export const DEFAULT_DICTATION_HOTKEY = "alt+Space"

/** Combo parseado: flags exigidas + e.code da tecla principal. */
export type ParsedHotkey = {
  code: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

const MODIFIER_NAMES = ["ctrl", "alt", "shift", "meta"] as const
type ModifierName = (typeof MODIFIER_NAMES)[number]

/** e.code de teclas modificadoras — nunca são tecla PRINCIPAL de um combo, e o
 *  keyup de qualquer uma delas encerra um hold em andamento. */
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
])

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code)
}

/** Parseia "ctrl+alt+KeyD" → flags + code. null = inválido: sem modificador
 *  (tecla solta dispararia digitando), token desconhecido/duplicado, ou tecla
 *  principal que é ela mesma um modificador. */
export function parseHotkey(combo: string): ParsedHotkey | null {
  const parts = combo.split("+")
  if (parts.length < 2) return null
  const code = parts[parts.length - 1]
  if (
    !code ||
    (MODIFIER_NAMES as readonly string[]).includes(code) ||
    isModifierCode(code)
  ) {
    return null
  }
  const p: ParsedHotkey = {
    code,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  }
  for (const raw of parts.slice(0, -1)) {
    if (!(MODIFIER_NAMES as readonly string[]).includes(raw)) return null
    const m = raw as ModifierName
    if (p[m]) return null // duplicado
    p[m] = true
  }
  return p
}

/** O keydown casa com o combo? Exige TODOS os modificadores do combo e NENHUM
 *  extra; a tecla principal compara por e.code (independente de layout). */
export function matchesHotkey(e: HotkeyEvent, p: ParsedHotkey): boolean {
  return (
    e.code === p.code &&
    e.ctrlKey === p.ctrl &&
    e.altKey === p.alt &&
    e.shiftKey === p.shift &&
    e.metaKey === p.meta
  )
}

/** Serializa um keydown no formato canônico (ctrl, alt, shift, meta + code). */
export function serializeHotkey(
  e: Pick<HotkeyEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push("ctrl")
  if (e.altKey) parts.push("alt")
  if (e.shiftKey) parts.push("shift")
  if (e.metaKey) parts.push("meta")
  parts.push(e.code)
  return parts.join("+")
}

// ── Captura (Configurações ▸ Ditado ▸ "Gravar atalho") ───────────────────────

export type HotkeyCapture =
  | { kind: "ok"; combo: string }
  | { kind: "pending" } // só modificador pressionado — segue capturando
  | { kind: "needs-modifier" } // tecla sem nenhum modificador
  | { kind: "reserved" } // combo que o app já usa (⌘K)

/** Combos reservados do app — não podem virar atalho de ditado. */
const RESERVED_COMBOS = new Set(["meta+KeyK"])

/** Avalia um keydown do modo de captura (pura; Esc-cancela é do chamador). */
export function captureHotkey(
  e: Pick<HotkeyEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
): HotkeyCapture {
  if (isModifierCode(e.code)) return { kind: "pending" }
  if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
    return { kind: "needs-modifier" }
  }
  const combo = serializeHotkey(e)
  if (RESERVED_COMBOS.has(combo)) return { kind: "reserved" }
  return { kind: "ok", combo }
}

// ── Formatação (tooltips, dicas, Configurações) ──────────────────────────────

/** Nomes pt/símbolos dos e.code mais comuns (fallback: o próprio code). */
const KEY_LABELS: Record<string, string> = {
  Space: "Espaço",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "⌫",
  Delete: "⌦",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  IntlBackslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
}

function keyLabel(code: string): string {
  if (KEY_LABELS[code]) return KEY_LABELS[code]
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`
  return code
}

/** "alt+Space" → "⌥ Espaço" · "ctrl+alt+KeyD" → "⌃⌥ D" · null → "" (símbolos
 *  na ordem mac ⌃⌥⇧⌘). Combo inválido volta cru — melhor que sumir a dica. */
export function formatHotkey(combo: string | null): string {
  if (!combo) return ""
  const p = parseHotkey(combo)
  if (!p) return combo
  let mods = ""
  if (p.ctrl) mods += "⌃"
  if (p.alt) mods += "⌥"
  if (p.shift) mods += "⇧"
  if (p.meta) mods += "⌘"
  return `${mods} ${keyLabel(p.code)}`
}

// ── Handler ──────────────────────────────────────────────────────────────────

export type DictationHotkeyDeps = {
  /** Alvo corrente (produção: activeDictationTarget). */
  target: () => DictationTarget | null
  /** Combo serializado corrente (settings.dictationHotkey, lido POR EVENTO —
   *  trocar nas Configurações vale na hora). null ⇒ handler inerte. */
  combo: () => string | null
  /** Gate de settings.dictationEnabled (mesmo do MicButton). */
  enabled: () => boolean
  /** true = modal aberto (⌘K etc.) — o atalho não dispara. */
  blocked: () => boolean
  /** Sem alvo pra ditar (toast curto na produção). */
  onNoTarget: () => void
  /** Relógio injetável (testes com timer fake). */
  now?: () => number
}

export function createDictationHotkey(deps: DictationHotkeyDeps): {
  onKeyDown: (e: HotkeyEvent) => void
  onKeyUp: (e: HotkeyEvent) => void
} {
  const now = deps.now ?? Date.now
  /** timestamp do keydown da sessão corrente; null = sem sessão. */
  let downAt: number | null = null
  /** e.code que ABRIU a sessão — o keyup casa por ele mesmo se o setting
   *  mudar no meio. */
  let sessionCode: string | null = null
  /** o keydown INICIOU a gravação (false = já gravava: tap-para-parar). */
  let startedOnDown = false
  /** promessa do start em voo — o stop do hold espera ela assentar. */
  let pendingStart: Promise<void> | null = null

  // Parse memoizado por string: o setting é lido a cada evento (reativo), mas
  // só re-parseia quando o combo de fato muda.
  let memoCombo: string | null = null
  let memoParsed: ParsedHotkey | null = null
  const parsed = (): ParsedHotkey | null => {
    const c = deps.combo()
    if (c !== memoCombo) {
      memoCombo = c
      memoParsed = c ? parseHotkey(c) : null
    }
    return memoParsed
  }

  function onKeyDown(e: HotkeyEvent): void {
    const p = parsed()
    if (!p || !matchesHotkey(e, p)) return
    if (!deps.enabled() || deps.blocked()) return
    // trata ⇒ preventDefault, inclusive repeat (senão o hold pinga NBSPs).
    e.preventDefault()
    if (e.repeat || downAt !== null) return
    const t = deps.target()
    if (!t) {
      deps.onNoTarget()
      return
    }
    downAt = now()
    sessionCode = p.code
    if (t.isRecording()) {
      // já gravando: o tap alterna pra PARAR — quem para é o keyup.
      startedOnDown = false
    } else {
      startedOnDown = true
      // start SÍNCRONO no keydown (latência de captura) — o async IIFE só
      // difere o que o próprio start diferir; o hold encadeia o stop nele.
      pendingStart = (async () => {
        await t.start()
      })().catch(() => {})
    }
  }

  function onKeyUp(e: HotkeyEvent): void {
    // Encerra a sessão o keyup da tecla PRINCIPAL (pode chegar sem os
    // modificadores — ⌥ solto antes do espaço) OU o de um MODIFICADOR (soltar
    // o ⌃ de ⌃D também fecha o hold do push-to-talk).
    if (downAt === null) return
    if (e.code !== sessionCode && !isModifierCode(e.code)) return
    e.preventDefault()
    const held = now() - downAt
    downAt = null
    sessionCode = null
    const started = pendingStart
    pendingStart = null
    const t = deps.target()
    if (!t) return
    if (!startedOnDown) {
      // tap com gravação em andamento ⇒ para e insere.
      void t.stop()
      return
    }
    if (held >= HOLD_MS) {
      // push-to-talk: soltou ⇒ para e insere (depois do start assentar).
      void Promise.resolve(started).then(() => t.stop())
    }
    // tap (<HOLD_MS): toggle ligado — segue gravando até o próximo tap.
  }

  return { onKeyDown, onKeyUp }
}

/** Pluga o atalho no window. Retorna o teardown. As deps de UI (settings,
 *  modal aberto, toast) entram por parâmetro — o módulo não importa stores. */
export function startDictationHotkey(
  deps: Omit<DictationHotkeyDeps, "target" | "now">,
): () => void {
  const h = createDictationHotkey({ ...deps, target: activeDictationTarget })
  const down = (e: KeyboardEvent) => h.onKeyDown(e)
  const up = (e: KeyboardEvent) => h.onKeyUp(e)
  window.addEventListener("keydown", down)
  window.addEventListener("keyup", up)
  return () => {
    window.removeEventListener("keydown", down)
    window.removeEventListener("keyup", up)
  }
}
