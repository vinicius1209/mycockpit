// A faixa "precisa de você" — CHROME, não aba (ADR-040).
//
// Por que aqui e não dentro do Painel: visibilidade permanente só existe em
// elemento de moldura. Uma aba some no instante em que você troca de
// superfície, então uma fila que mora numa aba só é vista por quem já foi
// olhar. A faixa mora entre a barra de título e o conteúdo, o que a torna
// visível de dentro do Trabalho (o requisito duro), das Features e do Painel.
//
// Regras que ela obedece:
//  - **Só existe com conteúdo** (§5): fila vazia = zero pixel, sem placeholder
//    e sem altura reservada. É o estado NORMAL, pela evidência de uso.
//  - **Fala de decisão, nunca do agora** (§6/B2.2): nada de "N em voo" aqui —
//    a linha viva do turno continua dona única do que está rodando.
//  - **Âmbar** (§2): "precisa de você". Nunca vermelho (nada falhou).
//  - A fila expandida é E2 (flutuante) e não empurra o conteúdo: abrir a fila
//    não pode reflowar o fio da conversa que você estava lendo.
//
// A varredura (SQL + fs) é a MESMA que morava no Painel, com a mesma cadência
// de 30s; ela mudou de casa junto com a fila. O enriquecimento do PR via `gh`
// só roda com a fila ABERTA (antes rodava sempre): fila fechada não desenha
// checks, e martelar o `gh` por um número que ninguém vê era desperdício.

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useCards } from "@/store/cards"
import {
  cardDecisions,
  pendingDecisions,
  scanDecisions,
  type Decision,
} from "@/lib/inbox"
import {
  cachedPrEnrichment,
  fetchPrEnrichment,
  mergePr,
  orderQueue,
  prResolved,
  type PrEnrichment,
} from "@/lib/panel"
import { dismissProposal } from "@/lib/db"
import { stripSummary } from "@/lib/decisions"
import { confirm } from "@/lib/confirm"
import { DecisionList } from "@/components/decisions/DecisionCards"

const SEP = ","
const split = (key: string) => (key ? key.split(SEP) : [])

export function DecisionStrip() {
  const projects = useApp((s) => s.projects)
  const open = useApp((s) => s.decisionsOpen)
  const setOpen = useApp((s) => s.setDecisionsOpen)

  // disputas AO VIVO esperando decisão que a varredura ainda não viu (mesma
  // regra do Painel antigo): string estável, só muda em transição de fase.
  const decidingKey = useFusion((s) =>
    Object.entries(s.byConv)
      .filter(([, f]) => f.phase === "deciding")
      .map(([id]) => id)
      .sort()
      .join(SEP),
  )
  const allCards = useCards((s) => s.all)

  const [decisions, setDecisions] = useState<Decision[]>([])
  const [refreshTick, setRefreshTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      if (projects.length === 0) {
        setDecisions([])
        return
      }
      // janela escondida não varre: isto virou ticker global (antes só existia
      // com o Painel montado), e a varredura lê o .claude/plans de N projetos.
      // Voltar a ficar visível dispara um refresh na hora (efeito abaixo).
      if (typeof document !== "undefined" && document.hidden) return
      void scanDecisions(projects)
        .then((d) => {
          if (!cancelled) setDecisions(d)
        })
        .catch((e) => {
          // ADR-017: quem espera a fila merece saber que ela não veio.
          console.warn("[faixa] varredura de decisões falhou", e)
        })
    }
    refresh()
    const timer = setInterval(refresh, 30_000)
    const onVisible = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [projects, refreshTick])

  const [merged, setMerged] = useState<ReadonlySet<string>>(() => new Set())
  const [mergingUrl, setMergingUrl] = useState<string | null>(null)
  const [prData, setPrData] = useState<Record<string, PrEnrichment | null>>({})

  const pending = useMemo<Decision[]>(() => {
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
    // PR sai da fila se: mergeada nesta sessão OU o GitHub diz que já foi
    // resolvida (merge feito fora do app).
    const all = [
      ...extra,
      ...decisions,
      ...cardDecisions(allCards, projects),
    ].filter(
      (d) =>
        d.kind !== "pr" ||
        (!merged.has(d.prUrl) && !prResolved(prData[d.prUrl])),
    )
    return pendingDecisions(orderQueue(all, prData))
  }, [decisions, decidingKey, projects, prData, merged, allCards])

  // Enriquecimento gh por PR: lazy, só com a fila aberta, cache de 60s no
  // lib/panel, fail-soft (null → card sem 2ª linha).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    for (const d of pending) {
      if (d.kind !== "pr") continue
      const url = d.prUrl
      const hit = cachedPrEnrichment(url)
      if (hit) setPrData((m) => (m[url] === hit ? m : { ...m, [url]: hit }))
      void fetchPrEnrichment(url)
        .then((e) => {
          if (cancelled) return
          setPrData((m) => (m[url] === e ? m : { ...m, [url]: e }))
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [open, pending])

  // A fila esvaziou com ela aberta: a faixa some, e o estado aberto não pode
  // sobreviver à faixa (senão a próxima decisão nasceria já expandida).
  useEffect(() => {
    if (open && pending.length === 0) setOpen(false)
  }, [open, pending.length, setOpen])

  // Escape fecha a fila (é sobreposição, e toda sobreposição do app sai por
  // aí), MENOS com um dialog aberto por cima: o Escape é dele, e fechar os dois
  // de uma vez tiraria a fila do usuário que só quis cancelar o merge. Mesmo
  // gate do atalho de ditado (App.tsx): dialog Radix com data-state=open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, setOpen])

  async function handleMerge(d: Extract<Decision, { kind: "pr" }>) {
    const ok = await confirm({
      title: `Fazer merge de "${d.planTitle}"?`,
      description:
        `Squash merge do PR em ${d.projectName}. ` +
        "O GitHub ainda valida as proteções da branch.",
      confirmLabel: "Merge",
    })
    if (!ok) return
    setMergingUrl(d.prUrl)
    try {
      await mergePr(d.prUrl)
      toast.success(`PR mergeado: ${d.planTitle}`)
      setMerged((prev) => new Set(prev).add(d.prUrl))
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha no merge")
    } finally {
      setMergingUrl(null)
    }
  }

  async function handleDismissProposal(
    d: Extract<Decision, { kind: "proposal" }>,
  ) {
    try {
      await dismissProposal(d.proposalId)
      setDecisions((prev) =>
        prev.filter(
          (x) => !(x.kind === "proposal" && x.proposalId === d.proposalId),
        ),
      )
      setRefreshTick((t) => t + 1)
    } catch {
      toast.error("Falha ao dispensar a proposta")
    }
  }

  const summary = stripSummary(pending)
  // A regra inteira em uma linha: sem conteúdo, a faixa NÃO EXISTE.
  if (!summary) return null

  return (
    // z-30, não z-[105]: o `.grain` da raiz NÃO cria contexto de empilhamento
    // (o z-50 dele mora no ::after), então esta faixa compete na raiz com os
    // PORTAIS de dialog (z-50). Acima do conteúdo (que é z-auto), abaixo de
    // qualquer dialog — senão o confirm do Merge renderiza atrás da gaveta.
    <div className="relative z-30 shrink-0 border-y border-st-warning/30 bg-st-warning/8">
      <div className="flex h-[30px] items-center gap-2.5 px-3">
        {/* Âmbar mora no dot, na borda e no fundo; o TEXTO é foreground. Âmbar
            13px sobre fundo âmbar dá ~2,9:1 no tema claro (AA pede 4,5), e o
            padrão da casa é o da Frota: sinal colorido, texto legível. */}
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-st-warning" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          {summary.text}
        </span>
        {summary.ageText && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
            {summary.ageText}
          </span>
        )}
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className={
            open
              ? "shrink-0 rounded-md px-2.5 py-0.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              : "shrink-0 rounded-md bg-brass px-2.5 py-0.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
          }
        >
          {open ? "Fechar" : "Abrir"}
        </button>
      </div>

      {open && (
        <div className="absolute inset-x-0 top-full max-h-[60vh] overflow-y-auto border-b bg-background p-3 shadow-[var(--shadow-pop)]">
          <DecisionList
            pending={pending}
            prData={prData}
            mergingUrl={mergingUrl}
            onMerge={(d) => void handleMerge(d)}
            onDismissProposal={(d) => void handleDismissProposal(d)}
          />
        </div>
      )}
    </div>
  )
}
