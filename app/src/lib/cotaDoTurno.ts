import type { PhaseResult } from "@/lib/mission"
// De QUAL cota um turno consome — e por que a resposta não é "o agent".
//
// ── O QUE MUDA COM O 4º MOTOR ──────────────────────────────────────────────
// Até o OpenCode, a conta era simples: cada motor tinha um dono de cota, e
// trocar de motor era trocar de cota. O card de recuperação podia dizer
// "escolha outro agent" e estar certo por construção.
//
// O OpenCode quebra isso, e para melhor: ele alcança VÁRIOS provedores. Só que
// alguns são os MESMOS que os outros motores já usam — `opencode` com um modelo
// `openai/*` consome a assinatura do ChatGPT, a mesma do Codex. Trocar do Codex
// para lá num rate limit não resolveria nada, e o app teria mandado o usuário
// bater na mesma porta.
//
// Por isso a pergunta certa não é "qual agent?", é "qual PROVEDOR paga?".
//
// ── O QUE ISTO NÃO SABE ────────────────────────────────────────────────────
// Se dois provedores distintos cobram da mesma conta (BYOK apontando pro mesmo
// lugar), isto não tem como saber. "Provedor diferente" é o melhor palpite
// disponível, não garantia — e a copy diz "provavelmente", nunca "vai
// funcionar".

/** O provedor que paga por um turno. `null` = não sei (motor desconhecido, ou
 *  OpenCode com o modelo no default, onde quem escolhe é o config dele). */
export function provedorDaCota(agent: string, model: string | null): string | null {
  switch (agent) {
    case "claude-code":
    case "":
      return "anthropic"
    case "codex":
      return "openai"
    case "agy":
      return "google"
    case "opencode": {
      // O dialeto é `provider/model`. Sem modelo escolhido, quem decide é o
      // config do próprio OpenCode: não dá pra afirmar de onde vai sair.
      const p = (model ?? "").split("/")[0]?.trim()
      return p && p !== "default" ? p : null
    }
    default:
      return null
  }
}

/** Dois turnos brigam pela MESMA cota?
 *
 *  `false` quando não sei de um dos lados: o card oferece a troca e a copy
 *  admite a incerteza. Bloquear por ignorância seria pior — o usuário fica sem
 *  saída num limite que talvez nem existisse do outro lado. */
export function competemPelaMesmaCota(
  a: { agent: string; model: string | null },
  b: { agent: string; model: string | null },
): boolean {
  const pa = provedorDaCota(a.agent, a.model)
  const pb = provedorDaCota(b.agent, b.model)
  return pa !== null && pb !== null && pa === pb
}

/** Mensagem humana do card de recuperação
 *
 *  Mora AQUI e não em `lib/mission` porque a frase passou a depender da regra
 *  de cota acima: dizer "escolha outro agent" sem saber de qual provedor foi
 *  virou conselho incompleto quando o OpenCode entrou.: explica a pausa e o que fazer. O
 *  sinal FORTE (limit) e o heurístico têm textos levemente diferentes.
 *  `deQuem` nomeia a COTA que estourou: com o OpenCode no roster, "outro agent"
 *  parou de significar "outra cota" (ver `lib/cotaDoTurno`). */
export function recoveryMessage(
  result: PhaseResult,
  deQuem?: { agent: string; model: string | null },
): string {
  const hitLimit = result.items.some((it) => it.kind === "limit")
  const base = hitLimit
    ? "A fase bateu num limite de uso do agent."
    : "A fase parou por limite de uso, espera ou crédito."
  const provedor = deQuem ? provedorDaCota(deQuem.agent, deQuem.model) : null
  const alerta = provedor ? ` A cota que estourou é a do ${provedor}: outro motor no mesmo provedor bate na mesma porta.` : ""
  return `${base}${alerta} Escolha outro agent/modelo para retomar de onde parou (o worktree e o handoff já estão prontos).`
}
