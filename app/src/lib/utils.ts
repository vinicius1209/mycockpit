import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Abrevia o $HOME do usuário para "~" em caminhos exibidos. */
export function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~")
}

/**
 * Abrevia caminho longo para exibição, elidindo o MEIO.
 *
 * Por que não basta o `truncate` do CSS, que já está no container: ele corta
 * pela direita, e num caminho é a direita que identifica. `~/projetos/…` não
 * diz nada; `…/acme/frontend` diz tudo. Aqui os dois trabalham juntos — este
 * escolhe O QUE preservar, o CSS resolve a largura real que nenhuma contagem
 * de caractere consegue prever.
 *
 * A regra que desenha a função: **preservar o que DISTINGUE**. Uma versão
 * anterior guardava só o último segmento, e com isso
 * `~/projetos/clientes/acme/apps/web` e `~/projetos/pessoal/blog/apps/web`
 * viravam os dois `~/…/web` — dois diretórios diferentes lidos igual, numa
 * lista cuja função é justamente dizer quais diretórios estão liberados. Por
 * isso a cauda CRESCE enquanto couber, em vez de parar no primeiro segmento.
 */
export function formatDisplayPath(p: string, maxLength = 34): string {
  const s = shortPath(p)
  if (s.length <= maxLength) return s
  const partes = s.split("/").filter(Boolean)
  if (partes.length <= 2) return s // não há meio pra elidir
  // Caminho relativo NÃO ganha barra na frente: inventar "/" transformaria
  // "projetos/x" num caminho absoluto que não existe.
  const raiz = s.startsWith("/") ? `/${partes[0]}` : partes[0]
  let cauda = partes[partes.length - 1]
  for (let i = partes.length - 2; i >= 1; i--) {
    const maior = `${partes[i]}/${cauda}`
    if (`${raiz}/…/${maior}`.length > maxLength) break
    cauda = maior
  }
  // Devolve o elidido MESMO se ainda passar do limite (segmento final enorme).
  // A versão anterior desistia e devolvia o caminho inteiro — encurtava o
  // caminho médio e não encurtava o longo, que é a regra ao contrário.
  return `${raiz}/…/${cauda}`
}
