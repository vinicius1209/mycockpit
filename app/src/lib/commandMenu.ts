// Ponte entre quem PEDE a paleta ⌘K (o chip de busca da barra do topo, o nome
// do projeto) e quem a HOSPEDA (CommandMenu, dono do próprio `open`). É um
// pub/sub de módulo, não um store: a paleta já é única na árvore e o estado
// dela não persiste. Nada de busca nova aqui, só o mesmo ⌘K por outro gesto.

type Listener = () => void

const listeners = new Set<Listener>()

/** Registra o dono da paleta. Devolve o cancelamento (padrão useEffect). */
export function onOpenCommandMenu(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Pede a abertura da paleta. Sem ninguém ouvindo (paleta desmontada), avisa
 *  no console: o clique não pode sumir calado (ADR-017). */
export function openCommandMenu(): void {
  if (listeners.size === 0) {
    console.warn("[cmdk] pediram a paleta, mas nenhuma está montada")
    return
  }
  // cópia: um ouvinte que se desinscreve durante o disparo não corrompe a
  // iteração do Set.
  for (const fn of [...listeners]) fn()
}

/** Só para os testes: zera os ouvintes entre casos. */
export function _resetCommandMenuListeners(): void {
  listeners.clear()
}

/** Teclas do atalho, na ordem em que aparecem no chip. macOS usa ⌘; o resto
 *  (Linux/Windows, onde o app também roda) usa Ctrl — o listener do CommandMenu
 *  aceita metaKey OU ctrlKey, então o rótulo segue a plataforma sem mentir. */
export function commandMenuKeys(platform: string): readonly [string, string] {
  const apple = /mac|iphone|ipad|ipod/i.test(platform)
  return apple ? ["⌘", "K"] : ["Ctrl", "K"]
}

/** Atalho como aparece na tecla desenhada do chip: "⌘K" no macOS, "Ctrl K"
 *  fora dele (o modificador escrito precisa do espaço para ser legível). */
export function commandMenuShortcut(platform: string): string {
  const [mod, key] = commandMenuKeys(platform)
  return mod.length === 1 ? `${mod}${key}` : `${mod} ${key}`
}

/** Plataforma corrente (string vazia fora do browser → cai no rótulo Ctrl). */
export function currentPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent
}
