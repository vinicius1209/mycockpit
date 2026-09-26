import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RefreshCcw } from "lucide-react"
import { avisar, mensagemDe } from "@/lib/avisos"
import { Button } from "@/components/ui/button"
import { Card, CardBody } from "./parts"
import { AGENTS, type AgentDef } from "@/lib/agents"
import { workMcpStatus, setWorkMcpEnabled, workMcpAction, workMcpLabel, type WorkMcpSetup } from "@/lib/workMcpSetup"

function WorkMcpRow({ agent, onChanged }: { agent: AgentDef; onChanged: () => Promise<void> }) {
  const [snapshot, setSnapshot] = useState<WorkMcpSetup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const changed = useRef(onChanged)
  changed.current = onChanged
  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try { setSnapshot(await workMcpStatus(agent.id)) }
    catch (cause) { setSnapshot(null); setError(String(cause)) }
    finally { inFlight.current = false; setBusy(false) }
  }, [agent.id])
  useEffect(() => { void refresh() }, [refresh])

  async function change() {
    if (!snapshot || !workMcpAction(snapshot.state) || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      setSnapshot(await setWorkMcpEnabled(agent.id, snapshot.state !== "configured"))
      await changed.current()
    } catch (cause) {
      setSnapshot(null)
      setError(String(cause))
      avisar.erro("Não consegui mudar as ferramentas de trabalho do Frota.", { detalhe: mensagemDe(cause) })
    } finally { inFlight.current = false; setBusy(false) }
  }
  const action = snapshot && workMcpAction(snapshot.state)
  return (
    <div className="py-2 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">{agent.shortLabel}</span>
        <span className="min-w-0 flex-1 text-[12px] text-muted-foreground"
          title={snapshot ? `Verificado em ${new Date(snapshot.checkedAt).toLocaleString("pt-BR")}` : undefined}>
          {busy ? "Verificando cadastro…" : snapshot ? workMcpLabel(snapshot.state) : "Cadastro não verificado"}
        </span>
        {action && <Button size="compacto" variant="outline" disabled={busy} onClick={() => void change()}>{action}</Button>}
        <Button size="compacto" variant="ghost" disabled={busy} onClick={() => void refresh()}
          aria-label={`Reverificar acompanhamento no ${agent.shortLabel}`}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
        </Button>
      </div>
      {(error || snapshot?.detail) && <p className="mt-1 text-[12px] text-st-warning">{error || snapshot?.detail}</p>}
    </div>
  )
}

export function WorkMcpSettings({ onChanged }: { onChanged: () => Promise<void> }) {
  const agents = AGENTS.filter((agent) => agent.kind === "agent" && agent.workMcpGlobalEnv)
  if (!agents.length) return null
  return (
    <Card className="mt-3">
      <CardBody>
        <h3 className="text-[13px] font-medium">Acompanhamento no Frota</h3>
        <p className="mt-1 mb-3 text-[12px] text-muted-foreground">
          Conecta planos, etapas e processos dos turnos iniciados pelo Frota.
          O cadastro no CLI vale para todos os projetos e permanece até você desconectar.
        </p>
        <div className="divide-y divide-border/40">
          {agents.map((agent) => <WorkMcpRow key={agent.id} agent={agent} onChanged={onChanged} />)}
        </div>
      </CardBody>
    </Card>
  )
}
