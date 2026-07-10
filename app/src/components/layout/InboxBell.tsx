import { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  Check,
  CheckCheck,
  FileText,
  Gauge,
  GitPullRequest,
  Inbox,
  Swords,
} from "lucide-react"
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
import { useNotifs, type Notification } from "@/store/notifications"
import { agentLabel } from "@/lib/agent"
import { scanDecisions, type Decision } from "@/lib/inbox"
import { cn } from "@/lib/utils"

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

/** Abre a conversa de uma notificação. */
async function goToConv(n: Notification) {
  const app = useApp.getState()
  app.setActiveProject(n.projectId)
  await useChat.getState().openProject(n.projectId)
  if (n.convId) await useChat.getState().switchConversation(n.convId)
  app.setViewMode("linear")
}

function fmtRelative(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return "agora"
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

function NotifIcon({ kind }: { kind: Notification["kind"] }) {
  if (kind === "run_error")
    return <AlertCircle className="size-3.5 shrink-0 text-st-error" />
  if (kind === "limit")
    return <Gauge className="size-3.5 shrink-0 text-st-warning" />
  return <Check className="size-3.5 shrink-0 text-st-success" />
}

/** Inbox do cockpit: decisões que esperam VOCÊ + feed de atividade (turnos
 *  concluídos, erros, limites), com lido/não-lido. */
export function InboxBell() {
  const projects = useApp((s) => s.projects)
  const limited = useApp((s) => s.limitedAgents)
  const [decisions, setDecisions] = useState<Decision[]>([])
  const notifs = useNotifs((s) => s.items)
  const markRead = useNotifs((s) => s.markRead)
  const markAllRead = useNotifs((s) => s.markAllRead)
  const [filter, setFilter] = useState<"all" | "unread">("all")

  const refresh = useCallback(() => {
    if (projects.length === 0) return
    void scanDecisions(projects).then(setDecisions)
  }, [projects])

  useEffect(() => {
    refresh()
  }, [refresh])

  const unread = notifs.filter((n) => !n.read).length
  const badge = decisions.length + unread
  const limitedIds = Object.keys(limited)
  const feed = filter === "unread" ? notifs.filter((n) => !n.read) : notifs

  return (
    <DropdownMenu onOpenChange={(o) => o && refresh()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto relative text-muted-foreground hover:text-foreground"
          title="Notificações"
          aria-label="Notificações"
        >
          <Inbox className="size-4" />
          {badge > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-brass text-[9px] font-semibold text-background">
              {badge > 9 ? "9+" : badge}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[75vh] w-96 overflow-y-auto"
      >
        {/* Decisões — o que espera ação sua */}
        <DropdownMenuLabel className="text-[10px] tracking-wide text-muted-foreground uppercase">
          Precisam de você
        </DropdownMenuLabel>
        {decisions.length === 0 ? (
          <div className="px-2 py-2 text-center text-[12px] text-muted-foreground">
            Nada esperando você.
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

        {/* Atividade — feed de eventos (turnos, erros, limites) */}
        {notifs.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
                Atividade
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setFilter("all")}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10.5px] transition-colors",
                    filter === "all"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Tudo
                </button>
                <button
                  onClick={() => setFilter("unread")}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10.5px] transition-colors",
                    filter === "unread"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Não-lidas{unread > 0 ? ` (${unread})` : ""}
                </button>
                <button
                  onClick={() => markAllRead()}
                  disabled={unread === 0}
                  title="Marcar todas como lidas"
                  aria-label="Marcar todas como lidas"
                  className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <CheckCheck className="size-3.5" />
                </button>
              </div>
            </div>
            {feed.length === 0 ? (
              <div className="px-2 py-2 text-center text-[12px] text-muted-foreground">
                Nada não-lido.
              </div>
            ) : (
              feed.map((n) => (
                <DropdownMenuItem
                  key={n.id}
                  onSelect={() => {
                    markRead(n.id)
                    void goToConv(n)
                  }}
                  className="flex-col items-start gap-0.5 py-2"
                >
                  <span className="flex w-full items-center gap-2 text-[13px] text-foreground">
                    <NotifIcon kind={n.kind} />
                    <span className="min-w-0 flex-1 truncate">{n.title}</span>
                    <span className="shrink-0 text-[10.5px] text-muted-foreground/60">
                      {fmtRelative(n.ts)}
                    </span>
                    {!n.read && (
                      <span className="size-1.5 shrink-0 rounded-full bg-brass" />
                    )}
                  </span>
                  <span className="w-full truncate pl-[22px] text-[11px] text-muted-foreground">
                    {n.subtitle} ·{" "}
                    {n.kind === "run_error"
                      ? "turno falhou"
                      : n.kind === "limit"
                        ? "limite atingido"
                        : "turno concluído"}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </>
        )}

        {badge === 0 && notifs.length === 0 && (
          <div className="px-2 py-3 text-center text-[12.5px] text-muted-foreground">
            Tudo em dia. Nada por aqui.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
