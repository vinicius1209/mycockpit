// Configurações ▸ Precisa de você (ADR-268): a primeira coisa ao abrir. Cada
// pendência diz o que a pessoa perde, com o botão que resolve ali mesmo ou que
// leva à seção onde o gesto mora. Sem pendência, uma linha diz isso, e a lista
// é a MESMA que acende o ponto do rail (`pendencias`).

import { useState } from "react"
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"
import { avisar, mensagemDe } from "@/lib/avisos"
import { Button } from "@/components/ui/button"
import { Row, SectionHeader } from "@/components/settings/parts"
import { pendencias, type FatosDoRail, type Pendencia } from "@/components/settings/pendencias"
import { sectionDef, type SectionId } from "@/components/settings/sections"
import { setWorkMcpEnabled } from "@/lib/workMcpSetup"
import { agentLabel } from "@/lib/agent"

function Linha({
  item,
  onAbrir,
  onResolvido,
}: {
  item: Pendencia
  onAbrir: (secao: SectionId) => void
  onResolvido: () => void
}) {
  const [busy, setBusy] = useState(false)
  async function conectar(agent: string) {
    setBusy(true)
    try {
      await setWorkMcpEnabled(agent, true)
      avisar.feito(`${agentLabel(agent)} conectado ao acompanhamento. Vale a partir da próxima conversa.`)
      onResolvido()
    } catch (cause) {
      avisar.erro(`Não consegui conectar o ${agentLabel(agent)} ao acompanhamento.`, { detalhe: mensagemDe(cause) })
    } finally {
      setBusy(false)
    }
  }
  const gesto = item.gesto
  return (
    <Row
      glifo={<AlertTriangle className="size-4 text-st-warning" aria-hidden />}
      titulo={item.titulo}
      dica={item.detalhe}
      direita={
        gesto.tipo === "conectar-acompanhamento" ? (
          <>
            <Button size="compacto" disabled={busy} onClick={() => void conectar(gesto.agent)}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Conectar
            </Button>
            <Button size="compacto" variant="ghost" onClick={() => onAbrir(item.secao)}>
              Ver motor
            </Button>
          </>
        ) : (
          <Button size="compacto" variant="outline" onClick={() => onAbrir(item.secao)}>
            Abrir
          </Button>
        )
      }
    />
  )
}

export function PrecisaDeVoce({
  fatos,
  onAbrir,
  onResolvido,
}: {
  fatos: FatosDoRail
  onAbrir: (secao: SectionId) => void
  onResolvido: () => void
}) {
  const def = sectionDef("pending")
  const lista = pendencias(fatos)
  // O acompanhamento é lido do CLI e leva um instante; até lá, não se promete
  // "nada esperando" sobre o que ainda não foi olhado.
  const verificando = fatos.trabalho === undefined
  const naoLidos = (fatos.trabalhoNaoVerificado ?? []).map(agentLabel)
  return (
    <div>
      <SectionHeader title={def.title} description={def.question} />
      {lista.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {lista.map((item) => (
            <Linha key={item.id} item={item} onAbrir={onAbrir} onResolvido={onResolvido} />
          ))}
        </ul>
      ) : verificando ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Verificando motores e serviços…
        </p>
      ) : naoLidos.length > 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Nada pendente no que deu para ler, mas não consegui verificar o
          acompanhamento do {naoLidos.join(", ")}. Veja na página do motor.
        </p>
      ) : (
        <ul>
          <Row
            glifo={<CheckCircle2 className="size-4 text-muted-foreground" aria-hidden />}
            titulo="Nada esperando por você"
            dica="Motores com conta, acompanhamento conectado onde precisa de cadastro, e nenhum MCP ligado pedindo login neste projeto."
          />
        </ul>
      )}
    </div>
  )
}
