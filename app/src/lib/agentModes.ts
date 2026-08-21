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
import type { SessionMode } from "@/lib/sessionMode"
import type { PermissionMode } from "@/lib/types"

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
  /** Id da opção. Quando o app REPASSA (claude, codex), é o valor exato da
   *  flag; quando ele EMULA (agy), é o nosso nome canônico. */
  id: string
  /** O que o motor precisa ANUNCIAR pra esta opção ser oferecida. Ausente = o
   *  app emula, então a sonda não tem o que confirmar — filtrar por descoberta
   *  aqui apagaria o controle inteiro do agy. */
  probeId?: string
  /** A PONTE pro eixo canônico (lib/sessionMode). É o que deixa a UI falar em
   *  ids do motor sem que o caminho de enforcement mude: o envio continua indo
   *  como `permission` + `plan_first`, que é o contrato que o Rust já valida.
   *  Explícito e testável de propósito — derivar por nome seria adivinhar no
   *  eixo onde adivinhar não dá sintoma. */
  canonico: SessionMode
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
        probeId: "plan",
        canonico: "plan" as const,
        label: "Planejar",
        description: "Analisa e propõe um plano; não escreve nem executa",
        enforcement: "flag",
        planning: true,
      },
      {
        // EMULADO: o Claude não tem `--permission-mode` de só-leitura. O app
        // monta com `--disallowedTools Bash,Edit,Write,MultiEdit,NotebookEdit`
        // (adapters.rs). Sem `probeId` de propósito — a sonda não confirma o
        // que o app faz por fora da flag, e filtrar por descoberta aqui teria
        // apagado o "Só lê" do Claude, que existe desde sempre.
        id: "leitura",
        canonico: "leitura",
        label: "Só lê",
        description: "As ferramentas de escrita ficam bloqueadas",
        enforcement: "flag",
      },
      {
        id: "acceptEdits",
        probeId: "acceptEdits",
        canonico: "padrao" as const,
        label: "Pede",
        description: "Aceita edições e pergunta o resto pelo gate do app",
        enforcement: "flag",
      },
      {
        id: "auto",
        probeId: "auto",
        canonico: "auto" as const,
        label: "Auto",
        description: "Age sem perguntar, com o classificador de segurança da CLI",
        enforcement: "flag",
        unattended: true,
      },
      {
        id: "bypassPermissions",
        probeId: "bypassPermissions",
        canonico: "liberado" as const,
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
        probeId: "read-only",
        canonico: "leitura" as const,
        label: "Só lê",
        description: "Sandbox do sistema operacional bloqueia qualquer escrita",
        enforcement: "sandbox",
        planning: true,
      },
      {
        id: "workspace-write",
        probeId: "workspace-write",
        canonico: "padrao" as const,
        label: "Pede",
        description: "Escreve dentro do projeto; o sandbox confina o resto",
        enforcement: "sandbox",
      },
      {
        id: "danger-full-access",
        probeId: "danger-full-access",
        canonico: "liberado" as const,
        label: "Liberado",
        description: "Sem sandbox: acesso total à máquina",
        enforcement: "sandbox",
        unattended: true,
      },
    ],
  },
  // O agy é o caso EMULADO: o app não manda `--mode`, ele monta o
  // comportamento com prefixo de prompt + `--sandbox` +
  // `--dangerously-skip-permissions`. Por isso nenhuma opção tem `probeId` — o
  // que o binário anuncia não confirma nem desmente o que o app faz.
  agy: {
    defs: [
      {
        id: "plan",
        canonico: "plan",
        label: "Planejar",
        description: "Pede um plano e nada de escrita; o motor não garante",
        // A palavra honesta: aqui é PEDIDO, não trava. É a diferença que sumia
        // quando "Planejar" era o mesmo botão nos três motores.
        enforcement: "prompt",
        planning: true,
      },
      {
        id: "leitura",
        canonico: "leitura",
        label: "Só lê",
        description: "Sandbox do agy, sem escrita liberada",
        enforcement: "sandbox",
      },
      {
        id: "padrao",
        canonico: "padrao",
        label: "Pede",
        description: "Pergunta antes de agir, pelo gate do app",
        enforcement: "flag",
      },
      {
        id: "liberado",
        canonico: "liberado",
        label: "Liberado",
        description: "Age sem perguntar",
        enforcement: "flag",
        unattended: true,
      },
    ],
    nota:
      "O agy anuncia `--mode`, mas o app não manda a flag: hoje ele emula o " +
      "planejamento por prefixo de prompt (adapters.rs) porque num teste de " +
      "julho/2026 o `--mode plan` não segurava a escrita. O binário mudou " +
      "desde então; revalidar antes de adotar.",
  },
}

/**
 * O que dá pra OFERECER: o app sabe explicar E (quando repassa) o motor anuncia.
 *
 * `descobertos: null` = a sonda não respondeu. Aí vale a lista curada INTEIRA,
 * e essa escolha é deliberada: perder o controle de permissão porque um
 * `--help` não parseou seria trocar uma lista desatualizada por nenhuma lista —
 * e sem controle o usuário fica preso no modo que estiver valendo. A curadoria
 * é o que o app já mandava antes da sonda existir, então cair nela não afrouxa
 * nada.
 *
 * Opção sem `probeId` (emulada) nunca é filtrada: não há o que confirmar.
 */
export function modosOferecidos(
  agent: string,
  descobertos: readonly string[] | null,
): AgentModeDef[] {
  const curados = MODOS_CURADOS[agent]?.defs ?? []
  if (!descobertos) return curados
  return curados.filter((d) => !d.probeId || descobertos.includes(d.probeId))
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
  // Só o que o app REPASSA entra no drift: id emulado não existe no motor por
  // definição, e acusá-lo como "sumido" seria alarme por construção.
  const curados = (MODOS_CURADOS[agent]?.defs ?? [])
    .map((d) => d.probeId)
    .filter((id): id is string => !!id)
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

/** O que a conversa manda pro motor. Continua sendo o contrato que o Rust já
 *  valida (`Permission::parse` + `plan_first`) — a UI ganhou vocabulário novo,
 *  o caminho de enforcement não mudou. */
export interface WireDoModo {
  permission: PermissionMode
  planFirst: boolean
}

/**
 * Modo escolhido → o que vai no fio.
 *
 * `plan` é o único que não define permissão sozinho: ele é MODIFICADOR, e o
 * Rust já trata assim (o `--permission-mode` do modo é substituído no turno de
 * plano). Por isso a permissão de base continua sendo a do projeto — mandar
 * `padrao` fixo aqui rebaixaria em silêncio quem trabalha em `leitura`.
 */
export function wireDoModo(
  canonico: SessionMode,
  baseDoProjeto: PermissionMode,
): WireDoModo {
  if (canonico === "plan") return { permission: baseDoProjeto, planFirst: true }
  if (canonico === "fusionRo") return { permission: "leitura", planFirst: false }
  return { permission: canonico, planFirst: false }
}

/**
 * O caminho inverso: o que está valendo AGORA, pra o controle mostrar. Espelha
 * `modeFromConversation` — plano vence permissão, igual ao motor.
 */
export function modoEfetivo(
  permission: PermissionMode,
  planFirst: boolean,
): SessionMode {
  return planFirst ? "plan" : permission
}
