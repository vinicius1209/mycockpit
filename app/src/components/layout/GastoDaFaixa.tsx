// O gasto na faixa de baixo (ADR-262): "hoje US$ X" de todos os motores. O
// total desta conversa NÃO fica ao lado: "hoje US$ 21 · esta conversa US$ 575"
// lia como contradição (a conversa soma toda a vida dela). Ele mora na dica e
// no painel, como "desde o início". Ao clicar, o painel por motor, hoje e 7
// dias. A soma é de `lib/gastoDaFaixa`; o valor desta conversa segue sendo o
// `statusCostItem` de sempre (ADR-047: turno sem preço não vira US$ 0).

import { useEffect, useState } from "react"
import { CircleDollarSign } from "lucide-react"
import { AgentLogo } from "@/components/common/AgentLogo"
import { AcaoDoClique, GatilhoDaFaixa, LinhaDoPainel, PainelDaFaixa } from "@/components/layout/statusBarChrome"
import { agentDef } from "@/lib/agents"
import { loadLedger } from "@/lib/db"
import { fmtCost } from "@/lib/format"
import { gastoDaFaixa, type GastoDaFaixa as Gasto } from "@/lib/gastoDaFaixa"
import { METER_TEXT } from "@/lib/meter"
import { sessionCost, sessionUnpricedTurns } from "@/lib/sessionCost"
import { statusCostItem } from "@/lib/statusBar"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"
import { useActiveConv, useChat } from "@/store/chat"

const SEMANA_MS = 7 * 24 * 60 * 60 * 1000
/** Rede de segurança: turno de missão ou de outra janela também grava custo. */
const RELEITURA_MS = 5 * 60 * 1000

/** Relê o livro quando um turno termina (é quando o custo é gravado) e a cada
 *  5 min. Falha de leitura deixa o último valor: a faixa não pisca. */
function useGasto(): Gasto | null {
  const [gasto, setGasto] = useState<Gasto | null>(null)
  const rodando = useChat((s) => Object.values(s.byId).filter((c) => c.running).length)
  useEffect(() => {
    let vivo = true
    const ler = () =>
      void loadLedger(Date.now() - SEMANA_MS)
        .then((rows) => vivo && setGasto(gastoDaFaixa(rows)))
        .catch((err) => console.warn("[faixa] não consegui ler o livro de custos:", err))
    ler()
    const t = setInterval(ler, RELEITURA_MS)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [rodando])
  return gasto
}

export function GastoDaFaixa() {
  const [aberto, setAberto] = useState(false)
  const gasto = useGasto()
  const conv = useActiveConv()
  const limite = useApp((s) => s.settings.sessionCostLimit)
  const daConversa = statusCostItem(
    { ...sessionCost(conv.items), unpriced: sessionUnpricedTurns(conv.items) },
    limite,
  )
  // Sem gasto hoje, a zona não desenha nada (sem "US$ 0,00" de enfeite).
  if (!gasto?.hoje) return null
  return (
    <PainelDaFaixa
      open={aberto}
      onOpenChange={setAberto}
      titulo="Gasto"
      icone={<CircleDollarSign className="size-3.5" />}
      align="start"
      largura="w-[380px]"
      nota="Do livro de custos, o mesmo do Painel. Turnos sem preço ficam fora da soma."
      dica={
        <>
          <div className="flex items-baseline gap-1.5">
            {/* 20px: exceção declarada da escala (§3), para o número que responde. */}
            <span className="text-[20px] font-semibold tabular-nums text-foreground">{fmtCost(gasto.hoje)}</span>
            <span className="text-[12px] text-muted-foreground">hoje</span>
          </div>
          {gasto.porMotor
            .filter((m) => m.hoje > 0)
            .map((m) => (
              <div key={m.agent} className="flex items-center gap-2">
                <span className="grid size-4 shrink-0 place-items-center">
                  <AgentLogo agent={m.agent} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{agentDef(m.agent)?.label ?? m.agent}</span>
                <span className="h-1 w-16 overflow-hidden rounded-full bg-secondary">
                  <span className="block h-full rounded-full bg-muted-foreground/60" style={{ width: `${(m.hoje / gasto.hoje) * 100}%` }} />
                </span>
                <span className="w-20 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtCost(m.hoje)}</span>
              </div>
            ))}
          {daConversa && (
            <div className="flex items-center gap-2 border-t border-border/40 pt-2">
              <span className="flex-1 text-[12px] text-muted-foreground">Esta conversa, desde o início</span>
              <span className={cn("font-mono text-[12px] tabular-nums", METER_TEXT[daConversa.tone])}>{daConversa.text}</span>
            </div>
          )}
        </>
      }
      peDaDica={
        <>
          <span>7 dias {fmtCost(gasto.semana)}</span>
          <AcaoDoClique>por motor</AcaoDoClique>
        </>
      }
      conteudo={
        <div className="space-y-1.5">
          {(gasto?.porMotor ?? []).map((m) => (
            <LinhaDoPainel key={m.agent}>
              <span className="grid size-4 shrink-0 place-items-center">
                <AgentLogo agent={m.agent} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                {agentDef(m.agent)?.label ?? m.agent}
                {m.semPreco > 0 && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    · {m.semPreco} sem preço
                  </span>
                )}
              </span>
              <span className="w-20 text-right font-mono text-[12px] tabular-nums text-foreground">
                {fmtCost(m.hoje)}
              </span>
              <span className="w-20 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                {fmtCost(m.semana)}
              </span>
            </LinhaDoPainel>
          ))}
          <div className="flex items-center gap-2 px-2.5 pt-1 font-mono text-[11px] text-muted-foreground">
            <span className="flex-1">total · hoje · 7 dias</span>
            <span className="w-20 text-right tabular-nums text-foreground">{fmtCost(gasto?.hoje ?? 0)}</span>
            <span className="w-20 text-right tabular-nums">{fmtCost(gasto?.semana ?? 0)}</span>
          </div>
          {daConversa && (
            <div className="flex items-center gap-2 px-2.5 font-mono text-[11px] text-muted-foreground">
              <span className="flex-1">esta conversa, desde o início</span>
              <span className={cn("tabular-nums", METER_TEXT[daConversa.tone])}>{daConversa.text}</span>
            </div>
          )}
        </div>
      }
    >
      <GatilhoDaFaixa aria-label="Gasto de hoje, de todos os motores">
        <span className="text-muted-foreground/70">hoje</span>
        <span className="tabular-nums text-foreground">{fmtCost(gasto.hoje)}</span>
      </GatilhoDaFaixa>
    </PainelDaFaixa>
  )
}
