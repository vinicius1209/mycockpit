// Configurações ▸ Companion (celular na rede local) — onda 3 do Companion Web.
// Toggle opt-in (companionEnabled), QR de PAREAMENTO v2 (urlLan#pair=<token de
// uso único>), status honesto (servidor no ar? quantos dispositivos?), o
// ACEITE humano de aparelho novo (C4) e a lista de aparelhos com revogação
// individual. O liga/desliga REAL acontece no watcher de lib/companion.ts
// (reage ao setting); aqui só se lê status e desenha.

import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { listen } from "@tauri-apps/api/event"
import { Switch } from "@/components/ui/switch"
import { SectionHeader } from "@/components/settings/parts"
import { sectionDef } from "@/components/settings/sections"
import { Button } from "@/components/ui/button"
import { useApp } from "@/store/app"
import { isTauri } from "@/lib/db"
import {
  companionDevices,
  companionStatus,
  decideCompanionPairing,
  revokeCompanionDevice,
  revokeLegacyCompanionToken,
  type CompanionDevicesInfo,
  type CompanionInfo,
} from "@/lib/companion"
import { drawQr } from "@/lib/qr"

/** Mock p/ o dev no BROWSER (isTauri false): permite ver a seção inteira —
 *  QR, aparelhos, aceite — sem o servidor Rust. Nunca roda dentro do app real. */
const DEV_MOCK: CompanionInfo = {
  running: true,
  urlLan: "http://192.168.0.42:14200",
  pairingToken: "c0ffee00deadbeefc0ffee00deadbeef",
  connectedCount: 1,
}
const DEV_MOCK_DEVICES: CompanionDevicesInfo = {
  devices: [
    {
      id: "dev-1",
      name: "iPhone · Safari",
      pairedAt: Date.now() - 86_400_000,
      lastSeenAt: Date.now() - 120_000,
    },
  ],
  pending: [{ id: "pp-1", name: "Android · Chrome", requestedAt: Date.now() }],
  legacyActive: true,
}

const POLL_MS = 3_000

/** Carimbo curto "visto há…" (pt-BR, sem inventar idade). */
function agoLabel(ts: number | null): string {
  if (!ts || !Number.isFinite(ts)) return "nunca visto"
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return "visto agora"
  if (s < 3600) return `visto há ${Math.round(s / 60)} min`
  if (s < 86_400) return `visto há ${Math.round(s / 3600)} h`
  return `visto há ${Math.round(s / 86_400)} d`
}

function pairedLabel(ts: number): string {
  try {
    return `pareado em ${new Date(ts).toLocaleDateString("pt-BR")}`
  } catch {
    return "pareado"
  }
}

export function CompanionSettings() {
  const enabled = useApp((s) => s.settings.companionEnabled)
  const setSettings = useApp((s) => s.setSettings)
  const [info, setInfo] = useState<CompanionInfo | null>(null)
  const [devices, setDevices] = useState<CompanionDevicesInfo | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // status honesto: pergunta ao Rust (connectedCount vem dos sockets WS vivos)
  // e re-pergunta a cada 3s enquanto a seção está aberta e o toggle ligado.
  // O poll também traz aparelhos + pedidos de pareamento; o evento
  // companion://pair-request só ADIANTA o refresh (o celular está esperando).
  useEffect(() => {
    if (!enabled) {
      setInfo(null)
      setDevices(null)
      setError(null)
      return
    }
    if (!isTauri()) {
      setInfo(DEV_MOCK)
      setDevices(DEV_MOCK_DEVICES)
      return
    }
    let cancelled = false
    const tick = () => {
      void companionStatus().then((i) => {
        if (!cancelled) setInfo(i)
      })
      void companionDevices().then((d) => {
        if (!cancelled) setDevices(d)
      })
    }
    // 1º poll levemente adiado: dá tempo do companion_start disparado pelo
    // watcher do setting concluir (senão o primeiro status diria "fora do ar").
    const first = setTimeout(tick, 300)
    const t = setInterval(tick, POLL_MS)
    let un: (() => void) | null = null
    void listen("companion://pair-request", tick)
      .then((u) => {
        if (cancelled) u()
        else un = u
      })
      .catch(() => {})
    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(t)
      un?.()
    }
  }, [enabled])

  // QR v2: só o token de PAREAMENTO (uso único) viaja na URL — nunca mais a
  // credencial definitiva.
  const pairUrl =
    info?.running && info.urlLan && info.pairingToken
      ? `${info.urlLan}#pair=${info.pairingToken}`
      : null

  useEffect(() => {
    if (pairUrl && canvasRef.current)
      drawQr(canvasRef.current, pairUrl, { moduleSize: 4 })
  }, [pairUrl])

  async function refreshDevices() {
    if (!isTauri()) return
    setDevices(await companionDevices())
  }

  async function decide(id: string, accept: boolean) {
    setBusyId(id)
    setError(null)
    try {
      await decideCompanionPairing(id, accept)
      await refreshDevices()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function revoke(id: string, legacy: boolean) {
    // revogação em DOIS toques (padrão da casa): o primeiro arma, o segundo
    // confirma — nada de confirm() nativo.
    if (armedId !== id) {
      setArmedId(id)
      window.setTimeout(() => setArmedId((cur) => (cur === id ? null : cur)), 4_000)
      return
    }
    setArmedId(null)
    setBusyId(id)
    setError(null)
    try {
      if (legacy) await revokeLegacyCompanionToken()
      else await revokeCompanionDevice(id)
      await refreshDevices()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <SectionHeader
        title={sectionDef("companion").title}
        description={sectionDef("companion").question}
      />
      <div className="divide-y divide-border/50">
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <div className="text-[13px] text-foreground">Ativar companion</div>
            <div className="text-[12px] leading-snug text-muted-foreground">
              Sobe um servidor local (porta 14200) pra acompanhar e responder
              seus agents pelo celular, na mesma rede Wi-Fi.
            </div>
          </div>
          <div className="shrink-0">
            <Switch
              checked={enabled}
              onCheckedChange={(v) => setSettings({ companionEnabled: v })}
              aria-label="Ativar companion"
            />
          </div>
        </div>

        {enabled && (
          <div className="py-3">
            {/* status honesto */}
            <div className="mb-2 flex items-center gap-2 text-[12px]">
              <span
                className={
                  info?.running
                    ? "size-2 rounded-full bg-st-success"
                    : "size-2 rounded-full bg-st-error"
                }
              />
              <span className="text-muted-foreground">
                {info === null
                  ? "Verificando o servidor…"
                  : info.running
                    ? `Servidor no ar · ${info.connectedCount} ${
                        info.connectedCount === 1
                          ? "dispositivo conectado"
                          : "dispositivos conectados"
                      }`
                    : "Servidor fora do ar. A porta 14200 pode estar ocupada; desligue e ligue o toggle pra tentar de novo."}
              </span>
            </div>

            {/* C4 — aceite humano: aparelho aguardando o seu OK */}
            {(devices?.pending.length ?? 0) > 0 && (
              <div className="mb-3 space-y-2">
                {devices?.pending.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-st-queued/40 bg-st-queued/10 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] text-foreground">
                        <span className="font-medium">{p.name}</span> quer
                        parear com este Mac
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Sem aceite em 2 minutos, o pedido morre sozinho.
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === p.id}
                        onClick={() => void decide(p.id, false)}
                      >
                        Recusar
                      </Button>
                      <Button
                        size="sm"
                        disabled={busyId === p.id}
                        onClick={() => void decide(p.id, true)}
                      >
                        Aceitar aparelho
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pairUrl && (
              <div className="flex items-start gap-4">
                {/* QR sempre escuro-sobre-claro (leitores preferem) */}
                <canvas
                  ref={canvasRef}
                  className="size-[168px] shrink-0 rounded-md bg-white [image-rendering:pixelated]"
                  aria-label="QR code de pareamento do companion"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-muted-foreground">
                    Escaneie com a câmera do celular, ou digite o endereço.
                    Cada leitura vale um pareamento (o código é de uso único e
                    expira em 10 minutos); o aparelho só entra depois que você
                    aceitar aqui.
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <code className="block max-w-full overflow-x-auto rounded bg-secondary/40 px-2 py-1 font-mono text-[11px] break-all whitespace-normal text-foreground/90 select-all">
                      {pairUrl}
                    </code>
                    <button
                      onClick={() => {
                        void navigator.clipboard?.writeText(pairUrl).then(() => {
                          setCopied(true)
                          window.setTimeout(() => setCopied(false), 1500)
                        })
                      }}
                      title="Copiar URL de pareamento"
                      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Copiar URL de pareamento"
                    >
                      {copied ? (
                        <Check className="size-3.5 text-st-success" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  </div>

                  {/* C4 — aparelhos pareados + revogação individual */}
                  <div className="mt-3">
                    <div className="text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                      Aparelhos pareados
                    </div>
                    {devices == null ? (
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        Carregando aparelhos…
                      </p>
                    ) : devices.devices.length === 0 && !devices.legacyActive ? (
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        Nenhum aparelho pareado ainda.
                      </p>
                    ) : (
                      <div className="mt-1 divide-y divide-border/40">
                        {devices.devices.map((d) => (
                          <div
                            key={d.id}
                            className="flex items-center justify-between gap-3 py-1.5"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-[13px] text-foreground">
                                {d.name}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {pairedLabel(d.pairedAt)} · {agoLabel(d.lastSeenAt)}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant={armedId === d.id ? "destructive" : "secondary"}
                              disabled={busyId === d.id}
                              onClick={() => void revoke(d.id, false)}
                            >
                              {armedId === d.id ? "Confirmar?" : "Revogar"}
                            </Button>
                          </div>
                        ))}
                        {devices.legacyActive && (
                          <div className="flex items-center justify-between gap-3 py-1.5">
                            <div className="min-w-0">
                              <div className="text-[13px] text-foreground">
                                Acesso antigo (token único)
                              </div>
                              <div className="text-[11px] leading-snug text-muted-foreground">
                                Aparelhos pareados antes desta versão usam um
                                token compartilhado. Revogue quando todos
                                tiverem pareado de novo pelo QR.
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant={armedId === "legacy" ? "destructive" : "secondary"}
                              disabled={busyId === "legacy"}
                              onClick={() => void revoke("legacy", true)}
                            >
                              {armedId === "legacy" ? "Confirmar?" : "Revogar"}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {error && (
                    <p className="mt-1.5 text-[11px] leading-snug text-st-error">
                      {error}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="mt-3 text-[12px] leading-snug text-muted-foreground">
        Primeira ativação: o macOS vai pedir permissão pra aceitar conexões da
        rede local; aceite, senão o celular não enxerga o app. Cada aparelho
        tem credencial própria e só entra com o seu aceite; o acesso vale só
        dentro da sua rede.
      </p>
    </div>
  )
}
