// Configurações ▸ Motores ▸ <motor> (ADR-268). A pergunta: "este motor está
// pronto para trabalhar?". Antes a resposta estava em até cinco seções (CLIs,
// Modelos, MCPs, Navegador e desktop, Sessões no terminal), e o gesto que
// faltava ao Agy (o acompanhamento) morava no rodapé de uma página onde nem era
// linha. Aqui é um checklist por blocos, e cada linha tem o estado e o gesto.
//
// Tudo sai de capability, nunca do nome: `workMcp`/`workMcpGlobalEnv` dizem se
// o canal chega sozinho a cada turno ou pede cadastro no CLI; `hooksStatus`
// diz se há sessões de terminal para observar.

import { Button } from "@/components/ui/button"
import { RotateCcw } from "lucide-react"
import { BlockTitle, Row, SectionHeader } from "@/components/settings/parts"
import { CadastroGlobalDoMotor } from "@/components/settings/CadastroGlobalDoMotor"
import { LinhaDoMotor } from "@/components/settings/ComputadorPorMotor"
import { ExplicacaoDosHooks, HooksRow } from "@/components/settings/HooksSettings"
import { LinhaDaCli, NotaDaVerificacao, useVerificarMotores } from "@/components/settings/MachineAgents"
import { NavegadorDoMotor } from "@/components/settings/NavegadorPorMotor"
import { sectionDef, secaoDoMotor, type SectionId } from "@/components/settings/sections"
import type { AgentDef } from "@/lib/agents"
import { workMcpLabel, workMcpStatus, setWorkMcpEnabled } from "@/lib/workMcpSetup"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"

/** Como o acompanhamento chega a este motor, em palavras. Pura. */
export function comoOAcompanhamentoChega(
  agent: Pick<AgentDef, "workMcp" | "workMcpGlobalEnv">,
): "cadastro" | "automatico" | "sem-caminho" {
  if (!agent.workMcp) return "sem-caminho"
  return agent.workMcpGlobalEnv ? "cadastro" : "automatico"
}

const O_QUE_O_ACOMPANHAMENTO_FAZ =
  "Título automático da conversa, plano, etapas e processos longos na Frota."

function Acompanhamento({ agent }: { agent: AgentDef }) {
  const via = comoOAcompanhamentoChega(agent)
  if (via === "cadastro") {
    return (
      <Row
        titulo="Acompanhamento"
        dica={
          <>
            {O_QUE_O_ACOMPANHAMENTO_FAZ} Este motor não aceita ferramentas por
            turno: a Frota se cadastra uma vez no CLI, e vale para todos os
            projetos até você desconectar.
            <CadastroGlobalDoMotor
              agent={agent}
              consultar={workMcpStatus}
              alterar={setWorkMcpEnabled}
              rotuloDoEstado={workMcpLabel}
              rotuloConectar="Conectar"
              alvo="o acompanhamento"
            />
          </>
        }
      />
    )
  }
  return (
    <Row
      titulo="Acompanhamento"
      dica={
        via === "automatico"
          ? O_QUE_O_ACOMPANHAMENTO_FAZ
          : "Este motor ainda não recebe o acompanhamento: plano e etapas não aparecem, e o nome da conversa vem do modelo auxiliar."
      }
      direita={
        <span className="text-[12px] text-muted-foreground">
          {via === "automatico" ? "Automático, a cada turno" : "Sem caminho neste motor"}
        </span>
      }
    />
  )
}

export function PaginaDoMotor({
  agent,
  onAbrir,
}: {
  agent: AgentDef
  onAbrir: (secao: SectionId) => void
}) {
  const def = sectionDef(secaoDoMotor(agent.id))
  const lastUpdateCheck = useApp((s) => s.settings.lastUpdateCheck)
  const { checking, checkNow } = useVerificarMotores()
  return (
    <div>
      <SectionHeader
        title={def.title}
        description={def.question}
        action={
          <Button size="compacto" variant="ghost" onClick={() => void checkNow()} disabled={checking}>
            <RotateCcw className={cn("size-3.5", checking && "animate-spin")} />
            Verificar agora
          </Button>
        }
      />

      <BlockTitle>Motor</BlockTitle>
      <ul className="flex flex-col gap-1.5">
        <LinhaDaCli agent={agent} />
        <Row
          titulo="Modelos"
          dica="O que entra no seletor deste motor, o preço de cada modelo e o que entrou sozinho."
          direita={
            <Button size="compacto" variant="ghost" onClick={() => onAbrir("models")}>
              Ver modelos
            </Button>
          }
        />
      </ul>
      <NotaDaVerificacao lastUpdateCheck={lastUpdateCheck} />

      <div className="mt-5">
        <BlockTitle hint="Os canais que a Frota oferece aos turnos deste motor. Cada turno ainda pede a você antes de ver a tela ou mexer no computador.">
          O que a Frota liga neste motor
        </BlockTitle>
        <ul className="flex flex-col gap-1.5">
          <Acompanhamento agent={agent} />
          <Row titulo="Navegador da Frota" dica={<NavegadorDoMotor agent={agent} soCorpo />} />
          <Row titulo="Controle do computador" dica={<LinhaDoMotor agent={agent} soCorpo />} />
        </ul>
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
          As permissões do sistema para ver a tela ficam em{" "}
          <button
            type="button"
            className="text-foreground underline-offset-2 hover:underline"
            onClick={() => onAbrir("desktop")}
          >
            Segurança › Controle do computador
          </button>
          .
        </p>
      </div>

      {agent.hooksStatus && (
        <div className="mt-5">
          <BlockTitle>Sessões no terminal</BlockTitle>
          <ExplicacaoDosHooks />
          <ul className="flex flex-col gap-1.5">
            <HooksRow def={agent} />
          </ul>
        </div>
      )}
    </div>
  )
}
