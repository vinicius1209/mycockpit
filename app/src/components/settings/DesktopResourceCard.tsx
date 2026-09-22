import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Loader2, MonitorCog, RefreshCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ComputadorPorMotor } from "@/components/settings/ComputadorPorMotor"
import { Card, CardBody, CardHead, Selo } from "@/components/settings/parts"
import {
  desktopCapabilityStatus,
  requestDesktopPermission,
  type DesktopCapabilityStatus,
  type OsPermissionView,
} from "@/lib/resources"

function PermissionRow({
  permission,
  requesting,
  onRequest,
}: {
  permission: OsPermissionView
  requesting: boolean
  onRequest: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-t border-border/40 py-2 first:border-t-0">
      <CheckCircle2
        className={
          permission.granted
            ? "size-3.5 text-foreground"
            : "size-3.5 text-muted-foreground"
        }
      />
      <span className="min-w-0 flex-1 text-[12px] text-foreground">
        {permission.label}
      </span>
      <span className="text-[11px] text-muted-foreground">
        {permission.granted ? "concedida" : "não concedida"}
      </span>
      {!permission.granted && permission.canRequest && (
        <Button
          type="button"
          size="chip"
          variant="outline"
          disabled={requesting}
          onClick={onRequest}
        >
          {requesting && <Loader2 className="size-3 animate-spin" />}
          Revisar no sistema
        </Button>
      )}
    </div>
  )
}

export function DesktopResourceCard() {
  const [status, setStatus] = useState<DesktopCapabilityStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await desktopCapabilityStatus())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const request = async (kind: "screen-recording" | "accessibility") => {
    setRequesting(kind)
    try {
      setStatus(await requestDesktopPermission(kind))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRequesting(null)
    }
  }

  return (
    <Card>
      <CardHead
        nome={
          <span className="flex items-center gap-2">
            <MonitorCog className="size-3.5 text-muted-foreground" />
            Controle do desktop
          </span>
        }
        meta={status ? (status.platform === "macos" ? "macOS" : "Linux") : "medindo"}
        selo={<Selo tom={status?.controllerAvailable ? "ok" : "neutro"}>{status?.controllerAvailable ? "pronto" : "bloqueado"}</Selo>}
        acao={
          <Button
            type="button"
            size="icone-compacto"
            variant="ghost"
            aria-label="Medir permissões novamente"
            title="Medir novamente"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCcw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
          </Button>
        }
      />
      <CardBody>
        <p className="text-[12px] leading-snug text-muted-foreground">
          Permissão do sistema não é acesso para um agente. Com as duas
          concedidas, a Frota oferece o próprio controle aos turnos, e cada
          turno ainda pede a você antes de ver a tela ou mexer no computador.
        </p>
        {status && (
          <div className="mt-2">
            <PermissionRow
              permission={status.screenRecording}
              requesting={requesting === "screen-recording"}
              onRequest={() => void request("screen-recording")}
            />
            <PermissionRow
              permission={status.accessibility}
              requesting={requesting === "accessibility"}
              onRequest={() => void request("accessibility")}
            />
            <p className="border-t border-border/40 pt-2 text-[11px] leading-snug text-muted-foreground">
              {status.detail}
            </p>
          </div>
        )}
        <ComputadorPorMotor />
        {error && (
          <p role="alert" className="mt-2 text-[11px] text-st-error">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  )
}
