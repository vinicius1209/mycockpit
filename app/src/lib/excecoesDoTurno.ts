// O que do manifesto do turno merece a atenção da pessoa (ADR-239, mock
// aprovado em docs/mocks/capacidades-do-turno.html).
//
// A faixa "Capacidades deste run" (ADR-126) nasceu para provar o que o turno
// recebeu de fato: um Playwright global tinha aberto navegador fora da Frota
// sem ninguém ver. O dado era certo, a forma não: a faixa aparecia em TODO
// turno com "7 fontes · 283 tools confirmadas", números que não mudam decisão
// nenhuma, e o que importava ficava no meio do texto, cortado. Agora o
// composer só mostra EXCEÇÃO, uma frase por exceção, com o gesto quando há
// um; sem exceção, nada. O inventário mora na aba "O que o agente vê".

import type { EffectiveRunManifest, McpPlanIssueCode } from "@/lib/tooling"

/** O motivo de uma capacidade ter ficado fora do turno, para a pessoa. */
export const MOTIVO_DA_OMISSAO: Record<McpPlanIssueCode, string> = {
  "source-missing": "não está mais configurado",
  incompatible: "não é compatível com este motor",
  "health-unavailable": "não respondeu ao teste de disponibilidade",
  "browser-offline": "navegador deste projeto desligado",
  "browser-unavailable": "navegador deste projeto indisponível",
  "browser-busy": "navegador deste projeto em uso",
  "proxy-unavailable": "rota autenticada indisponível",
  "inventory-unavailable": "inventário indisponível",
}

export type AcaoDaExcecao =
  | { tipo: "ligar-navegador"; rotulo: string }
  | { tipo: "configuracoes"; rotulo: string; secao: string }

export interface ExcecaoDoTurno {
  id: string
  /** "atencao" pede olho (fora da Frota, algo não entrou); "info" só avisa. */
  tom: "atencao" | "info"
  texto: string
  detalhe: string | null
  acao: AcaoDaExcecao | null
}

const CONFIGURAR_MCP: AcaoDaExcecao = { tipo: "configuracoes", rotulo: "Configurar", secao: "integrations" }

function acaoDaOmissao(code: McpPlanIssueCode): AcaoDaExcecao | null {
  if (code === "browser-offline") return { tipo: "ligar-navegador", rotulo: "Ligar" }
  if (code === "source-missing" || code === "incompatible" || code === "health-unavailable") return CONFIGURAR_MCP
  return null
}

const nomes = (lista: string[]) => lista.join(", ")

/** As exceções do turno, na ordem do mock. Lista vazia = nada a mostrar.
 *  `motor` é o nome humano do motor da conversa. Puro. */
export function excecoesDoTurno(m: EffectiveRunManifest | undefined, motor: string): ExcecaoDoTurno[] {
  if (!m) return []
  const excecoes: ExcecaoDoTurno[] = []
  if (m.externalBrowserMcps?.length) {
    excecoes.push({
      id: "navegador-de-terceiro",
      tom: "atencao",
      texto: `Este turno pode abrir um navegador fora da Frota, pelo ${nomes(m.externalBrowserMcps)}.`,
      detalhe: `Está configurado no ${motor}. Vincule ao navegador da Frota em Configurações, ou desative no CLI.`,
      acao: CONFIGURAR_MCP,
    })
  }
  if (m.externalDesktopMcps?.length) {
    excecoes.push({
      id: "computador-de-terceiro",
      tom: "atencao",
      texto: `Este turno pode controlar o computador fora da Frota, pelo ${nomes(m.externalDesktopMcps)}.`,
      detalhe: "Sem pedido na tela e sem Revogar. Desative em Configurações › Navegador e desktop › Controle do desktop.",
      acao: { tipo: "configuracoes", rotulo: "Configurar", secao: "resources" },
    })
  }
  for (const o of m.omissions ?? []) {
    excecoes.push({
      id: `fora:${o.sourceId}:${o.code}`,
      tom: "atencao",
      texto: `${o.sourceLabel} não entrou neste turno.`,
      detalhe: `${MOTIVO_DA_OMISSAO[o.code]}.`.replace(/^./, (c) => c.toUpperCase()),
      acao: acaoDaOmissao(o.code),
    })
  }
  if (m.permissionOverride === "leitura") {
    excecoes.push({
      id: "so-leitura",
      tom: "info",
      texto: "Só lê neste turno.",
      detalhe: "A permissão foi reduzida só para este envio.",
      acao: null,
    })
  }
  return excecoes
}
