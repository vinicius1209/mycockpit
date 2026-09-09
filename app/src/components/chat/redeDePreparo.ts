// A REDE DE SEGURANÇA DO PREPARO (ADR-169).
//
// Desde a ADR-169 o `beginPreparation` acontece CEDO, antes dos `await` que
// montam o prompt. É isso que dá à tela algo pra mostrar durante o preflight
// (sem carimbo não há de onde derivar sinal, e espera com tela imóvel lê como
// travamento). Mas o carimbo cedo cria uma dívida: se qualquer um desses
// `await` estourar, ele fica aceso pra sempre e a conversa trava, com o composer
// desabilitado e "Verificando capacidades…" eterno.
//
// A dívida NÃO se paga auditando cada chamada do preparo. Isso vale hoje e deixa
// de valer no primeiro commit que adicionar uma chamada nova; a garantia tem que
// ser estrutural. Por isso o despacho inteiro passa por aqui.
//
// A varredura por conversa é intencional: `clearPreparation` já ignora quem não
// está preparando ESTE run, então o laço acerta a conversa certa sem que a rede
// precise saber qual é, e sem uma segunda API na store só pra isso. São dezenas
// de conversas, não milhares.

/** O mínimo que a rede precisa da store. Interface e não import direto porque é
 *  o que deixa o comportamento testável sem montar o chat inteiro. */
export interface EstadoDoPreparo {
  /** Ids de todas as conversas conhecidas. */
  conversas: () => string[]
  /** Apaga o carimbo, se e somente se aquela conversa prepara ESTE run. */
  limpar: (convId: string, runId: string) => void
}

/**
 * Roda o despacho e garante que nenhum carimbo de preparo sobreviva a uma
 * exceção. Devolve `true` quando passou limpo, `false` quando a rede pegou algo
 * — quem chama decide o que dizer à pessoa.
 *
 * Não engole o erro em silêncio: registra no console antes de devolver `false`.
 * A regra da casa é que nenhum `catch` fique mudo onde alguém espera resultado,
 * e quem apertou Enter está esperando.
 */
export async function comRedeDePreparo(
  runId: string,
  estado: EstadoDoPreparo,
  despachar: (runId: string) => Promise<void>,
): Promise<boolean> {
  try {
    await despachar(runId)
    return true
  } catch (e) {
    for (const convId of estado.conversas()) estado.limpar(convId, runId)
    console.error("[envio] o preparo do turno estourou", e)
    return false
  }
}
