// A faixa "precisa de você" — CHROME, não aba (ADR-040).
//
// Por que aqui e não dentro do Painel: visibilidade permanente só existe em
// elemento de moldura. Uma aba some no instante em que você troca de
// superfície, então uma fila que mora numa aba só é vista por quem já foi
// olhar. A faixa mora entre a barra de título e o conteúdo, o que a torna
// visível de dentro do Trabalho (o requisito duro) e do Painel.
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
// A varredura (SQL) mora em `store/filaDeDecisoes`, com a mesma cadência de
// 30s, e o sino lê a mesma fila.

import { useEffect } from "react"
import { avisar } from "@/lib/avisos"
import { useApp } from "@/store/app"
import type { Decision } from "@/lib/inbox"
import { stripSummary } from "@/lib/decisions"
import { dispensarProposta, useFilaDeDecisoes } from "@/store/filaDeDecisoes"
import { DecisionList } from "@/components/decisions/DecisionCards"

export function DecisionStrip() {
  const open = useApp((s) => s.decisionsOpen)
  const setOpen = useApp((s) => s.setDecisionsOpen)
  // A mesma fila que o sino lê (ADR-271): varredura e relógio de 30 s moram lá.
  const pending = useFilaDeDecisoes()

  // A fila esvaziou com ela aberta: a faixa some, e o estado aberto não pode
  // sobreviver à faixa (senão a próxima decisão nasceria já expandida).
  useEffect(() => {
    if (open && pending.length === 0) setOpen(false)
  }, [open, pending.length, setOpen])

  // Escape fecha a fila (é sobreposição, e toda sobreposição do app sai por
  // aí), MENOS com um dialog aberto por cima: o Escape é dele, e fechar os dois
  // de uma vez tiraria a fila do usuário que só quis fechar o dialog. Mesmo
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

  async function handleDismissProposal(
    d: Extract<Decision, { kind: "proposal" }>,
  ) {
    try {
      await dispensarProposta(d.proposalId)
    } catch {
      avisar.erro("Falha ao dispensar a proposta")
    }
  }

  const summary = stripSummary(pending)
  // A regra inteira em uma linha: sem conteúdo, a faixa NÃO EXISTE.
  if (!summary) return null

  return (
    // z-30, não z-[105]: o `.grain` da raiz NÃO cria contexto de empilhamento
    // (o z-50 dele mora no ::after), então esta faixa compete na raiz com os
    // PORTAIS de dialog (z-50). Acima do conteúdo (que é z-auto), abaixo de
    // qualquer dialog, senão um confirm aberto dela renderiza atrás da gaveta.
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
            onDismissProposal={(d) => void handleDismissProposal(d)}
          />
        </div>
      )}
    </div>
  )
}
