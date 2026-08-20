// Rollup "Frota": tudo que está RODANDO agora, em QUALQUER projeto — o Fio
// Vivo (MessageList) é por sessão; isto é o cross-sessão que faltava pra
// quem roda vários worktrees em paralelo. Mesma família de Agendado/Planos de
// voo: view global via useApp.fleetOpen (estado próprio, não persiste),
// cobre o conteúdo principal, fecha ao navegar.
//
// `parseFleetKey`/`FleetRowItem` são PUROS/por-props de propósito (como
// ConversationSlot): o repo não tem jsdom, e useSyncExternalStore em SSR lê
// `getInitialState()` (zustand v5), não o estado atual — testar um
// componente que lê a store DIRETO via renderToStaticMarkup daria falso
// positivo. A lógica testável fica fora do container conectado à store.

import { useMemo, useSyncExternalStore } from "react"
import { Rocket, X } from "lucide-react"
import { AgentMark } from "@/components/common/AgentMark"
import { ScrollArea } from "@/components/ui/scroll-area"
import { agentLogoLabel } from "@/components/common/AgentLogo"
import { fmtAgo } from "@/lib/format"
import { minuteNow, subscribeMinute } from "@/lib/minuteTick"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

export interface FleetRow {
  id: string
  projectId: string
  agent: string
  startedAt: number | null
}

/** Desserializa a chave estável (id:projectId:agent:startedAt, uma por "|")
 *  de volta em linhas. Pura — sem isso, o hook não seria testável (ver topo). */
export function parseFleetKey(key: string): FleetRow[] {
  if (!key) return []
  return key.split("|").map((part): FleetRow => {
    const [id, projectId, agent, startedAt] = part.split(":")
    return { id, projectId, agent, startedAt: startedAt ? Number(startedAt) : null }
  })
}

/** Varre `byId` INTEIRO (todos os projetos, não só o ativo) por uma string
 *  ESTÁVEL — só muda em transição de run, nunca a cada delta de streaming
 *  (mesmo padrão de useRunningConvIds/useFinishedUnseen em ConversationList). */
function useFleetRows(): FleetRow[] {
  const key = useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.running)
      .map(([id, c]) => `${id}:${c.projectId}:${c.agent}:${c.startedAt ?? ""}`)
      .sort()
      .join("|"),
  )
  return useMemo(() => parseFleetKey(key), [key])
}

function openFleetRow(row: FleetRow) {
  useApp.getState().setActiveProject(row.projectId)
  useApp.getState().setViewMode("linear")
  void useChat.getState().switchConversation(row.id)
}

/** Uma linha da Frota — PRESENTACIONAL (só props, sem tocar a store), pra dar
 *  pra testar via SSR sem o problema descrito no topo do arquivo. */
export function FleetRowItem({
  agent,
  projectName,
  title,
  startedAt,
  agora,
  onOpen,
}: {
  agent: string
  projectName: string
  title: string
  startedAt: number | null
  agora: number
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2.5 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border/70 hover:bg-accent/40"
    >
      <span className="conv-spin shrink-0" aria-hidden />
      <AgentMark agent={agent} title={agentLogoLabel(agent)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-foreground">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {projectName}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
        {startedAt ? fmtAgo(agora - startedAt) : ""}
      </span>
    </button>
  )
}

export function FleetView() {
  const setFleetOpen = useApp((s) => s.setFleetOpen)
  const rows = useFleetRows()
  const projects = useApp((s) => s.projects)
  const conversationsByProject = useChat((s) => s.conversationsByProject)
  const agora = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow)

  return (
    <ScrollArea className="h-full w-full bg-background">
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-8 pt-8 pb-14">
        <header className="flex items-center gap-2">
          <Rocket className="size-3.5 text-muted-foreground" />
          <h1 className="label-mono">Frota</h1>
          {rows.length > 0 && (
            <span className="text-[12px] text-muted-foreground/70 tabular-nums">
              {rows.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => setFleetOpen(false)}
            title="Fechar"
            aria-label="Fechar Frota"
            className="ml-auto rounded-md p-1 text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-card/30 px-6 py-10 text-center">
            <Rocket className="size-6 text-muted-foreground/60" />
            <p className="text-[13px] text-muted-foreground">
              Nada rodando agora. Turnos em execução aparecem aqui, em
              qualquer projeto.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map((row) => (
              <FleetRowItem
                key={row.id}
                agent={row.agent}
                projectName={projects.find((p) => p.id === row.projectId)?.name ?? "?"}
                title={
                  conversationsByProject[row.projectId]?.find((m) => m.id === row.id)
                    ?.title ?? "Conversa"
                }
                startedAt={row.startedAt}
                agora={agora}
                onOpen={() => openFleetRow(row)}
              />
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
