// CURADORIA dos modos de sessão (docs/modos-de-sessao-plan.md, M1).
//
// A sonda (`src-tauri/src/modes.rs`) diz QUAIS ids cada motor anuncia. Este
// arquivo diz o que a gente SABE EXPLICAR sobre eles — e a distinção é de
// segurança, não de organização: descoberta dá o nome, não o risco. Oferecer
// `dontAsk` porque o `--help` do Claude o cita, sem saber o quanto ele libera,
// é fail-open com nome bonito.
//
// A regra que cai daqui:
//
//   descoberto ∩ curado  → oferecível
//   descoberto \ curado  → AVISO ("o motor tem modo que não sabemos explicar")
//   curado \ descoberto  → AVISO ("o motor não anuncia mais este modo")
//
// O segundo aviso é o que faltava. A lista era estática e envelheceu em
// silêncio nos três motores; o `manual` e o `dontAsk` do Claude estão aqui
// justamente COMO não-curados, pra que a ignorância seja visível em vez de
// invisível.

import { invoke } from "@tauri-apps/api/core"

/** O que a sonda devolve (src-tauri/src/modes.rs). */
export interface DetectedModes {
  agent: string
  ids: string[]
  /** `false` = não deu pra ler. Diferente de "não tem modo" — confundir os dois
   *  faria a UI esconder o seletor achando que o motor não tem modos. */
  known: boolean
}

/** Pergunta ao binário quais modos ele aceita. Dono: store/agentModes. */
export async function detectModes(agent: string): Promise<DetectedModes> {
  return invoke<DetectedModes>("detect_modes", { agent })
}

/** O que o app manda pro motor quando você escolhe este modo. */
export interface AgentModeDef {
  /** Id EXATO que vai na flag (`--permission-mode plan`, `-s read-only`…). */
  id: string
  label: string
  description: string
  /** Como o motor SEGURA isto. É a diferença que hoje some na UI: escolher
   *  "planejar" no Codex é sandbox de SO; no agy é um pedido no prompt. */
  enforcement: "sandbox" | "flag" | "prompt"
  /** Escreve sem pedir aprovação (o `isUnattended` do Paseo). */
  unattended?: boolean
  /** É o modo de PLANEJAR — o que arma o gate de plano no fim do turno. */
  planning?: boolean
}

export interface ModeCuration {
  /** Ids que o app MANDA. Vazio não é "o motor não tem modo": é "o app não usa
   *  os que ele tem" — e a `nota` explica. */
  defs: AgentModeDef[]
  nota?: string
}

/**
 * O que o app sabe explicar, por motor. Cada entrada espelha o que o
 * `adapters.rs` REALMENTE faz hoje — não o que seria bonito.
 */
export const MODOS_CURADOS: Record<string, ModeCuration> = {
  "claude-code": {
    defs: [
      {
        id: "plan",
        label: "Planejar",
        description: "Analisa e propõe um plano; não escreve nem executa",
        enforcement: "flag",
        planning: true,
      },
      {
        id: "acceptEdits",
        label: "Pede",
        description: "Aceita edições e pergunta o resto pelo gate do app",
        enforcement: "flag",
      },
      {
        id: "auto",
        label: "Auto",
        description: "Age sem perguntar, com o classificador de segurança da CLI",
        enforcement: "flag",
        unattended: true,
      },
      {
        id: "bypassPermissions",
        label: "Liberado",
        description: "Age sem perguntar e sem freio",
        enforcement: "flag",
        unattended: true,
      },
    ],
    // `manual` e `dontAsk` (claude 2.1.220) ficam DE FORA de propósito: o app
    // nunca os mandou e ninguém aqui validou o que eles liberam. Eles aparecem
    // como aviso — é o caso que prova a mecânica.
  },
  codex: {
    defs: [
      {
        id: "read-only",
        label: "Só lê",
        description: "Sandbox do sistema operacional bloqueia qualquer escrita",
        enforcement: "sandbox",
        planning: true,
      },
      {
        id: "workspace-write",
        label: "Pede",
        description: "Escreve dentro do projeto; o sandbox confina o resto",
        enforcement: "sandbox",
      },
      {
        id: "danger-full-access",
        label: "Liberado",
        description: "Sem sandbox: acesso total à máquina",
        enforcement: "sandbox",
        unattended: true,
      },
    ],
  },
  agy: {
    defs: [],
    nota:
      "O agy anuncia `--mode`, mas o app não manda a flag: hoje ele emula o " +
      "planejamento por prefixo de prompt (adapters.rs) porque num teste de " +
      "julho/2026 o `--mode plan` não segurava a escrita. O binário mudou " +
      "desde então; revalidar antes de adotar.",
  },
}

/** Só o que dá pra OFERECER: o motor anuncia E a gente sabe explicar. */
export function modosOferecidos(
  agent: string,
  descobertos: readonly string[],
): AgentModeDef[] {
  const curados = MODOS_CURADOS[agent]?.defs ?? []
  return curados.filter((d) => descobertos.includes(d.id))
}

export interface ModeDrift {
  /** O motor anuncia e a gente não sabe explicar (não vira opção). */
  novos: string[]
  /** A gente manda e o motor não anuncia mais (vai falhar no próximo turno). */
  sumidos: string[]
}

/**
 * A diferença entre o que o motor diz e o que a gente sabe.
 *
 * Os dois lados importam, e o segundo é o mais urgente: um id que sumiu do
 * `--help` continua sendo enviado até alguém reparar, e aí o erro chega como
 * falha de turno em vez de aviso.
 *
 * `descobertos` vazio quando a sonda não leu (`known: false`) NÃO é ausência —
 * quem chama passa `null` e recebe drift vazio, porque acusar "sumiram todos"
 * por não ter conseguido perguntar seria pior que ficar calado.
 */
export function driftDeModos(
  agent: string,
  descobertos: readonly string[] | null,
): ModeDrift {
  if (!descobertos) return { novos: [], sumidos: [] }
  const curados = MODOS_CURADOS[agent]?.defs.map((d) => d.id) ?? []
  return {
    novos: descobertos.filter((id) => !curados.includes(id)),
    sumidos: curados.filter((id) => !descobertos.includes(id)),
  }
}

/** Frase do aviso, ou `null` quando não há nada a dizer. */
export function frasesDoDrift(agent: string, drift: ModeDrift): string[] {
  const out: string[] = []
  if (drift.sumidos.length > 0) {
    out.push(
      `${agent}: o app ainda manda ${drift.sumidos.join(", ")}, que o motor não anuncia mais.`,
    )
  }
  if (drift.novos.length > 0) {
    const nota = MODOS_CURADOS[agent]?.nota
    out.push(
      `${agent}: o motor tem ${drift.novos.join(", ")} e o Frota ainda não sabe explicar.` +
        (nota ? ` ${nota}` : ""),
    )
  }
  return out
}
