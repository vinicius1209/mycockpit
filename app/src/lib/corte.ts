// A causa de uma interrupção (ADR-180): o GESTO dá a causa, o EVENTO dá o fato.
//
// Nenhum motor diz QUEM parou o turno. O runner só devolve `cancelled`, igual
// para os três transportes (app-server, ACP e o caminho comum), e é isso que
// torna o marco agnóstico: a causa nasce aqui, no gesto humano que pediu o
// corte, e só vira marco no fio se o `cancelled` de fato chegar. Um motor com
// steering nativo, em que o Enter corrige SEM parar o turno, nunca devolve
// `cancelled`, e por isso nunca exibiria "você interrompeu" num turno que seguiu.
//
// Registro de módulo (padrão do watchdog): um carimbo por conversa, consumido
// UMA vez por quem reduz o `cancelled`. Não é persistido: o que persiste é a
// causa gravada no próprio item do fio.

export type CausaDoCorte = "correcao" | "parada" | "disputa"

const pendentes = new Map<string, CausaDoCorte>()

/** O gesto pediu o corte: guarda a causa até o `cancelled` chegar. */
export function marcarCausaDoCorte(convId: string, causa: CausaDoCorte): void {
  pendentes.set(convId, causa)
}

/** Consome a causa carimbada (ou descarta, quando não houve corte). */
export function tomarCausaDoCorte(convId: string): CausaDoCorte | undefined {
  const causa = pendentes.get(convId)
  pendentes.delete(convId)
  return causa
}

/** Reset de módulo para os testes. */
export function limparCausasDoCorte(): void {
  pendentes.clear()
}

/** O que o marco diz. Pretérito (§6) e o verbo canônico do §7: o turno é
 *  INTERROMPIDO ("Parar" é de processo gerenciado). Sem causa
 *  (reconciliação, histórico antigo) o marco não inventa um autor. */
export function rotuloDoCorte(causa: CausaDoCorte | undefined): string {
  switch (causa) {
    case "correcao":
      return "você interrompeu para corrigir"
    case "parada":
      return "você interrompeu o turno"
    case "disputa":
      return "você interrompeu a disputa"
    default:
      return "interrompido"
  }
}
