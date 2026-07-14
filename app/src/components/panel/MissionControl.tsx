// F4 — Painel (mission control): a home cross-projeto do trabalho autônomo.
// Três blocos de LEITURA (sem ação primária): o que roda agora (qualquer
// projeto), o que espera decisão sua e o que já foi entregue — cada linha
// navega pra onde o objeto mora. Os dots são o sinal: pulse = vivo, âmbar =
// precisa de você, verde = entregue.

import { useEffect, useMemo, useState } from "react"
import { FileText, GitPullRequest, Swords } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useMission } from "@/store/mission"
import { scanDecisions, type Decision } from "@/lib/inbox"
import { listRecentDeliveries, type RecentDelivery } from "@/lib/db"
import { fmtCost } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Mesmo formato do InboxBell (duplicado local de propósito — sem tocar lá). */
function fmtRelative(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return "agora"
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

/** Abre a conversa dona do objeto vivo (turno/missão/disputa) no Trabalho. */
async function openConv(projectId: string, convId: string) {
  const app = useApp.getState()
  app.setActiveProject(projectId)
  await useChat.getState().openProject(projectId)
  await useChat.getState().switchConversation(convId)
  app.setViewMode("linear")
}

/** Navega pra ONDE a decisão mora (mesmo padrão do InboxBell.goTo): a conversa
 *  (Fusion) ou o plano (SDD). */
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

const SEP = ","
const split = (key: string) => (key ? key.split(SEP) : [])

type LiveKind = "turno" | "missão" | "disputa"

interface LiveRow {
  convId: string
  projectId: string
  projectName: string
  title: string
  kind: LiveKind
}

/** Título de uma seção do painel — mesmo label-mono das Sections do app. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="label-mono mb-1.5 px-3">{children}</h2>
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-2 text-[12.5px] text-muted-foreground/80">
      {children}
    </p>
  )
}

/** Dot de estado: o sinal do painel. */
function Dot({ tone }: { tone: "live" | "need" | "done" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "live" && "animate-cockpit-pulse bg-st-running",
        tone === "need" && "bg-st-warning",
        tone === "done" && "bg-st-success",
      )}
    />
  )
}

export function MissionControl() {
  const projects = useApp((s) => s.projects)
  // Ref do MAPA inteiro (estável entre updates) — nunca um objeto derivado novo.
  const convsByProject = useChat((s) => s.conversationsByProject)

  // Regras duras: selectors devolvem STRINGS estáveis (padrão useRunningConvIds
  // do Sidebar) — só mudam em transição de estado, não a cada delta de stream.
  const runningKey = useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.running)
      .map(([id]) => id)
      .sort()
      .join(SEP),
  )
  const missionKey = useMission((s) =>
    Object.entries(s.byConv)
      .filter(([, m]) => m.status === "running")
      .map(([id]) => id)
      .sort()
      .join(SEP),
  )
  const fusionLiveKey = useFusion((s) =>
    Object.entries(s.byConv)
      .filter(
        ([, f]) =>
          f.phase === "running" ||
          f.phase === "judging" ||
          f.phase === "promoting",
      )
      .map(([id]) => id)
      .sort()
      .join(SEP),
  )
  const decidingKey = useFusion((s) =>
    Object.entries(s.byConv)
      .filter(([, f]) => f.phase === "deciding")
      .map(([id]) => id)
      .sort()
      .join(SEP),
  )

  // a. Rodando agora — turnos + missões + disputas vivas, cross-projeto.
  // Detalhes (projectId/task/prompt) lidos via getState() DENTRO do memo: são
  // imutáveis por run, e as keys acima disparam o recompute nas transições.
  const liveRows = useMemo<LiveRow[]>(() => {
    const projName = new Map(projects.map((p) => [p.id, p.name]))
    const byId = useChat.getState().byId
    const titleOf = (convId: string, projectId: string) =>
      convsByProject[projectId]?.find((c) => c.id === convId)?.title ??
      "Conversa"
    const rows: LiveRow[] = []
    const push = (convId: string, kind: LiveKind, title?: string | null) => {
      const projectId = byId[convId]?.projectId
      if (!projectId) return
      rows.push({
        convId,
        projectId,
        projectName: projName.get(projectId) ?? "projeto",
        title: title || titleOf(convId, projectId),
        kind,
      })
    }
    for (const id of split(runningKey)) push(id, "turno")
    for (const id of split(missionKey))
      push(id, "missão", useMission.getState().byConv[id]?.task)
    for (const id of split(fusionLiveKey))
      push(id, "disputa", useFusion.getState().byConv[id]?.prompt)
    return rows
  }, [runningKey, missionKey, fusionLiveKey, projects, convsByProject])

  // b/c. Varreduras assíncronas (SQL + fs) — só em useEffect com cancelamento,
  // ao montar e num refresh leve a cada 30s (interval limpo no unmount).
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [deliveries, setDeliveries] = useState<RecentDelivery[]>([])
  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      if (projects.length > 0) {
        void scanDecisions(projects)
          .then((d) => {
            if (!cancelled) setDecisions(d)
          })
          .catch(() => {})
      } else {
        setDecisions([])
      }
      void listRecentDeliveries(8)
        .then((d) => {
          if (!cancelled) setDeliveries(d)
        })
        .catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [projects])

  // b. Precisam de você — scanDecisions (persistido) + disputas 'deciding' ao
  // vivo que a varredura ainda não viu (dedupe por convId).
  const needRows = useMemo<Decision[]>(() => {
    const seen = new Set(
      decisions.filter((d) => d.kind === "fusion").map((d) => d.convId),
    )
    const projName = new Map(projects.map((p) => [p.id, p.name]))
    const byId = useChat.getState().byId
    const extra: Decision[] = []
    for (const convId of split(decidingKey)) {
      if (seen.has(convId)) continue
      const projectId = byId[convId]?.projectId
      if (!projectId) continue
      extra.push({
        kind: "fusion",
        convId,
        projectId,
        projectName: projName.get(projectId) ?? "projeto",
        title:
          useFusion.getState().byConv[convId]?.prompt ??
          "Disputa aguardando decisão",
      })
    }
    return [...extra, ...decisions]
  }, [decisions, decidingKey, projects])

  // c. Rodapé: soma do que está NA TELA (as N entregas exibidas).
  const costShown = deliveries.reduce((a, d) => a + (d.costUsd ?? 0), 0)
  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  )

  return (
    <ScrollArea className="h-full w-full bg-background">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-9 px-8 pt-10 pb-14">
        {/* a. Rodando agora */}
        <section>
          <SectionTitle>Rodando agora</SectionTitle>
          {liveRows.length === 0 ? (
            <EmptyLine>Tudo quieto — nada rodando agora.</EmptyLine>
          ) : (
            <div className="flex flex-col gap-px">
              {liveRows.map((r) => (
                <button
                  key={`${r.kind}:${r.convId}`}
                  onClick={() => void openConv(r.projectId, r.convId)}
                  className="group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                >
                  <Dot tone="live" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {r.title}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">
                    {r.projectName}
                  </span>
                  <span className="label-mono shrink-0 text-[9.5px] text-muted-foreground/70">
                    {r.kind}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* b. Precisam de você */}
        <section>
          <SectionTitle>Precisam de você</SectionTitle>
          {needRows.length === 0 ? (
            <EmptyLine>Nada esperando você.</EmptyLine>
          ) : (
            <div className="flex flex-col gap-px">
              {needRows.map((d, i) => (
                <button
                  key={i}
                  onClick={() => void goTo(d)}
                  className="group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                >
                  <Dot tone="need" />
                  {d.kind === "fusion" ? (
                    <Swords className="size-3.5 shrink-0 text-brass" />
                  ) : d.kind === "prd" ? (
                    <FileText className="size-3.5 shrink-0 text-brass" />
                  ) : (
                    <GitPullRequest className="size-3.5 shrink-0 text-st-success" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {d.kind === "fusion"
                      ? `Escolher o vencedor da disputa — ${d.title}`
                      : d.kind === "prd"
                        ? `Aprovar PRD: ${d.planTitle}`
                        : `PR aberto: ${d.planTitle}`}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">
                    {d.projectName}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* c. Entregas recentes */}
        <section>
          <SectionTitle>Entregas recentes</SectionTitle>
          {deliveries.length === 0 ? (
            <EmptyLine>Nenhuma entrega registrada ainda.</EmptyLine>
          ) : (
            <>
              <div className="flex flex-col gap-px">
                {deliveries.map((d) => (
                  <div
                    key={d.id}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5"
                  >
                    <Dot tone="done" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                      {d.task}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-muted-foreground">
                      {projectNames.get(d.projectId) ?? "projeto"}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
                      {fmtCost(d.costUsd ?? undefined)}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground/60">
                      {fmtRelative(d.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 border-t border-border/60 px-3 pt-2.5 text-[11.5px] text-muted-foreground">
                {fmtCost(costShown)} nas últimas {deliveries.length} entregas
              </p>
            </>
          )}
        </section>
      </div>
    </ScrollArea>
  )
}
