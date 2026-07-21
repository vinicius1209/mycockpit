// Configurações ▸ Companion (celular na rede local) — onda 3 do Companion Web.
// Toggle opt-in (companionEnabled), QR de pareamento (urlLan#token=…), URL em
// texto pra digitar, status honesto (servidor no ar? quantos dispositivos?) e
// revogação de token. O liga/desliga REAL acontece no watcher de
// lib/companion.ts (reage ao setting); aqui só se lê status e desenha.

import { useEffect, useRef, useState } from "react"
import { Check, Copy, RefreshCw } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { useApp } from "@/store/app"
import { isTauri } from "@/lib/db"
import {
  companionStatus,
  regenerateCompanionToken,
  type CompanionInfo,
} from "@/lib/companion"
import { drawQr } from "@/lib/qr"

/** Mock p/ o dev no BROWSER (isTauri false): permite ver a seção inteira —
 *  QR, URL, status — sem o servidor Rust. Nunca roda dentro do app real. */
const DEV_MOCK: CompanionInfo = {
  running: true,
  urlLan: "http://192.168.0.42:14200",
  token:
    "c0ffee00deadbeefc0ffee00deadbeefc0ffee00deadbeefc0ffee00deadbeef",
  connectedCount: 1,
}

const POLL_MS = 3_000

export function CompanionSettings() {
  const enabled = useApp((s) => s.settings.companionEnabled)
  const setSettings = useApp((s) => s.setSettings)
  const [info, setInfo] = useState<CompanionInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // status honesto: pergunta ao Rust (connectedCount vem dos sockets WS vivos)
  // e re-pergunta a cada 3s enquanto a seção está aberta e o toggle ligado.
  useEffect(() => {
    if (!enabled) {
      setInfo(null)
      setError(null)
      return
    }
    if (!isTauri()) {
      setInfo(DEV_MOCK)
      return
    }
    let cancelled = false
    const tick = () =>
      void companionStatus().then((i) => {
        if (!cancelled) setInfo(i)
      })
    // 1º poll levemente adiado: dá tempo do companion_start disparado pelo
    // watcher do setting concluir (senão o primeiro status diria "fora do ar").
    const first = setTimeout(tick, 300)
    const t = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(t)
    }
  }, [enabled])

  const pairUrl =
    info?.running && info.urlLan && info.token
      ? `${info.urlLan}#token=${info.token}`
      : null

  useEffect(() => {
    if (pairUrl && canvasRef.current)
      drawQr(canvasRef.current, pairUrl, { moduleSize: 4 })
  }, [pairUrl])

  async function regenerate() {
    setBusy(true)
    setError(null)
    try {
      setInfo(await regenerateCompanionToken())
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  function copyUrl() {
    if (!pairUrl) return
    void navigator.clipboard?.writeText(pairUrl).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div>
      <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
        Companion (celular na rede local)
      </h3>
      <div className="divide-y divide-border/50">
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <div className="text-[13px] text-foreground">Ativar companion</div>
            <div className="text-[11.5px] leading-snug text-muted-foreground">
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
                    : "Servidor fora do ar — a porta 14200 pode estar ocupada. Desligue e ligue o toggle pra tentar de novo."}
              </span>
            </div>

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
                    Escaneie com a câmera do celular, ou digite o endereço:
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <code className="block max-w-full overflow-x-auto rounded bg-secondary/40 px-2 py-1 font-mono text-[11px] break-all whitespace-normal text-foreground/90 select-all">
                      {pairUrl}
                    </code>
                    <button
                      onClick={copyUrl}
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
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    disabled={busy}
                    onClick={() => void regenerate()}
                  >
                    <RefreshCw className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
                    Gerar novo token
                  </Button>
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                    Revoga o acesso de todos os celulares pareados — o QR e o
                    endereço mudam na hora.
                  </p>
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

      <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">
        Primeira ativação: o macOS vai pedir permissão pra aceitar conexões da
        rede local — aceite, senão o celular não enxerga o app. O acesso exige
        o token do QR e vale só dentro da sua rede.
      </p>
    </div>
  )
}
