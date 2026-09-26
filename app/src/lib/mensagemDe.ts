// A mensagem de uma falha que veio do backend ou de um `catch`, legível.
// Puro e sem dependência: mora fora de `lib/avisos` para os testes poderem
// trocar a porta inteira sem puxar os stores (ADR-261).

/** A mensagem de uma falha que veio do backend ou de um `catch`. */
export function mensagemDe(causa: unknown): string {
  if (causa instanceof Error) return causa.message
  if (typeof causa === "string") return causa
  try {
    return JSON.stringify(causa)
  } catch {
    return String(causa)
  }
}

