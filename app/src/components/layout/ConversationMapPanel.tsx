import { useEffect, useMemo, useState } from "react"
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  LocateFixed,
  RotateCw,
  SlidersHorizontal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { copyText } from "@/lib/clipboard"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import { Section } from "@/components/layout/contextPanelChrome"
import {
  ConversationMapSourceDialog,
  type ConversationMapSource,
} from "@/components/layout/ConversationMapSourceDialog"
import { ConversationMapEditorDialog } from "@/components/layout/ConversationMapEditorDialog"
import {
  composeConversationMapView,
  deterministicConversationFacts,
  type ConversationMapPin,
  type ConversationMapPinsV1,
  type EvidenceRef,
  type SemanticClaim,
} from "@/lib/conversationMap"
import { currentOriginAnyKind, useInteractions } from "@/store/interactions"
import type { ChatItem } from "@/store/chat"
import { useConversationMaps } from "@/store/conversationMaps"
import { useApp } from "@/store/app"

const HORA = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
})

type ClaimLike = SemanticClaim | ConversationMapPin

function hasEvidence(claim: ClaimLike): claim is SemanticClaim {
  return "evidence" in claim && claim.evidence.length > 0
}

function ClaimLine({
  claim,
  onSources,
}: {
  claim: ClaimLike
  onSources: (source: ConversationMapSource) => void
}) {
  return (
    <div className="group/claim flex items-start gap-2 py-1">
      <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/55" />
      <p
        data-selectable
        className="min-w-0 flex-1 select-text text-[12px] leading-relaxed text-foreground/82"
      >
        {claim.text}
      </p>
      {hasEvidence(claim) ? (
        <button
          type="button"
          onClick={() => onSources(claim)}
          className="shrink-0 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/claim:opacity-100 focus-visible:opacity-100"
        >
          Ver fontes
        </button>
      ) : (
        <span className="shrink-0 text-[11px] text-muted-foreground/65">
          Fixado por você
        </span>
      )}
    </div>
  )
}

function DirectionTrail({
  changes,
  onSources,
}: {
  changes: Array<{
    id: string
    from: string
    to: string
    evidence: EvidenceRef[]
  }>
  onSources: (source: ConversationMapSource) => void
}) {
  return (
    <ol className="flex flex-col gap-3">
      {changes.map((change, index) => (
        <li key={change.id} className="group/route relative pl-4">
          {index < changes.length - 1 && (
            <span className="absolute top-1 bottom-[-14px] left-[3px] w-px bg-border" />
          )}
          <span className="absolute top-[6px] left-0 size-[7px] rounded-full bg-muted-foreground/55" />
          <button
            type="button"
            onClick={() => onSources(change)}
            className="flex w-full min-w-0 items-start gap-2 text-left"
          >
            <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground">
              <span>{change.from}</span>
              <ArrowRight className="mx-1 inline size-3" />
              <span className="text-foreground/85">{change.to}</span>
            </span>
            <span className="shrink-0 text-[11px] opacity-0 transition-opacity group-hover/route:opacity-100">
              Fontes
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

function statusLabel(
  status: string,
  generatedAt: number | null,
  staleTurns: number,
): string | null {
  if (status === "generating") return "Atualizando leitura…"
  if ((status === "stale" || status === "queued") && staleTurns > 0) {
    return `${staleTurns} ${staleTurns === 1 ? "turno novo" : "turnos novos"}`
  }
  if (status === "current" && generatedAt) {
    return `Atualizada às ${HORA.format(new Date(generatedAt))}`
  }
  return null
}

const OUTCOME: Record<string, string> = {
  succeeded: "Turno concluído",
  failed: "Turno encerrado com falha",
  cancelled: "Turno interrompido",
  limited: "Limite de uso atingido",
  interrupted: "Turno interrompido",
  unknown: "Turno encerrado sem desfecho confirmado",
}

export function ConversationMapPanel({
  conversationId,
  projectId,
  title,
  items,
  running,
  finalizing,
}: {
  conversationId: string | null
  projectId: string
  title: string | null
  items: ChatItem[] | undefined
  running: boolean
  finalizing: boolean
}) {
  const safeItems = items ?? []
  const entry = useConversationMaps((state) =>
    conversationId ? state.byConversation[conversationId] : undefined,
  )
  const hydrate = useConversationMaps((state) => state.hydrate)
  const scheduleRefresh = useConversationMaps((state) => state.scheduleRefresh)
  const refreshNow = useConversationMaps((state) => state.refreshNow)
  const replacePins = useConversationMaps((state) => state.replacePins)
  const queue = useInteractions((state) => state.queue)
  const [source, setSource] = useState<ConversationMapSource | null>(null)
  const [editing, setEditing] = useState(false)
  const [manualIssue, setManualIssue] = useState(false)
  const [copiedInitial, setCopiedInitial] = useState(false)


  useEffect(() => {
    if (!conversationId) return
    void hydrate(conversationId)
    scheduleRefresh({
      conversationId,
      projectId,
      items: safeItems,
      running,
      finalizing,
    })
  }, [conversationId, finalizing, hydrate, items, projectId, running, scheduleRefresh])

  const pendingInteractions = useMemo(
    () =>
      conversationId
        ? queue.filter(
            (request) => currentOriginAnyKind(request)?.convId === conversationId,
          )
        : [],
    [conversationId, queue, running],
  )
  const facts = useMemo(
    () =>
      deterministicConversationFacts({
        conversationId: conversationId ?? "",
        title,
        items: safeItems,
        runtime: { running, finalizing },
        pendingInteractions,
      }),
    [conversationId, finalizing, items, pendingInteractions, running, title],
  )
  const initialItem = safeItems.find(
    (candidate) => candidate.id === facts.initialSubject?.itemId,
  )

  async function copyInitialPrompt() {
    const textToCopy =
      (initialItem && "text" in initialItem ? initialItem.text : null) ||
      facts.initialSubject?.text ||
      ""
    if (!textToCopy) return
    const ok = await copyText(textToCopy)
    if (ok) {
      setCopiedInitial(true)
      setTimeout(() => setCopiedInitial(false), 1500)
    }
  }

  const pins = entry?.pins ?? { schemaVersion: 1 as const, revision: 0, constraints: [] }
  const semantic = entry?.stored?.payload ?? null
  const view = composeConversationMapView({
    facts,
    semantic,
    pins,
    semanticStatus: entry?.semanticStatus ?? "absent",
    generatedAt: entry?.stored?.generatedAt ?? null,
    staleSettledTurns: entry?.staleSettledTurns ?? 0,
  })
  // Sem mapa semântico ainda, o painel já é útil pelos fatos canônicos. Não
  // anuncie uma atualização invisível nem conte todos os turnos como “novos”
  // em relação a um mapa que nunca existiu.
  const updateLabel = entry?.stored
    ? statusLabel(
        view.provenance.semanticStatus,
        view.provenance.generatedAt,
        view.provenance.staleSettledTurns,
      )
    : entry?.semanticStatus === "unavailable"
      ? "Fatos do fio · leitura local indisponível"
      : "Fatos do fio"

  async function updateManually() {
    if (!conversationId) return
    setManualIssue(false)
    await refreshNow({
      conversationId,
      projectId,
      items: safeItems,
      running,
      finalizing,
      force: true,
    })
    setManualIssue(!!useConversationMaps.getState().byConversation[conversationId]?.lastIssue)
  }

  function reveal(itemId: string) {
    if (!conversationId) return
    useApp.getState().revealTranscriptItem(conversationId, itemId)
    setSource(null)
  }

  async function savePins(next: ConversationMapPinsV1) {
    if (!conversationId) return "conflict" as const
    const result = await replacePins(conversationId, next)
    if (result === "saved") {
      scheduleRefresh({
        conversationId,
        projectId,
        items: safeItems,
        running,
        finalizing,
        force: true,
      })
    }
    return result
  }

  if (!conversationId || safeItems.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <p className="text-[12px] text-muted-foreground">A conversa ainda não começou.</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container flex min-h-11 items-center gap-1.5 px-5">
          <span
            title={
              entry?.semanticStatus === "unavailable"
                ? "Fatos do fio · leitura local indisponível"
                : (updateLabel ?? undefined)
            }
            className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
          >
            {entry?.semanticStatus === "unavailable" ? (
              <>
                <span>Fatos do fio</span>
                <span className="hidden @min-[340px]:inline"> · leitura indisponível</span>
              </>
            ) : (
              updateLabel
            )}
          </span>
          {(view.provenance.semanticStatus === "stale" ||
            view.provenance.semanticStatus === "unavailable") && (
            <Button
              variant="ghost"
              size="compacto"
              onClick={() => void updateManually()}
              title="Atualizar leitura"
              aria-label="Atualizar leitura"
            >
              <RotateCw />
              <span className="hidden @min-[340px]:inline">Atualizar</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="compacto"
            onClick={() => setEditing(true)}
            title="Ajustar leitura"
            aria-label="Ajustar leitura"
          >
            <SlidersHorizontal />
            <span className="hidden @min-[340px]:inline">Ajustar</span>
          </Button>
        </div>
        {manualIssue && (
          <p role="status" className="px-5 pb-2 text-[11px] text-muted-foreground">
            A leitura automática não está disponível agora. Os fatos do fio continuam abaixo.
          </p>
        )}
        <ScrollArea className="flex-1">
          {view.currentFocus ? (
            <Section title="Rumo atual">
              <div className="px-1">
                <p
                  data-selectable
                  className="select-text text-[14px] font-semibold leading-snug text-foreground"
                >
                  {view.currentFocus.text}
                </p>
                {hasEvidence(view.currentFocus) && (
                  <button
                    type="button"
                    onClick={() => setSource(view.currentFocus as SemanticClaim)}
                    className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Ver fontes
                  </button>
                )}
                {!hasEvidence(view.currentFocus) && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Fixado por você
                  </p>
                )}
              </div>
            </Section>
          ) : facts.initialSubject ? (
            <Section title="Pedido que abriu a conversa">
              <div className="px-1">
                <p
                  data-selectable
                  className="select-text text-[13px] leading-relaxed text-foreground/85"
                >
                  {facts.initialSubject.text}
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="chip"
                    onClick={() => void copyInitialPrompt()}
                    title="Copiar pedido inicial"
                  >
                    {copiedInitial ? (
                      <Check className="size-3 text-muted-foreground" />
                    ) : (
                      <Copy className="size-3 text-muted-foreground" />
                    )}
                    {copiedInitial ? "Copiado" : "Copiar"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="chip"
                    onClick={() =>
                      setSource({
                        id: "pedido-inicial",
                        text: facts.initialSubject!.text,
                        certainty: "explicit",
                        evidence: [
                          {
                            itemId: facts.initialSubject!.itemId,
                            role: "user",
                            channel: "executor",
                          },
                        ],
                      })
                    }
                    title="Ver fontes do pedido"
                  >
                    Fontes
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="chip"
                    onClick={() => reveal(facts.initialSubject!.itemId)}
                    title="Mostrar no fio da conversa"
                  >
                    <LocateFixed className="size-3 text-muted-foreground" />
                    Ver no fio
                  </Button>
                </div>
              </div>
            </Section>
          ) : null}

          {view.explicitGoal && (
            <Section title="Objetivo declarado">
              <ClaimLine claim={view.explicitGoal} onSources={setSource} />
            </Section>
          )}
          {view.directionChanges.length > 0 && (
            <Section title="Trajetória">
              <DirectionTrail changes={view.directionChanges} onSources={setSource} />
            </Section>
          )}
          {view.understandings.length > 0 && (
            <Section title="Entendido até aqui">
              {view.understandings.map((claim) => (
                <ClaimLine key={claim.id} claim={claim} onSources={setSource} />
              ))}
            </Section>
          )}
          {view.constraints.length > 0 && (
            <Section title="Restrições">
              {view.constraints.map((claim) => (
                <ClaimLine key={claim.id} claim={claim} onSources={setSource} />
              ))}
            </Section>
          )}
          {view.openThreads.length > 0 && (
            <Section title="Em aberto">
              {view.openThreads.map((claim) => (
                <ClaimLine key={claim.id} claim={claim} onSources={setSource} />
              ))}
            </Section>
          )}
          {facts.latestOutcome && (
            <Section title="Último desfecho">
              <div className="flex items-start gap-2 px-1">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-[12px] text-foreground/85">
                    {OUTCOME[facts.latestOutcome.status]}
                  </p>
                  {view.latestOutcomeSummary && (
                    <button
                      type="button"
                      onClick={() => setSource(view.latestOutcomeSummary)}
                      className="mt-1 text-left text-[12px] leading-relaxed text-muted-foreground hover:text-foreground"
                    >
                      {view.latestOutcomeSummary.text}
                    </button>
                  )}
                </div>
              </div>
            </Section>
          )}
          {facts.pendingInteractions.length > 0 && (
            <Section title="Decisões pendentes">
              <p className="px-1 text-[12px] leading-relaxed text-foreground/85">
                {facts.pendingInteractions.length === 1
                  ? "Uma decisão espera por você nesta conversa."
                  : `${facts.pendingInteractions.length} decisões esperam por você nesta conversa.`}
              </p>
            </Section>
          )}
          {facts.tasks.length > 0 && (
            <Section title="Etapas">
              <TaskChecklist tasks={facts.tasks} live={running || finalizing} />
            </Section>
          )}
          {facts.background.length > 0 && (
            <Section title="Trabalho em segundo plano">
              <ul className="flex flex-col gap-1">
                {facts.background.map((work) => (
                  <li key={work.id} className="px-1 py-1.5 text-[12px]">
                    <span className="block truncate text-foreground/85">
                      {work.name ?? work.kind ?? "Tarefa em segundo plano"}
                    </span>
                    {work.summary && (
                      <span className="mt-0.5 block line-clamp-2 text-[11px] text-muted-foreground">
                        {work.summary}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <div className="h-5" aria-hidden="true" />
        </ScrollArea>
      </div>

      <ConversationMapSourceDialog
        source={source}
        items={safeItems}
        onClose={() => setSource(null)}
        onReveal={reveal}
      />
      <ConversationMapEditorDialog
        open={editing}
        pins={pins}
        semantic={semantic}
        onClose={() => setEditing(false)}
        onSave={savePins}
      />
    </>
  )
}
