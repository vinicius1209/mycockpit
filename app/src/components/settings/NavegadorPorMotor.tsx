// Por onde o navegador da Frota chega a cada motor (ADR-224 §4). Uma linha
// por motor, verdadeira para o escopo de MCP dele: quem aceita binding recebe
// pelo MCP do projeto e pelo frota-browser; quem só lê cadastro global recebe
// pelo frota-browser cadastrado no CLI, com o gesto aqui mesmo. Antes a tela
// mandava o agy "vincular um binding", gesto que naquele motor não existe.

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RefreshCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { AGENTS, type AgentDef } from "@/lib/agents"
import {
  browserMcpLabel,
  browserMcpStatus,
  setBrowserMcpEnabled,
  workMcpAction,
  type WorkMcpSetup,
} from "@/lib/workMcpSetup"

/** A frase de cada motor, derivada do escopo, nunca do nome. Puro. */
export function comoONavegadorChega(agent: Pick<AgentDef, "mcpEscopo" | "workMcpGlobalEnv">): string {
  if (agent.mcpEscopo === "por-run") {
    return "pelo frota-browser em todo turno, e por um MCP do projeto marcado como navegador"
  }
  if (agent.workMcpGlobalEnv) {
    return "pelo frota-browser cadastrado no CLI (vale para todos os projetos)"
  }
  if (agent.mcpEscopo === "por-projeto") {
    return "ainda sem caminho: este motor lê o MCP do próprio projeto e a Frota não escreve nele"
  }
  return "ainda sem caminho neste motor"
}

function LinhaGlobal({ agent }: { agent: AgentDef }) {
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
      setSnapshot(await browserMcpStatus(agent.id))
    } catch (cause) {
      setSnapshot(null)
      setError(String(cause))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }, [agent.id])
  useEffect(() => {
    void refresh()
  }, [refresh])

  async function change() {
    if (!snapshot || !workMcpAction(snapshot.state) || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      setSnapshot(await setBrowserMcpEnabled(agent.id, snapshot.state !== "configured"))
    } catch (cause) {
      setSnapshot(null)
      setError(String(cause))
      toast.error(String(cause))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const action = snapshot && workMcpAction(snapshot.state)
  const rotulo = action === "Conectar" ? "Usar o navegador da Frota" : action
  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span
          className="min-w-0 flex-1 text-[12px] text-muted-foreground"
          title={snapshot ? `Verificado em ${new Date(snapshot.checkedAt).toLocaleString("pt-BR")}` : undefined}
        >
          {busy ? "Verificando cadastro…" : snapshot ? browserMcpLabel(snapshot.state) : "Cadastro não verificado"}
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
          aria-label={`Reverificar o navegador da Frota no ${agent.shortLabel}`}
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

export function NavegadorPorMotor({ agents = AGENTS }: { agents?: AgentDef[] }) {
  const motores = agents.filter((agent) => agent.kind === "agent" && agent.available)
  if (!motores.length) return null
  return (
    <div className="mt-2 divide-y divide-border/40">
      {motores.map((agent) => (
        <div key={agent.id} className="py-1.5 first:pt-0 last:pb-0">
          <p className="text-[12px] leading-snug">
            <span className="font-medium text-foreground">{agent.shortLabel}</span>
            <span className="text-muted-foreground"> · {comoONavegadorChega(agent)}</span>
          </p>
          {agent.workMcpGlobalEnv && <LinhaGlobal agent={agent} />}
        </div>
      ))}
    </div>
  )
}
