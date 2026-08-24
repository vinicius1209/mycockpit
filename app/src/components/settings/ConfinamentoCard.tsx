// Configurações ▸ Confinamento. A pergunta: "o que o sistema operacional barra
// quando um agente roda aqui, e em quais modos".
//
// Por que existe: o S4 entregou o selo (`Selo::{Ausente, Parcial}`) e ele
// aparecia num lugar só — dentro do popover do chip de modo, no composer. Não
// havia tela onde você perguntasse "esta máquina está protegida?" e recebesse
// resposta. Conceito à frente, superfície atrás.
//
// O mecanismo é o do painel de Computer Use do Orca, e é o único que eu
// realmente invejei ali: o RESUMO É DERIVADO DAS LINHAS. Lá é
// `total - concedidas`; aqui é `linhas.filter(confinado)`. Não existe um estado
// "protegido" guardado à parte que alguém precise lembrar de atualizar — se as
// linhas mudarem, o topo muda junto, por construção.
//
// Seção própria, e não um bloco em "Agentes na máquina", porque aquela seção
// responde "quais CLIs existem aqui" e esta responde outra coisa. Enfiar isto
// lá repetiria o defeito do build 191, que o arquivo de seções documenta.

import { useEffect, useState } from "react"
import { Check, Loader2, Minus, ShieldAlert } from "lucide-react"
import {
  linhasDeConfinamento,
  lerConfinamento,
  resumoDoConfinamento,
  SEM_CONFINAMENTO,
  type Confinamento,
} from "@/lib/confinamento"
import { Note, SectionHeader } from "@/components/settings/parts"
import { sectionDef } from "@/components/settings/sections"

export function ConfinamentoCard() {
  const [c, setC] = useState<Confinamento>(SEM_CONFINAMENTO)
  // "ainda não perguntei" é estado próprio: sem ele o primeiro frame afirmaria
  // "sem confinamento" (o default fail-closed) toda vez que a seção abrisse.
  const [lendo, setLendo] = useState(true)
  const def = sectionDef("sandbox")

  useEffect(() => {
    void lerConfinamento().then((v) => {
      setC(v)
      setLendo(false)
    })
  }, [])

  const linhas = linhasDeConfinamento(c)
  const resumo = resumoDoConfinamento(linhas)

  return (
    <div>
      <SectionHeader title={def.title} description={def.question} />

      {lendo ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-3 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Perguntando ao sistema…
        </div>
      ) : (
        <>
          {/* O resumo. Cada número aqui é contado das linhas abaixo. */}
          <div className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-3">
            <div className="flex items-start gap-3">
              <span className="mt-px shrink-0">
                {resumo.temSandbox ? (
                  <Check className="size-4 text-st-success" />
                ) : (
                  <ShieldAlert className="size-4 text-st-warning" />
                )}
              </span>
              <div className="min-w-0">
                <div className="text-[13px] text-foreground">
                  {resumo.temSandbox
                    ? `Confinamento parcial: ${resumo.confinados} de ${resumo.total} modos passam pelo sandbox do sistema`
                    : "Sem confinamento do sistema nesta máquina"}
                </div>
                <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                  {resumo.temSandbox
                    ? "“Parcial” é a palavra exata: o sistema barra escrita no projeto, não no resto do disco. Chamar isso de completo seria a mentira confortável."
                    : "O sandbox-exec não foi encontrado aqui. Quem segura o agente continua sendo o motor, como antes do sandbox existir."}
                </div>
              </div>
            </div>
          </div>

          <ul className="mt-3 flex flex-col gap-1.5">
            {linhas.map((l) => (
              <li
                key={l.modo}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
              >
                <span className="shrink-0">
                  {l.confinado ? (
                    <Check className="size-4 text-st-success" />
                  ) : (
                    // Traço, não X: "não confinado" no modo que escreve é o
                    // desenho funcionando, não uma falha. Vermelho ali ensinaria
                    // o usuário a ignorar o vermelho.
                    <Minus className="size-4 text-muted-foreground/60" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-foreground">{l.rotulo}</div>
                  <div className="text-[12px] leading-snug text-muted-foreground">
                    {l.frase}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Note>
        Confinamento é do sistema operacional e vale por TURNO, com o modo que
        você escolheu na conversa. Ele não substitui o freio do motor: soma. Hoje
        só macOS; em Linux a leitura é a mesma e a resposta é “sem confinamento”.
      </Note>
    </div>
  )
}
