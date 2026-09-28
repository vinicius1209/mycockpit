/** Id de item e de conversa. Módulo próprio para o redutor não importar o
 *  store inteiro em tempo de execução. */
export function uid(): string {
  return crypto.randomUUID()
}
