// O resumo automático na aba Conversa (mock `aba-conversa.html` rev. 2).
//
// É ENFEITE, nunca a estrutura: o histórico de pedidos não depende dele.
// Funcionando, entra curto (rumo e o que está em aberto) com carimbo de hora.
// Falhando, diz o motivo onde a promessa é feita, com "Tentar de novo" e
// "Desligar nesta conversa". Desligado, uma linha com o caminho de volta.
// Antes a aba inteira girava em torno dele e mostrava "leitura indisponível"
// em conversa de tamanho real (o modelo local recusava a entrada).

import { Button } from "@/components/ui/button"
import type { ConversationMapSource } from "@/components/layout/ConversationMapSourceDialog"
import type { ConversationMapView, SemanticClaim } from "@/lib/conversationMap"
import { fmtTime } from "@/lib/format"

/** Por que o resumo não saiu, em palavras de gente. Puro, para teste. */
export function motivoDoResumo(issue: string | null): string {
  switch (issue) {
    case "input_too_large":
      return "A conversa é maior do que o modelo local lê de uma vez."
    case "deadline_exceeded":
      return "O modelo local demorou demais para responder."
    case "unsupported_os":
    case "device_not_eligible":
    case "intelligence_disabled":
    case "model_not_ready":
    case "framework_unavailable":
      return "O modelo local não está disponível neste computador."
    default:
      return "O modelo local não respondeu."
  }
}

function temFontes(claim: unknown): claim is SemanticClaim {
  return !!claim && typeof claim === "object" && "evidence" in claim && (claim as SemanticClaim).evidence.length > 0
}

export function ResumoDaConversa({
  view,
  status,
  issue,
  desligado,
  tentando,
  onSource,
  onTentar,
  onDesligar,
  onLigar,
}: {
  view: ConversationMapView
  status: string
  issue: string | null
  desligado: boolean
  tentando: boolean
  onSource: (source: ConversationMapSource) => void
  onTentar: () => void
  onDesligar: () => void
  onLigar: () => void
}) {
  if (desligado) {
    return (
      <div className="flex items-center gap-1.5 px-5 pb-2 text-[11px] text-muted-foreground">
        <span>Resumo desligado nesta conversa</span>
        <Button type="button" variant="ghost" size="chip" onClick={onLigar}>
          Ligar
        </Button>
      </div>
    )
  }
  if (status === "unavailable") {
    return (
      <div className="mx-5 mb-2 rounded-md bg-muted/40 px-3 py-2">
        <p className="text-[12px] text-foreground/85">Resumo automático indisponível nesta conversa.</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {motivoDoResumo(issue)} O histórico abaixo não depende dele.
        </p>
        <div className="mt-1.5 flex items-center gap-1">
          <Button type="button" variant="ghost" size="chip" disabled={tentando} onClick={onTentar}>
            {tentando ? "Tentando…" : "Tentar de novo"}
          </Button>
          <Button type="button" variant="ghost" size="chip" onClick={onDesligar}>
            Desligar nesta conversa
          </Button>
        </div>
      </div>
    )
  }
  const rumo = view.currentFocus
  if (!rumo || !view.provenance.generatedAt) return null
  const abertos = view.openThreads.map((c) => c.text)
  return (
    <div className="mx-5 mb-2 rounded-md bg-muted/40 px-3 py-2">
      <p data-selectable className="select-text text-[12px] leading-relaxed text-foreground/85">
        <span className="text-muted-foreground">Rumo: </span>
        {rumo.text}
      </p>
      {abertos.length > 0 && (
        <p data-selectable className="mt-0.5 select-text text-[12px] leading-relaxed text-foreground/85">
          <span className="text-muted-foreground">Em aberto: </span>
          {abertos.join(" · ")}
        </p>
      )}
      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        <span>
          Resumo automático · {status === "stale" ? "de antes dos últimos turnos" : `atualizado às ${fmtTime(view.provenance.generatedAt)}`}
        </span>
        {temFontes(rumo) && (
          <Button type="button" variant="ghost" size="chip" onClick={() => onSource(rumo)}>
            Ver fontes
          </Button>
        )}
      </div>
    </div>
  )
}
