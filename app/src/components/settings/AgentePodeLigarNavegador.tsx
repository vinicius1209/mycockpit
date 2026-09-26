// "O agente pode ligar o navegador deste projeto" (ADR-228). Ligar o navegador
// é gesto seu; esta chave é o jeito de dar esse gesto uma vez, por projeto,
// e retirar quando quiser. Desligada, o agente pede e espera.

import { useEffect, useState } from "react"
import { avisar, mensagemDe } from "@/lib/avisos"
import { Field } from "@/components/settings/parts"
import { Switch } from "@/components/ui/switch"
import { agentePodeLigarNavegador, setAgentePodeLigarNavegador } from "@/lib/browser"

export function AgentePodeLigarNavegador({ projectPath }: { projectPath: string }) {
  const [permitido, setPermitido] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelado = false
    agentePodeLigarNavegador(projectPath)
      .then((v) => {
        if (!cancelado) setPermitido(v)
      })
      .catch((erro) => {
        console.error("[navegador] não consegui ler a autorização", erro)
        if (!cancelado) setPermitido(false)
      })
    return () => {
      cancelado = true
    }
  }, [projectPath])

  async function mudar(v: boolean) {
    try {
      setPermitido(await setAgentePodeLigarNavegador(projectPath, v))
    } catch (erro) {
      avisar.erro("Não consegui mudar a autorização do navegador.", { origem: { projeto: projectPath }, detalhe: mensagemDe(erro) })
    }
  }

  return (
    <Field
      label="O agente pode ligar este navegador"
      hint="Sem pedir, quando precisar dele. A Frota avisa na tela quando foi o agente que ligou. Desligado, ele pede e espera você."
    >
      <Switch
        checked={permitido === true}
        disabled={permitido === null}
        onCheckedChange={(v) => void mudar(v)}
        aria-label="O agente pode ligar o navegador deste projeto"
      />
    </Field>
  )
}
