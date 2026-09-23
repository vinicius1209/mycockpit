// Configurações ▸ Uso e custo ▸ Histórico de custo, segunda manutenção
// (ADR-226): turnos gravados com o custo ACUMULADO da sessão. Mesmo idioma da
// `CostMaintenance`: o estado à vista, o gesto explícito e o porquê a um
// clique. Some quando não há nada a corrigir.

import { useEffect, useState } from "react"
import { Calculator, ChevronDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHead } from "@/components/settings/parts"
import { isTauri } from "@/lib/db"
import { fmtCost } from "@/lib/format"
import { corrigirCustoAcumulado, planejarCustoAcumulado } from "@/lib/custoAcumulado"
import { cn } from "@/lib/utils"

export function CustoDaSessaoMaintenance() {
  const [plano, setPlano] = useState<{ linhas: number; antes: number; depois: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [feito, setFeito] = useState<{ linhas: number; antes: number; depois: number; recibos: number } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [detalhes, setDetalhes] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    let cancelado = false
    planejarCustoAcumulado()
      .then((p) => {
        if (!cancelado) setPlano({ linhas: p.mudancas.length, antes: p.antes, depois: p.depois })
      })
      .catch((e) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelado = true
    }
  }, [])

  async function corrigir() {
    setBusy(true)
    setErro(null)
    try {
      const out = await corrigirCustoAcumulado()
      setFeito({ linhas: out.mudancas.length, antes: out.antes, depois: out.depois, recibos: out.recibos })
      setPlano({ linhas: 0, antes: 0, depois: 0 })
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!erro && !feito && (plano == null || plano.linhas === 0)) return null

  return (
    <div className="mt-3">
      <Card>
        <CardHead
          nome={
            plano != null && plano.linhas > 0
              ? `${plano.linhas} ${plano.linhas === 1 ? "turno gravado" : "turnos gravados"} com o custo da sessão inteira`
              : "Custo por turno corrigido"
          }
          meta={
            plano != null && plano.linhas > 0
              ? `somam ${fmtCost(plano.antes)}, o gasto real é ${fmtCost(plano.depois)}`
              : undefined
          }
          acao={
            plano != null && plano.linhas > 0 ? (
              <Button size="padrao" variant="secondary" disabled={busy} onClick={() => void corrigir()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Calculator className="size-3.5" />}
                Corrigir
              </Button>
            ) : undefined
          }
        />
        {feito && (
          <CardBody>
            <p className="text-[13px] text-foreground">
              {feito.linhas} {feito.linhas === 1 ? "turno corrigido" : "turnos corrigidos"}: {fmtCost(feito.antes)} →{" "}
              {fmtCost(feito.depois)}, {feito.recibos} {feito.recibos === 1 ? "recibo" : "recibos"} no fio.
            </p>
            <p className="text-[12px] text-muted-foreground">Os valores originais ficaram guardados (nada foi apagado).</p>
          </CardBody>
        )}
        {erro && (
          <CardBody>
            <p className="text-[13px] text-destructive">Falhou: {erro}</p>
          </CardBody>
        )}
      </Card>
      <div className="mt-2">
        <button
          onClick={() => setDetalhes((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className={cn("size-3 transition-transform", detalhes && "rotate-180")} />
          ver o que a correção faz
        </button>
        {detalhes && (
          <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
            A partir do Claude Code 2.1.280, o custo que ele informa ao retomar uma sessão
            é o total da sessão até ali, não o do turno. O app gravava esse total em cada
            turno. A correção usa a diferença para o turno anterior da mesma conversa, só
            quando os tokens do turno confirmam que o valor era acumulado, e guarda os
            valores originais. Turnos novos já nascem com o custo certo.
          </p>
        )}
      </div>
    </div>
  )
}
