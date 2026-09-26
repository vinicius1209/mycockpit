// Por onde o controle do computador chega a cada motor (ADR-225), no mesmo
// idioma do navegador por motor (ADR-224 §4). Duas verdades por linha:
//
// 1. Se o controle DA FROTA chega (com pedido na tela e Revogar). Motor de
//    cadastro global (agy) precisa do frota-desktop cadastrado no CLI, e o
//    gesto é aqui mesmo, sem terminal.
// 2. Se há um controle de TERCEIRO (`computer-use`) no cadastro do motor.
//    Visto em 22/09/2026: o agy clicava pelo Computer Use do Codex, por fora
//    do pedido e do Revogar, e nenhuma tela dizia isso.

import { useCallback, useEffect, useState } from "react"
import { avisar, mensagemDe } from "@/lib/avisos"
import { Button } from "@/components/ui/button"
import { CadastroGlobalDoMotor } from "@/components/settings/CadastroGlobalDoMotor"
import { AGENTS, type AgentDef } from "@/lib/agents"
import {
  desktopExternalControllers,
  setDesktopExternalEnabled,
  type ExternalDesktopController,
} from "@/lib/resources"
import { desktopMcpLabel, desktopMcpStatus, setDesktopMcpEnabled } from "@/lib/workMcpSetup"

/** A frase de cada motor, derivada do escopo, nunca do nome. Puro. */
export function comoOComputadorChega(agent: Pick<AgentDef, "mcpEscopo" | "workMcpGlobalEnv">): string {
  if (agent.mcpEscopo === "por-run") {
    return "pelo frota-desktop em todo turno, quando as duas permissões acima estão concedidas"
  }
  if (agent.workMcpGlobalEnv) {
    return "pelo frota-desktop cadastrado no CLI (vale para todos os projetos)"
  }
  return "ainda sem caminho neste motor"
}

/** O aviso de cada terceiro. Puro, para teste. */
export function fraseDoTerceiro(controle: ExternalDesktopController, motor: string): string {
  if (!controle.enabled) return `${controle.name} está desativado no ${motor}.`
  const onde = controle.manageable ? "" : " Ele vem da configuração do próprio motor, fora do alcance da Frota."
  return `${controle.name} também controla o computador, por fora da Frota: sem pedido na tela e sem Revogar.${onde}`
}

function Terceiros({ agent, versao }: { agent: AgentDef; versao: number }) {
  const [controles, setControles] = useState<ExternalDesktopController[]>([])
  const [mexendo, setMexendo] = useState<string | null>(null)
  const ler = useCallback(async () => {
    try {
      setControles(await desktopExternalControllers(agent.id))
    } catch (cause) {
      setControles([])
      console.error("[controle do computador] não consegui ler os terceiros:", cause)
    }
  }, [agent.id])
  useEffect(() => {
    void ler()
  }, [ler, versao])

  async function alternar(controle: ExternalDesktopController) {
    setMexendo(controle.name)
    try {
      await setDesktopExternalEnabled(agent.id, controle.name, !controle.enabled)
    } catch (cause) {
      avisar.erro(`Não consegui mudar ${controle.name}.`, { detalhe: mensagemDe(cause) })
    } finally {
      setMexendo(null)
      await ler()
    }
  }

  if (!controles.length) return null
  return (
    <>
      {controles.map((controle) => (
        <div key={controle.name} className="mt-1 flex flex-wrap items-center gap-2">
          <p
            className={
              controle.enabled
                ? "min-w-0 flex-1 text-[12px] leading-snug text-st-warning"
                : "min-w-0 flex-1 text-[12px] leading-snug text-muted-foreground"
            }
          >
            {fraseDoTerceiro(controle, agent.shortLabel)}
          </p>
          {controle.manageable && (
            <Button
              size="compacto"
              variant="outline"
              disabled={mexendo === controle.name}
              onClick={() => void alternar(controle)}
            >
              {controle.enabled ? `Desativar no ${agent.shortLabel}` : "Reativar"}
            </Button>
          )}
        </div>
      ))}
    </>
  )
}

function LinhaDoMotor({ agent }: { agent: AgentDef }) {
  // Cada leitura do CLI renova o que se sabe dos terceiros: o cadastro
  // global e o `computer-use` saem da MESMA tabela do motor.
  const [versao, setVersao] = useState(0)
  const reler = useCallback(() => setVersao((v) => v + 1), [])
  return (
    <div className="py-1.5 first:pt-0 last:pb-0">
      <p className="text-[12px] leading-snug">
        <span className="font-medium text-foreground">{agent.shortLabel}</span>
        <span className="text-muted-foreground"> · {comoOComputadorChega(agent)}</span>
      </p>
      {agent.workMcpGlobalEnv && (
        <CadastroGlobalDoMotor
          agent={agent}
          consultar={desktopMcpStatus}
          alterar={setDesktopMcpEnabled}
          rotuloDoEstado={desktopMcpLabel}
          rotuloConectar="Usar o controle da Frota"
          alvo="o controle do computador da Frota"
          aoReler={reler}
        />
      )}
      <Terceiros agent={agent} versao={versao} />
    </div>
  )
}

export function ComputadorPorMotor({ agents = AGENTS }: { agents?: AgentDef[] }) {
  const motores = agents.filter((agent) => agent.kind === "agent" && agent.available)
  if (!motores.length) return null
  return (
    <div className="mt-2 divide-y divide-border/40 border-t border-border/40 pt-2">
      {motores.map((agent) => (
        <LinhaDoMotor key={agent.id} agent={agent} />
      ))}
    </div>
  )
}
