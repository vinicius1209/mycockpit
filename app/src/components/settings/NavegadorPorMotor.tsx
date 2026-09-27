// Por onde o navegador da Frota chega a cada motor (ADR-224 §4). Uma linha
// por motor, verdadeira para o escopo de MCP dele: quem aceita binding recebe
// pelo MCP do projeto e pelo frota-browser; quem só lê cadastro global recebe
// pelo frota-browser cadastrado no CLI, com o gesto aqui mesmo. Antes a tela
// mandava o agy "vincular um binding", gesto que naquele motor não existe.

import { CadastroGlobalDoMotor } from "@/components/settings/CadastroGlobalDoMotor"
import { AGENTS, type AgentDef } from "@/lib/agents"
import { browserMcpLabel, browserMcpStatus, setBrowserMcpEnabled } from "@/lib/workMcpSetup"

/** A frase de cada motor, derivada do escopo, nunca do nome. Puro. */
export function comoONavegadorChega(agent: Pick<AgentDef, "mcpEscopo" | "workMcpGlobalEnv">): string {
  if (agent.mcpEscopo === "por-run") {
    return "automático em todo turno, e por um MCP do projeto marcado como navegador"
  }
  if (agent.workMcpGlobalEnv) {
    return "cadastrado no CLI uma vez, vale para todos os projetos"
  }
  if (agent.mcpEscopo === "por-projeto") {
    return "ainda sem caminho: este motor lê o MCP do próprio projeto e a Frota não escreve nele"
  }
  return "ainda sem caminho neste motor"
}

/** A linha de UM motor. `soCorpo` tira o nome do motor da frente quando a
 *  linha mora na página do próprio motor (ADR-268), onde o título é o canal. */
export function NavegadorDoMotor({ agent, soCorpo = false }: { agent: AgentDef; soCorpo?: boolean }) {
  // Sozinha, a frase abre a linha: começa em maiúscula.
  const frase = comoONavegadorChega(agent)
  return (
    <div className={soCorpo ? undefined : "py-1.5 first:pt-0 last:pb-0"}>
      <p className="text-[12px] leading-snug">
        {!soCorpo && <span className="font-medium text-foreground">{agent.shortLabel} · </span>}
        <span className="text-muted-foreground">{soCorpo ? frase.replace(/^./, (c) => c.toUpperCase()) : frase}</span>
      </p>
      {agent.workMcpGlobalEnv && (
        <CadastroGlobalDoMotor
          agent={agent}
          consultar={browserMcpStatus}
          alterar={setBrowserMcpEnabled}
          rotuloDoEstado={browserMcpLabel}
          rotuloConectar="Usar o navegador da Frota"
          alvo="o navegador da Frota"
        />
      )}
    </div>
  )
}

export function NavegadorPorMotor({ agents = AGENTS }: { agents?: AgentDef[] }) {
  const motores = agents.filter((agent) => agent.kind === "agent" && agent.available)
  if (!motores.length) return null
  return (
    <div className="mt-2 divide-y divide-border/40">
      {motores.map((agent) => (
        <NavegadorDoMotor key={agent.id} agent={agent} />
      ))}
    </div>
  )
}
