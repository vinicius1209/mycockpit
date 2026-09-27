// "Precisa de você" (ADR-268): o que está esperando um gesto da pessoa, de
// todos os motores e deste Mac. Uma função pura e uma lista só, lida pela
// página e pelo ponto do rail; os dois não podem discordar.
//
// A REGRA, que é a decisão inteira deste arquivo: pendência é **coisa
// meio-configurada que VOCÊ pode consertar**. Não é capacidade ausente por
// escolha, e não é limitação da máquina.
//
//   CLI instalada e DESLOGADA            → pendência. Você instalou, falta terminar.
//   CLI não instalada                    → não. Talvez você não queira aquele motor.
//   acompanhamento ausente num motor
//   instalado de cadastro global         → pendência. Sem ele a conversa não ganha
//                                          título e o turno avisa toda vez.
//   navegador ou computador ausentes     → não. São opcionais por decisão sua.
//   `gh` instalado e sem conta           → pendência. Mesma lógica do CLI.
//   `gh` ausente                         → não. É opcional; o resto funciona.
//   MCP ligado a um motor e sem login    → pendência. As tools falham no turno.
//   MCP com login mas desligado          → não. Ninguém vai chamá-lo.
//   máquina sem sandbox                  → NUNCA. É fato do sistema; um ponto que
//                                          não apaga ensina a ignorar o ponto.
//
// Não sabemos ≠ está quebrado: campo ausente nos fatos é "ainda não olhamos",
// e não olhar nunca vira alarme.

import { motoresDaMaquina } from "@/lib/agentRoster"
import type { WorkMcpSetup } from "@/lib/workMcpSetup"
import type { SectionId } from "@/components/settings/sections"

/** Os fatos que "Precisa de você" e o rail consultam. Campos OPCIONAIS de
 *  propósito: ausente = ainda não olhamos. */
export interface FatosDoRail {
  detected?: Record<string, { installed: boolean; auth: string }>
  gh?: { installed: boolean; contas: number }
  /** Estado do cadastro do acompanhamento, por motor de cadastro global. */
  trabalho?: Record<string, WorkMcpSetup["state"]>
  /** Nomes dos MCPs do projeto do rail que estão ligados e pedem login. */
  mcpPedemLogin?: string[]
  /** Motores cujo acompanhamento não deu para ler (CLI mudo, erro). Não é
   *  pendência (não há gesto), mas impede dizer "nada esperando". */
  trabalhoNaoVerificado?: string[]
}

export interface Pendencia {
  id: string
  /** Onde o gesto mora. */
  secao: SectionId
  titulo: string
  detalhe: string
  /** `conectar-acompanhamento` resolve ali mesmo; `abrir` leva à seção. */
  gesto: { tipo: "conectar-acompanhamento"; agent: string } | { tipo: "abrir" }
}

/** A lista, na ordem de gravidade: motor sem conta (não trabalha), motor sem
 *  acompanhamento (trabalha cego), conta de serviço, MCP. Pura. */
export function pendencias(f: FatosDoRail): Pendencia[] {
  const lista: Pendencia[] = []
  const motores = motoresDaMaquina()
  for (const a of motores) {
    const probe = f.detected?.[a.id]
    if (probe?.installed && probe.auth === "missing") {
      lista.push({
        id: `login:${a.id}`,
        secao: `motor:${a.id}`,
        titulo: `${a.label} sem conta conectada`,
        detalhe: "O motor está instalado, mas não trabalha sem login. Entre pelo CLI dele no terminal.",
        gesto: { tipo: "abrir" },
      })
    }
  }
  for (const a of motores) {
    if (!a.workMcp || !a.workMcpGlobalEnv) continue
    if (!f.detected?.[a.id]?.installed) continue
    const estado = f.trabalho?.[a.id]
    if (estado === "absent" || estado === "disabled") {
      lista.push({
        id: `acompanhamento:${a.id}`,
        secao: `motor:${a.id}`,
        titulo: `${a.label} sem acompanhamento`,
        detalhe: "A conversa não ganha título automático, e plano, etapas e processos não aparecem na Frota.",
        gesto: { tipo: "conectar-acompanhamento", agent: a.id },
      })
    } else if (estado === "conflict") {
      lista.push({
        id: `acompanhamento:${a.id}`,
        secao: `motor:${a.id}`,
        titulo: `${a.label} com o acompanhamento em conflito`,
        detalhe: "Já existe uma entrada com o mesmo nome e outra configuração no CLI. Ajuste-a para conectar.",
        gesto: { tipo: "abrir" },
      })
    }
  }
  if (f.gh?.installed && f.gh.contas === 0) {
    lista.push({
      id: "gh",
      secao: "services",
      titulo: "GitHub sem conta",
      detalhe: "O gh está instalado, mas sem conta: pull requests e checks não aparecem.",
      gesto: { tipo: "abrir" },
    })
  }
  for (const nome of f.mcpPedemLogin ?? []) {
    lista.push({
      id: `mcp:${nome}`,
      secao: "integrations",
      titulo: `${nome} pede login`,
      detalhe: "MCP ligado a um motor neste projeto. Sem login, as ferramentas dele falham no meio do turno.",
      gesto: { tipo: "abrir" },
    })
  }
  return lista
}

/** Os MCPs que viram pendência: ligados a algum motor, oferecendo login pelo
 *  app e sem sessão. Pura; a descoberta e o estado do login vêm de fora. */
export function mcpsPedindoLogin(
  servers: Array<{
    id: string
    name: string
    ofereceLogin: boolean
    ligado: boolean
  }>,
  conectados: ReadonlySet<string>,
): string[] {
  return servers
    .filter((s) => s.ofereceLogin && s.ligado && !conectados.has(s.id))
    .map((s) => s.name)
}
