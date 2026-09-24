// O teclado das abas de arquivo (ADR-243). Mapa puro de tecla → gesto, para
// travar em teste sem montar React; quem executa é `abasNoPrincipal.ts`.
//
// ⌘W não passa por aqui no macOS: lá o menu nativo pega o atalho antes da
// página e o repassa como `frota://fechar-aba` (`src-tauri/src/menu_da_janela.rs`).
// No Linux não há menu, e o Ctrl+W chega como tecla.

export type AcaoDoAtalho =
  | { tipo: "posicao"; n: number }
  | { tipo: "alternar"; passo: 1 | -1 }
  | { tipo: "fechar" }
  | { tipo: "reabrir" }

export interface TeclaDoAtalho {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function ehApple(plataforma: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(plataforma)
}

/** O gesto de uma tecla, ou `null` se ela não é das abas. Puro. */
export function acaoDoAtalho(e: TeclaDoAtalho, plataforma: string): AcaoDoAtalho | null {
  if (e.altKey) return null
  // ⌃Tab é igual nas duas plataformas, como nos navegadores.
  if (e.ctrlKey && !e.metaKey && e.key === "Tab") return { tipo: "alternar", passo: e.shiftKey ? -1 : 1 }
  const apple = ehApple(plataforma)
  const mod = apple ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod) return null
  const digito = /^Digit([1-9])$/.exec(e.code)
  if (digito && !e.shiftKey) return { tipo: "posicao", n: Number(digito[1]) }
  if (e.code === "KeyT" && e.shiftKey) return { tipo: "reabrir" }
  if (e.code === "KeyW" && !e.shiftKey && !apple) return { tipo: "fechar" }
  return null
}

/** O rótulo do atalho no menu, na convenção da plataforma. */
export function rotuloDoAtalho(teclas: "fechar" | "reabrir" | number, plataforma: string): string {
  const apple = ehApple(plataforma)
  const tecla = teclas === "fechar" ? "W" : teclas === "reabrir" ? "T" : String(teclas)
  const shift = teclas === "reabrir"
  if (apple) return `${shift ? "⌘⇧" : "⌘"}${tecla}`
  return `Ctrl ${shift ? "Shift " : ""}${tecla}`
}
