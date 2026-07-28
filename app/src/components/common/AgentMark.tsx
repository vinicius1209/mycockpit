import { cn } from "@/lib/utils"
import { AgentLogo, agentLogoLabel } from "@/components/common/AgentLogo"

/**
 * Marca do agent com o SELO DE ESTADO por cima (padrão do Warp): posição fixa,
 * então trocar de estado não mexe no texto da linha, e o slot não fica vazio
 * porque a identidade do agent está sempre lá.
 *
 * A 1ª versão usava uma INICIAL em quadradinho colorido ("C", "X", "A") e falhou
 * no primeiro contato — "o que é esse C?". Era código que só o autor lia. Agora
 * são os logos oficiais de cada produto (ver AgentLogo).
 *
 * `status` null = só a identidade, sem selo.
 */
export function AgentMark({
  agent,
  status,
  title,
}: {
  agent: string
  status?: "running" | "done" | "error" | "awaiting" | null
  title?: string
}) {
  return (
    <span
      className="relative grid size-4 shrink-0 place-items-center"
      title={title ?? agentLogoLabel(agent)}
      aria-label={title ?? agentLogoLabel(agent)}
    >
      <AgentLogo agent={agent} className="size-3.5 text-muted-foreground" />
      {status && (
        <span
          className={cn(
            "absolute -right-1 -bottom-1 size-2 rounded-full ring-2 ring-rail",
            status === "running" && "animate-cockpit-pulse bg-st-running",
            status === "done" && "bg-st-success",
            status === "error" && "bg-st-error",
            status === "awaiting" && "animate-cockpit-pulse bg-st-warning",
          )}
        />
      )}
    </span>
  )
}
