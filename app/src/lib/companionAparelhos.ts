// Aparelhos pareados do Companion em Configurações: os tipos que o comando
// `companion_list_devices` devolve e os rótulos (R1 do
// docs/companion-chat-prd.md). Puro e com `agora` injetável: a regra de
// vencimento mora no Rust (`companion_rede::expira_em`), aqui só se diz.

/** C4 — aparelho pareado (a credencial NUNCA viaja; só metadados). */
export interface CompanionDeviceInfo {
  id: string
  name: string
  /** Epoch ms do aceite. */
  pairedAt: number
  /** Epoch ms da última requisição autenticada; null = nunca visto pós-boot. */
  lastSeenAt: number | null
  /** Epoch ms em que vence se continuar parado (R1, 30 dias sem uso). */
  expiresAt?: number
}

/** C4 — pedido de pareamento aguardando o gesto humano. */
export interface CompanionPendingPair {
  id: string
  name: string
  requestedAt: number
}

export interface CompanionDevicesInfo {
  devices: CompanionDeviceInfo[]
  pending: CompanionPendingPair[]
  /** true = o token único pré-v2 ainda existe (aparelhos antigos com acesso). */
  legacyActive: boolean
}

const DIA_MS = 86_400_000

/** "expira em 12 d" / "expira hoje" / "expirado". Nunca inventa prazo. */
export function rotuloDeExpiracao(expiresAt: number | null | undefined, agora = Date.now()): string | null {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return null
  const resta = expiresAt - agora
  if (resta <= 0) return "expirado"
  const dias = Math.floor(resta / DIA_MS)
  if (dias < 1) return "expira hoje"
  return `expira em ${dias} d sem uso`
}
