// A supressão do menu do MOTOR (ADR-042).
//
// Medido nesta máquina em 14/08/2026, com uma sonda em Swift que sobe um
// WKWebView de verdade e loga `willOpenMenu` (só dispara quando o WebKit
// decidiu abrir menu nativo):
//
//   div comum, sem preventDefault ................ MENU NATIVO ["Reload", …]
//   body{user-select:none}, sem preventDefault .... MENU NATIVO ["Reload", …]   ← o print do usuário
//   div comum, COM preventDefault ................. sem menu nativo
//   textarea focado, sem preventDefault ........... MENU NATIVO com 28 itens
//                                                   (Cut/Copy/Paste, mas junto
//                                                   com "Search with Google",
//                                                   "Show Writing Tools",
//                                                   "Paragraph Direction"…)
//   textarea focado, COM preventDefault ........... sem menu nativo
//   input[type=password], COM preventDefault ...... sem menu nativo
//
// Ou seja: `preventDefault()` no evento `contextmenu` é suficiente e é o ÚNICO
// caminho portátil. O wry só expõe interruptor nativo pro WebView2 do Windows
// (`with_default_context_menus`, `wry/src/webview2/mod.rs:571`); macOS e Linux
// não têm API equivalente, e os dois rodam WebKit, onde o mesmo
// `ContextMenuController` do WebCore desiste quando o evento do DOM foi
// cancelado. A técnica é uma só nas duas plataformas.
//
// O ouvinte fica na fase de BOLHA, no `document`, de propósito: na captura ele
// rodaria ANTES do Radix, e o `composeEventHandlers` do Radix pula o próprio
// handler quando o evento já vem com `defaultPrevented` — ou seja, capturar
// mataria os menus de contexto que já existem (sidebar, onboarding). Na bolha
// a ordem certa cai sozinha: quem é nosso assume primeiro, e o que sobrar sem
// dono é o que o motor ia sequestrar.

export type GuardaOpts = {
  /**
   * Em build de desenvolvimento, Shift+botão direito devolve o menu do motor
   * (é por lá que se chega em "Inspecionar elemento"). Fora de dev não existe
   * escape: o menu do motor nunca aparece pro usuário final.
   */
  dev: boolean
  /**
   * Chamado quando o clique ficou SEM dono, logo depois de suprimir o nativo.
   * É a vez do menu do app. Opcional: a janela da tray só suprime.
   */
  aoAssumir?: (e: MouseEvent) => void
  /**
   * "Este alvo é NOSSO mesmo que um ancestral tenha menu próprio."
   *
   * Existe por um buraco real: o campo de renomear da sidebar mora DENTRO da
   * linha da conversa, que é um trigger de menu do Radix. Sem isto, o botão
   * direito no campo de texto abre "Renomear · Duplicar · Excluir" em vez de
   * Cortar/Copiar/Colar. Campo de texto ganha de menu de container, sempre:
   * ali o botão direito tem função de sistema a cumprir e é memória muscular.
   */
  prioritario?: (e: MouseEvent) => boolean
}

/** Instala a guarda. Devolve o desfazedor (pro cleanup do efeito). */
export function instalarGuardaDoMenuNativo(opts: GuardaOpts): () => void {
  const { dev, aoAssumir, prioritario } = opts

  const naCaptura = (e: MouseEvent) => {
    // Saída de dev: parar a propagação aqui é o único jeito de garantir que
    // ninguém (nem o Radix da sidebar) chame `preventDefault` depois. Sem
    // isso, o Shift abriria o nosso menu por cima do que se queria inspecionar.
    if (dev && e.shiftKey) {
      e.stopPropagation()
      return
    }
    // Alvo prioritário (campo de texto): assume ANTES de qualquer trigger de
    // superfície ver o evento, senão o menu do container sequestra o clique.
    if (prioritario?.(e)) {
      e.stopPropagation()
      e.preventDefault()
      aoAssumir?.(e)
    }
  }

  const naBolha = (e: MouseEvent) => {
    // Um menu NOSSO (Radix) já assumiu este clique: o nativo já morreu junto,
    // e abrir outro por cima seria menu duplo.
    if (e.defaultPrevented) return
    // O motor não fala pelo app.
    e.preventDefault()
    aoAssumir?.(e)
  }

  document.addEventListener("contextmenu", naCaptura, true)
  document.addEventListener("contextmenu", naBolha)

  return () => {
    document.removeEventListener("contextmenu", naCaptura, true)
    document.removeEventListener("contextmenu", naBolha)
  }
}
