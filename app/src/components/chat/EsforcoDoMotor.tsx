// O esforço no pé do seletor de motor (ADR-282): o degrau escolhido com a
// descrição dele, um deslizador por etapas e o "Padrão" (deixa o motor
// escolher) como voltar no canto. As etapas vêm do motor; o valor que vai ao
// CLI é o mesmo de sempre.

import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DeslizadorDeEtapas } from "@/components/ui/deslizador-de-etapas"
import type { AgentModelOption } from "@/lib/agents"
import { rotuloDoEsforco } from "@/lib/rotuloDoEsforco"

/** O que o topo do painel diz: nome do degrau e a descrição dele. Puro. */
export function leituraDoEsforco(
  efforts: readonly AgentModelOption[],
  valor: string,
): { nome: string; descricao: string | null } {
  const atual = efforts.find((e) => e.value === valor)
  if (!atual || atual.value === "default") return { nome: "Padrão", descricao: atual?.description ?? null }
  const nome = rotuloDoEsforco(atual.value, atual.label)
  return { nome: nome.charAt(0).toUpperCase() + nome.slice(1), descricao: atual.description ?? null }
}

export function EsforcoDoMotor({
  efforts,
  valor,
  travado,
  titulo,
  onChange,
}: {
  efforts: readonly AgentModelOption[]
  valor: string
  travado: boolean
  titulo?: string
  onChange: (v: string) => void
}) {
  const temPadrao = efforts.some((e) => e.value === "default")
  const etapas = efforts
    .filter((e) => e.value !== "default")
    .map((e) => ({ value: e.value, label: rotuloDoEsforco(e.value, e.label) }))
  const { nome, descricao } = leituraDoEsforco(efforts, valor)
  return (
    <div className="border-t bg-secondary/30 px-3 pt-2 pb-2.5" title={titulo}>
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <span className="font-mono text-[11px] tracking-wide text-muted-foreground/70 uppercase">esforço</span>
        <span className="text-[13px] font-medium text-foreground">{nome}</span>
        {descricao && <span className="min-w-0 truncate text-[11px] text-faint">{descricao}</span>}
        {temPadrao && valor !== "default" && (
          <Button
            type="button"
            size="chip"
            variant="ghost"
            disabled={travado}
            onClick={() => onChange("default")}
            className="ml-auto text-muted-foreground"
            title="Voltar ao padrão do modelo: o motor escolhe o esforço"
          >
            <RotateCcw />
            Padrão
          </Button>
        )}
      </div>
      <DeslizadorDeEtapas
        etapas={etapas}
        value={valor === "default" ? null : valor}
        onChange={onChange}
        disabled={travado}
        rotulo="Esforço de raciocínio"
      />
    </div>
  )
}
