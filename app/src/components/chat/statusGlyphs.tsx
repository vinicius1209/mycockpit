// Os GLIFOS de status do fio: o ponto do passo e o ícone do grupo.
//
// Saíram do MessageList pela catraca, e o recorte é o mais fechado que existe
// aqui: dois componentes de apresentação pura, sem estado, sem store, sem
// handler — recebem um status e devolvem um glifo.
//
// Vale como fronteira além do tamanho. É neste arquivo que mora a metade
// visível do §2.2 ("dentro do FIO o vivo é movimento, não tinta"): quem for
// mudar o vocabulário de status do fio mexe aqui, num arquivo de 60 linhas, em
// vez de caçar três `Loader2` no meio de 2.200.

import { Check, Circle, X } from "lucide-react"
import { CometaVivo } from "@/components/ui/cometa-vivo"
import type { summarizeToolGroup } from "@/lib/toolGroup"

/** Status de uma ação técnica. `recorded` é histórico antigo/adapter sem
 * resultado: neutro, nunca finge que ainda está pendente. */
export type StepStatus = "ok" | "error" | "running" | "recorded" | "stopped"

export function StepDot({
  status,
  ancestor = false,
}: {
  status: StepStatus
  /** Este passo em execução tem OUTRO passo em execução abaixo dele. */
  ancestor?: boolean
}) {
  // Sucesso é o caso comum: ponto NEUTRO (paleta A da despoluição — a tinta
  // sobra pra falha e pro que gira). Um tom acima do `recorded` pra distinguir
  // "concluiu bem" de "sem resultado registrado".
  if (status === "ok")
    return <span className="size-[7px] shrink-0 rounded-full bg-muted-foreground/45" />
  if (status === "error")
    return <span className="size-[7px] shrink-0 rounded-full bg-st-error" />
  // Parou por um corte seu (ADR-180): anel VAZADO, não ponto vermelho. Nem
  // giro congelado, que leria como falha de renderização (rodandoMotion.mjs).
  if (status === "stopped")
    return (
      <Circle
        className="size-2 shrink-0 text-muted-foreground/60"
        strokeWidth={3}
        aria-label="parou"
      />
    )
  // UM indicador vivo por linhagem (§2, orçamento de tinta): quem gira é o
  // passo MAIS PROFUNDO em execução, porque é ele o "agora". O ancestral
  // continua dizendo que o ramo está vivo, com o mesmo tom e sem movimento —
  // três spinners empilhados narravam o mesmo trabalho três vezes.
  // §2.2: no FIO o vivo é movimento, não tinta. O ancestral não gira (seria o
  // terceiro spinner narrando o mesmo trabalho), então ele diz "aceso" pelo
  // CONTRASTE contra os irmãos apagados — mesma forma, cinza mais forte.
  if (status === "running" && ancestor)
    return <span className="size-[7px] shrink-0 rounded-full bg-foreground/45" />
  // Passo em execução se MOVE (mesmo vocabulário do ToolGroupStatus): o
  // cometa cinza, "este passo executando" (ADR-259, ADR-256; o relógio
  // único não congela na oclusão da janela, que era o que o `key` da época
  // remendava aqui). O dot pulsante fica reservado ao rodapé
  // "trabalhando" (batimento do turno + cronômetro) — os dois sinais deixam de
  // ser dois pontos azuis idênticos.
  if (status === "running")
    return <CometaVivo papel="passo" className="text-muted-foreground" rotulo="executando" />
  return <span className="size-[7px] shrink-0 rounded-full bg-muted-foreground/25" />
}

export function ToolGroupStatus({
  state,
}: {
  state: ReturnType<typeof summarizeToolGroup>["state"]
}) {
  if (state === "running")
    return <CometaVivo papel="passo" className="text-muted-foreground" rotulo="executando" />
  if (state === "error")
    return <X className="size-3.5 shrink-0 text-st-error" aria-hidden="true" />
  // Check CINZA (paleta A): a forma segue dizendo "concluiu", sem competir com
  // a falha (vermelha) pela atenção. O vivo aqui já não é cor (§2.2) — é o
  // giro do spinner —, então o cinza do check não disputa com nada.
  if (state === "ok")
    return (
      <Check
        className="size-3.5 shrink-0 text-muted-foreground/60"
        aria-hidden="true"
      />
    )
  if (state === "stopped")
    return (
      <Circle
        className="size-2.5 shrink-0 text-muted-foreground/60"
        strokeWidth={3}
        aria-hidden="true"
      />
    )
  return <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
}
