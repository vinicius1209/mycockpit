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
import { AGENTS, agentDef } from "@/lib/agents"
import { isTauri } from "@/lib/db"
import { PERMISSIVIDADE, type SessionMode } from "@/lib/sessionMode"

/** `motor` entrou em 11/09/2026 com a rota B: o selo deixou de ser fato da
 *  MÁQUINA e virou máquina × motor. Sem ele o card diria "parcial" (barra
 *  escrita no projeto) sobre um motor que barra o disco inteiro — subestimar a
 *  proteção mente tanto quanto exagerá-la. */
export type Selo = "ausente" | "parcial" | "motor"

export interface Confinamento {
  selo: Selo
  /** Frase curta pro seletor. Vazia quando ausente: quem não garante nada não
   *  ganha linha na tela. */
  nota: string
}

/**
 * Este motor dispensa o envelope `sandbox-exec` da Frota?
 *
 * Derivado do REGISTRY (espelho de `SandboxProprio::dispensa_envelope`), nunca
 * de comparação de nome. Motor desconhecido responde `false`: dispensar por
 * engano deixa o turno SEM confinamento nenhum, que é pior que um envelope a
 * mais. Par no Rust: `sandbox.rs::confina`.
 */
export function dispensaEnvelopeDaFrota(
  agent: string | null | undefined,
): boolean {
  if (!agent) return false
  return agentDef(agent)?.sandboxProprio === "sistemaOperacional"
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
  if (!ganhaSelo(canonico)) return notaDoMotor
  // O motor que confina sozinho é garantia de SISTEMA também, e mais apertada
  // que a nossa. Ela não é "parcial": chamar assim descreveria a denylist, que
  // neste turno nem foi aplicada (e não poderia — os dois perfis colidem).
  if (confinamento.selo === "motor") {
    return `confinamento do motor: ${confinamento.nota}`
  }
  if (confinamento.selo === "parcial") {
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
  // Os DOIS selos que garantem contam como sandbox, e a nota de cada um diz o
  // que ele barra. Deliberadamente NÃO afirmamos nada novo sobre os modos de
  // escrita quando o selo é `motor`: o Codex confina em `workspace-write`
  // também (escrita presa ao projeto, rede off), mas descrever isso é outra
  // linha de produto — e a frase de hoje ("o modo escreve") continua verdadeira.
  const temSandbox = c.selo === "parcial" || c.selo === "motor"
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

/** Cache POR MOTOR, e não um valor só: desde a rota B a resposta depende de
 *  quem roda (o motor que confina sozinho não recebe o envelope). Um cache
 *  único devolveria o selo do primeiro motor consultado para todos. */
const cache = new Map<string, Confinamento>()

/** Lê uma vez por sessão e por motor: a resposta depende da máquina e de quem
 *  roda, não do turno. `agent` ausente = pergunta só da máquina (fail-closed no
 *  Rust: cai em `Nenhum`, o mais conservador). */
export async function lerConfinamento(
  agent?: string | null,
): Promise<Confinamento> {
  const chave = agent ?? ""
  const guardado = cache.get(chave)
  if (guardado) return guardado
  if (!isTauri()) return SEM_CONFINAMENTO
  try {
    const v = await invoke<Confinamento>("sandbox_confinamento", {
      agent: agent ?? null,
    })
    cache.set(chave, v)
    return v
  } catch {
    // Fail-closed: não conseguir perguntar NÃO vira "tem sandbox". Um selo
    // otimista é exatamente o defeito que este módulo existe pra impedir.
    return SEM_CONFINAMENTO
  }
}

/** (testes) zera o cache por motor. */
export function _resetConfinamento(): void {
  cache.clear()
}

/**
 * Motores cujo confinamento é do PRÓPRIO motor, por rótulo.
 *
 * Existe pro quadro de confinamento não implicar que cobre todo mundo: as
 * linhas dele descrevem o envelope da Frota, e quem está nesta lista não passa
 * por ele (nem poderia — os dois perfis Seatbelt colidem). Derivado do
 * registry, então motor novo aparece sozinho.
 */
export function motoresComSandboxProprio(): string[] {
  // Pelo predicado, não pela string: duas cópias de
  // `=== "sistemaOperacional"` divergiriam no dia em que o eixo ganhar um
  // quarto valor, e a tela passaria a listar motor que ainda é envelopado.
  return AGENTS.filter((a) => dispensaEnvelopeDaFrota(a.id)).map((a) => a.label)
}
