import { useCallback, useEffect, useState } from "react"
import { FileText, Gauge, GitPullRequest, Inbox, Swords } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { agentLabel } from "@/lib/agent"
import { scanDecisions, type Decision } from "@/lib/inbox"

/** Navega direto pra ONDE a decisão mora: a conversa (Fusion) ou o plano (SDD). */
async function goTo(d: Decision) {
  const app = useApp.getState()
  app.setActiveProject(d.projectId)
  if (d.kind === "fusion") {
    await useChat.getState().openProject(d.projectId)
    await useChat.getState().switchConversation(d.convId)
    app.setViewMode("linear")
  } else {
    app.setSddFocus(d.slug)
    app.setViewMode("sdd")
  }
}

/** Inbox de decisões: o sino do cockpit. Tudo que espera VOCÊ (veredito de
 *  disputa, PRD pra aprovar, PR aberto), independente de projeto/modo. */
export function InboxBell() {
  const projects = useApp((s) => s.projects)
  const limited = useApp((s) => s.limitedAgents)
  const [decisions, setDecisions] = useState<Decision[]>([])

  const refresh = useCallback(() => {
    if (projects.length === 0) return
    void scanDecisions(projects).then(setDecisions)
  }, [projects])

  // badge no boot/troca de projetos; re-varre ao abrir o popover.
  useEffect(() => {
    refresh()
  }, [refresh])

  const count = decisions.length
  const limitedIds = Object.keys(limited)

  return (
    <DropdownMenu onOpenChange={(o) => o && refresh()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto relative text-muted-foreground hover:text-foreground"
          title="Decisões pendentes"
          aria-label="Decisões pendentes"
        >
          <Inbox className="size-4" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-brass text-[9px] font-semibold text-background">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-[10px] tracking-wide text-muted-foreground uppercase">
          Decisões pendentes
        </DropdownMenuLabel>
        {count === 0 ? (
          <div className="px-2 py-3 text-center text-[12.5px] text-muted-foreground">
            Nada esperando você. Tudo decidido.
          </div>
        ) : (
          decisions.map((d, i) => (
            <DropdownMenuItem
              key={i}
              onSelect={() => void goTo(d)}
              className="flex-col items-start gap-0.5 py-2"
            >
              <span className="flex w-full items-center gap-2 text-[13px] text-foreground">
                {d.kind === "fusion" ? (
                  <Swords className="size-3.5 shrink-0 text-brass" />
                ) : d.kind === "prd" ? (
                  <FileText className="size-3.5 shrink-0 text-brass" />
                ) : (
                  <GitPullRequest className="size-3.5 shrink-0 text-[#3fb950]" />
                )}
                <span className="truncate">
                  {d.kind === "fusion"
                    ? "Escolher o vencedor da disputa"
                    : d.kind === "prd"
                      ? `Aprovar PRD: ${d.planTitle}`
                      : `PR aberto: ${d.planTitle}`}
                </span>
              </span>
              <span className="w-full truncate pl-[22px] text-[11px] text-muted-foreground">
                {d.kind === "fusion"
                  ? `${d.title} · ${d.projectName}`
                  : d.kind === "pr"
                    ? `${d.projectName} · aguardando merge`
                    : d.projectName}
              </span>
            </DropdownMenuItem>
          ))
        )}
        {limitedIds.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {limitedIds.map((id) => (
              <div
                key={id}
                className="flex items-center gap-2 px-2 py-1.5 text-[11.5px] text-st-warning/80"
              >
                <Gauge className="size-3.5 shrink-0" />
                <span className="truncate">
                  {agentLabel(id)} limitado
                  {limited[id] ? `, volta ${limited[id]}` : ""}
                </span>
              </div>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
