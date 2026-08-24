// O SELO do confinamento (S4 do docs/sandbox-plan.md).
//
// Existe porque a alternativa é a tela prometer o que a denylist não entrega.
// O `ModeSelect` já diz "sandbox do sistema" para o Codex; se o Frota passasse
// a dizer a mesma coisa sem qualificar, estaria repetindo com a nossa
// assinatura o problema que veio consertar — rótulo que soa garantia e não é.
//
// A palavra é "parcial" e ela é EXATA: a política é denylist (medida na fase 0,
// porque allowlist quebrava 2 de 3 motores, um deles em silêncio), então o
// sistema barra escrita no PROJETO e não no resto do disco. Chamar isso de
// "completa" seria a mentira confortável.

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"
import { PERMISSIVIDADE, type SessionMode } from "@/lib/sessionMode"

export type Selo = "ausente" | "parcial"

export interface Confinamento {
  selo: Selo
  /** Frase curta pro seletor. Vazia quando ausente: quem não garante nada não
   *  ganha linha na tela. */
  nota: string
}

/** Fora do Tauri (teste, SSR) não há sandbox — e fingir que há seria pior que
 *  não ter, porque o selo é justamente sobre não prometer demais. */
export const SEM_CONFINAMENTO: Confinamento = { selo: "ausente", nota: "" }

/** Modos em que o Frota PROMETE que o agente não escreve — os únicos que
 *  ganham selo. Espelha o `confina()` do Rust, inclusive o plano: foi o turno
 *  de plano do agy (ADR-061) que motivou o sandbox inteiro. */
export function ganhaSelo(canonico: string): boolean {
  return canonico === "leitura" || canonico === "fusionRo" || canonico === "plan"
}

/**
 * A frase de QUEM SEGURA, decidida fora do JSX.
 *
 * Mora aqui e não inline no componente por um motivo prático: o conteúdo do
 * dropdown não sai no `renderToStaticMarkup` (ele só renderiza aberto), então
 * inline esta regra ficaria sem teste nenhum — e ela é do eixo de segurança,
 * onde "sem sintoma" é o pior lugar pra deixar um erro.
 *
 * O selo VENCE a nota do motor quando existe: aí quem segura passa a ser o
 * sistema, e dizer "modo da CLI" seria descrever o freio antigo enquanto o novo
 * é que está valendo.
 */
export function notaDeQuemSegura(
  canonico: string,
  confinamento: Confinamento,
  notaDoMotor: string,
): string {
  if (confinamento.selo === "parcial" && ganhaSelo(canonico)) {
    return `confinamento parcial: ${confinamento.nota}`
  }
  return notaDoMotor
}

/** Uma linha do quadro de confinamento: um modo do eixo canônico e o que o
 *  SISTEMA garante nele nesta máquina. */
export interface LinhaDeConfinamento {
  modo: SessionMode
  rotulo: string
  confinado: boolean
  /** A frase da linha. Quando `confinado`, o que o sistema barra; quando não,
   *  POR QUE não — e os dois "não" são diferentes (máquina sem sandbox × modo
   *  que escreve por definição). Sem isso, "não confinado" viraria um traço
   *  mudo e o leitor concluiria a causa errada. */
  frase: string
}

/** Rótulos do EIXO CANÔNICO, não do vocabulário de um motor.
 *
 *  Deliberadamente separados dos `label` de `agentModes`: lá o rótulo é o que
 *  aquele CLI chama a opção dele ("Só lê" no claude, "Planejar" no codex), e
 *  aqui a pergunta é sobre a máquina, que não tem motor. Fossem os mesmos, um
 *  motor renomear a opção dele mudaria o texto de uma tela que não fala dele. */
const ROTULO: Record<SessionMode, string> = {
  plan: "Planejar",
  leitura: "Só lê",
  fusionRo: "Fusão (só lê)",
  padrao: "Padrão",
  auto: "Auto",
  liberado: "Liberado",
}

/**
 * O quadro inteiro, uma linha por modo, do menos ao mais permissivo.
 *
 * `confinado` exige as DUAS condições: a máquina ter o sandbox E o modo
 * prometer escrita zero. Separar assim é o ponto — sem a 1ª, um modo que
 * "ganharia selo" apareceria confinado numa máquina que não confina nada.
 */
export function linhasDeConfinamento(c: Confinamento): LinhaDeConfinamento[] {
  const temSandbox = c.selo === "parcial"
  return (Object.keys(ROTULO) as SessionMode[])
    .sort((a, b) => PERMISSIVIDADE[a] - PERMISSIVIDADE[b])
    .map((modo) => {
      const prometeZero = ganhaSelo(modo)
      const confinado = temSandbox && prometeZero
      return {
        modo,
        rotulo: ROTULO[modo],
        confinado,
        frase: confinado
          ? c.nota
          : prometeZero
            ? "sem sandbox nesta máquina: quem segura é o motor"
            : "o modo escreve, então não há escrita pra barrar",
      }
    })
}

/** O resumo do topo. DERIVADO das linhas, nunca um estado à parte: se as
 *  linhas mudarem, o resumo muda junto por construção — é o único jeito de ele
 *  não poder mentir. */
export interface ResumoDoConfinamento {
  temSandbox: boolean
  confinados: number
  total: number
}

export function resumoDoConfinamento(
  linhas: LinhaDeConfinamento[],
): ResumoDoConfinamento {
  return {
    temSandbox: linhas.some((l) => l.confinado),
    confinados: linhas.filter((l) => l.confinado).length,
    total: linhas.length,
  }
}

let cache: Confinamento | null = null

/** Lê uma vez por sessão: a resposta depende da máquina, não do turno. */
export async function lerConfinamento(): Promise<Confinamento> {
  if (cache) return cache
  if (!isTauri()) return SEM_CONFINAMENTO
  try {
    cache = await invoke<Confinamento>("sandbox_confinamento")
    return cache
  } catch {
    // Fail-closed: não conseguir perguntar NÃO vira "tem sandbox". Um selo
    // otimista é exatamente o defeito que este módulo existe pra impedir.
    return SEM_CONFINAMENTO
  }
}
