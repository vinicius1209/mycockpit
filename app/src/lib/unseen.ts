// S1.1 (docs/sidebar-plan.md) — fronteira do "não-visto" pro divisor "novas
// mensagens". Quando uma conversa marcada com finishedUnseen é aberta, o
// divisor entra na fronteira do que chegou sem você ver. Puro e replay-safe:
// deriva SÓ dos items (sem estado paralelo de leitura por mensagem — o app não
// rastreia isso, e fingir precisão seria teatro).

/** O mínimo que o helper precisa de um item do fio (evita importar o store). */
export interface UnseenScanItem {
  id: string
  kind: string
}

/** Id do PRIMEIRO item não-visto: o que vem depois da última mensagem SUA (a
 *  resposta do turno que terminou longe dos seus olhos). Sem mensagem sua no
 *  fio (ex.: conversa de automação), tudo é novo → primeiro item. Fio vazio ou
 *  turno ainda sem resposta → null (não há fronteira a marcar). */
export function unseenBoundary(items: UnseenScanItem[]): string | null {
  if (items.length === 0) return null
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "user") {
      return items[i + 1]?.id ?? null
    }
  }
  return items[0].id
}
