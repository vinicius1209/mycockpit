import { cn } from "@/lib/utils"

/** Identidade visual de cada agent: inicial + cor. Existe porque o "dot" do
 *  seletor é brass para TODOS — a UI nunca dizia QUAL agent roda uma conversa,
 *  e na sidebar isso é a informação que falta pra bater o olho e saber.
 *
 *  As cores são de MARCA, não de estado: nenhuma colide com o vocabulário de
 *  status (azul=rodando, verde=ok, âmbar=espera, vermelho=erro), senão a
 *  identidade seria lida como situação. Referência de cada provedor, dessaturada
 *  para não competir com o brass da seleção. */
const MARKS: Record<string, { initial: string; className: string; label: string }> = {
  "claude-code": {
    initial: "C",
    label: "Claude Code",
    className: "bg-[#c96442]/15 text-[#c96442] ring-[#c96442]/30",
  },
  codex: {
    initial: "X",
    label: "Codex",
    className: "bg-foreground/10 text-foreground/70 ring-foreground/20",
  },
  agy: {
    initial: "A",
    label: "Antigravity",
    className: "bg-[#6b5bd6]/15 text-[#6b5bd6] ring-[#6b5bd6]/30",
  },
}

/** Agent desconhecido não inventa cor: fica neutro com a 1ª letra. */
function markFor(agent: string) {
  return (
    MARKS[agent] ?? {
      initial: (agent[0] ?? "?").toUpperCase(),
      label: agent || "agent",
      className: "bg-muted text-muted-foreground ring-border",
    }
  )
}

/**
 * Marca do agent com o SELO DE ESTADO por cima (padrão do Warp): a posição é
 * fixa, então trocar de estado não mexe no texto da linha — e o slot nunca fica
 * vazio, porque a identidade do agent está sempre lá. Antes o estado era um
 * ícone que aparecia e desaparecia à direita do título, empurrando o layout.
 *
 * `status` null = nenhum selo (só a identidade).
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
  const m = markFor(agent)
  return (
    <span
      className="relative grid size-4 shrink-0 place-items-center"
      title={title ?? m.label}
      aria-label={title ?? m.label}
    >
      <span
        className={cn(
          "grid size-4 place-items-center rounded-[5px] font-mono text-[9px] font-semibold ring-1",
          m.className,
        )}
      >
        {m.initial}
      </span>
      {status && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-rail",
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
