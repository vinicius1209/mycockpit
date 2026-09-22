// A linha do cadastro global de um canal da Frota num motor que só lê a
// config do próprio CLI (agy): estado verificado, o gesto de conectar e o
// reverificar. Nasceu no navegador (ADR-224 §4) e foi extraída quando o
// controle do computador (ADR-225) precisou do MESMO gesto: dois canais, um
// idioma só, e nenhum terminal para quem usa.

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RefreshCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { AgentDef } from "@/lib/agents"
import { workMcpAction, type WorkMcpSetup } from "@/lib/workMcpSetup"

export function CadastroGlobalDoMotor({
  agent,
  consultar,
  alterar,
  rotuloDoEstado,
  rotuloConectar,
  alvo,
  aoReler,
}: {
  agent: AgentDef
  consultar: (agent: string) => Promise<WorkMcpSetup>
  alterar: (agent: string, enabled: boolean) => Promise<WorkMcpSetup>
  rotuloDoEstado: (state: WorkMcpSetup["state"]) => string
  /** O que "Conectar" significa para a pessoa neste canal. */
  rotuloConectar: string
  /** "o navegador da Frota": nomeia o reverificar para leitor de tela. */
  alvo: string
  /** Toda leitura do CLI também atualiza o que se sabe dos terceiros. */
  aoReler?: () => void
}) {
  const [snapshot, setSnapshot] = useState<WorkMcpSetup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      setSnapshot(await consultar(agent.id))
    } catch (cause) {
      setSnapshot(null)
      setError(String(cause))
    } finally {
      inFlight.current = false
      setBusy(false)
      aoReler?.()
    }
  }, [agent.id, consultar, aoReler])
  useEffect(() => {
    void refresh()
  }, [refresh])

  async function change() {
    if (!snapshot || !workMcpAction(snapshot.state) || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      setSnapshot(await alterar(agent.id, snapshot.state !== "configured"))
    } catch (cause) {
      setSnapshot(null)
      setError(String(cause))
      toast.error(String(cause))
    } finally {
      inFlight.current = false
      setBusy(false)
      aoReler?.()
    }
  }
  const action = snapshot && workMcpAction(snapshot.state)
  const rotulo = action === "Conectar" ? rotuloConectar : action
  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span
          className="min-w-0 flex-1 text-[12px] text-muted-foreground"
          title={snapshot ? `Verificado em ${new Date(snapshot.checkedAt).toLocaleString("pt-BR")}` : undefined}
        >
          {busy ? "Verificando cadastro…" : snapshot ? rotuloDoEstado(snapshot.state) : "Cadastro não verificado"}
        </span>
        {rotulo && (
          <Button size="compacto" variant="outline" disabled={busy} onClick={() => void change()}>
            {rotulo}
          </Button>
        )}
        <Button
          size="compacto"
          variant="ghost"
          disabled={busy}
          onClick={() => void refresh()}
          aria-label={`Reverificar ${alvo} no ${agent.shortLabel}`}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
        </Button>
      </div>
      {(error || snapshot?.detail) && (
        <p className="mt-1 text-[12px] text-st-warning">{error || snapshot?.detail}</p>
      )}
    </>
  )
}
