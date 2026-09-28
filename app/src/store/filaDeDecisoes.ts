// A fila de decisões que a faixa e o sino leem juntos (ADR-271).
//
// Uma varredura e um relógio só, para a faixa e o sino nunca darem respostas
// diferentes para "o que espera você".

import { useEffect, useMemo } from "react"
import { create } from "zustand"
import { dismissProposal } from "@/lib/db"
import { montarFila, scanDecisions, type Decision } from "@/lib/inbox"
import { useApp } from "@/store/app"
import { useCards } from "@/store/cards"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"

const INTERVALO_MS = 30_000
const SEP = ","

const useVarredura = create<{ varridas: Decision[] }>(() => ({ varridas: [] }))

let geracao = 0

/** Relê do banco as decisões persistidas. Janela escondida não varre: ninguém
 *  olha a fila dela, e voltar a ficar visível varre na hora. */
export async function varrerDecisoes(): Promise<void> {
  const projects = useApp.getState().projects
  if (projects.length === 0) {
    useVarredura.setState({ varridas: [] })
    return
  }
  if (typeof document !== "undefined" && document.hidden) return
  const minha = ++geracao
  try {
    const varridas = await scanDecisions(projects)
    // A troca de projetos dispara uma varredura por leitor: vence a última.
    if (minha === geracao) useVarredura.setState({ varridas })
  } catch (e) {
    // ADR-017: a lista anterior fica, e o motivo não some numa promise.
    console.warn("[fila] varredura de decisões falhou", e)
  }
}

let leitores = 0
let pararRelogio: (() => void) | null = null

function assinar(): () => void {
  leitores += 1
  if (leitores === 1) {
    const timer = setInterval(() => void varrerDecisoes(), INTERVALO_MS)
    const aoVoltar = () => {
      if (!document.hidden) void varrerDecisoes()
    }
    document.addEventListener("visibilitychange", aoVoltar)
    pararRelogio = () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", aoVoltar)
    }
  }
  return () => {
    leitores -= 1
    if (leitores === 0) {
      pararRelogio?.()
      pararRelogio = null
    }
  }
}

/** A fila viva. Enquanto houver um leitor montado, o relógio de 30 s roda. */
export function useFilaDeDecisoes(): Decision[] {
  const projects = useApp((s) => s.projects)
  const varridas = useVarredura((s) => s.varridas)
  const cards = useCards((s) => s.all)
  // String estável: só muda em transição de fase, nunca a cada delta.
  const decidindo = useFusion((s) =>
    Object.entries(s.byConv)
      .filter(([, f]) => f.phase === "deciding")
      .map(([id]) => id)
      .sort()
      .join(SEP),
  )

  useEffect(assinar, [])
  useEffect(() => {
    void varrerDecisoes()
  }, [projects])

  return useMemo(
    () =>
      montarFila({
        varridas,
        decidindo: decidindo ? decidindo.split(SEP) : [],
        projects,
        cards,
        projetoDe: (convId) => useChat.getState().byId[convId]?.projectId,
        promptDe: (convId) => useFusion.getState().byConv[convId]?.prompt,
      }),
    [varridas, decidindo, projects, cards],
  )
}

/** Dispensa a proposta e tira da fila na hora. Falhou = ela fica, e o erro
 *  sobe para quem pediu. */
export async function dispensarProposta(proposalId: string): Promise<void> {
  await dismissProposal(proposalId)
  useVarredura.setState((s) => ({
    varridas: s.varridas.filter(
      (d) => !(d.kind === "proposal" && d.proposalId === proposalId),
    ),
  }))
  void varrerDecisoes()
}
