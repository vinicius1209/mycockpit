// QUEM MANDA NA ABA do painel direito.
//
// Saiu do ContextPanel (que já estava acima do teto e não pode crescer) porque
// é regra, não render: tem estado próprio, uma pergunta de precedência e um
// incidente atrás.
//
// O INCIDENTE (09/09/2026): quem estava no explorador de arquivos perdia a aba
// a cada envio. O painel pulava pra "alteracoes" ao entrar em run e zerava o
// próprio controle quando o turno acabava, então o pulo "uma vez" reacontecia
// no envio seguinte, e no seguinte. A promessa escrita no código era "depois
// disso a sua escolha manda"; o que o código fazia era mandar todo turno.
//
// A REGRA, uma frase: o app SUGERE a aba enquanto você não escolheu nenhuma;
// depois que você escolhe, ele para de mexer. Sugerir é útil (ao entrar em run
// o que interessa é o que o agente mexeu, e quem nunca tocou na barra não tem
// preferência a preservar); mandar é sequestro, porque desfaz um gesto seu sem
// você pedir. A aba Alterações carrega badge de contagem, então o que você
// deixa de ver por não ser arrastado até lá continua anunciado.
//
// Estado de MÓDULO, não `useRef`: o ContextPanel desmonta quando você fecha a
// coluna, e um ref voltaria a `false` ali — fechar e reabrir o painel traria o
// sequestro de volta. Mesmo idioma do "um aviso por episódio" do watchdog.
// Efêmero junto com a aba: recarregou o app, o automático volta.

import { useCallback, useEffect, useRef } from "react"
import { useApp } from "@/store/app"
import type { ContextPanelTab } from "@/store/app"

let escolhaHumana = false

/** Você já escolheu uma aba com a mão nesta sessão? */
export function abaFoiEscolhida(): boolean {
  return escolhaHumana
}

/** Registra o gesto. Daqui pra frente o app não move mais a aba sozinho. */
export function registrarEscolhaDeAba(): void {
  escolhaHumana = true
}

/** A precedência, pura: gesto humano ganha da sugestão do app, sempre.
 *
 *  Devolve a aba que deve valer — `atual` quando você já escolheu (nada se
 *  move), `sugerida` quando não. Fica separada da montagem porque é ELA que a
 *  regressão de 09/09/2026 quebrou, e regra que já quebrou merece teste sem
 *  precisar montar componente. */
export function abaSugerida(
  atual: ContextPanelTab,
  sugerida: ContextPanelTab,
  jaEscolheu: boolean,
): ContextPanelTab {
  return jaEscolheu ? atual : sugerida
}

/** Reset entre casos (estado de módulo não se carrega de um teste pro outro). */
export function _resetAbaEscolhidaForTests(): void {
  escolhaHumana = false
}

export interface ContextPanelTabControl {
  tab: ContextPanelTab
  /** Gesto SEU na barra de abas: manda, e cala as sugestões daqui pra frente. */
  selectTab: (tab: ContextPanelTab) => void
}

/**
 * A aba corrente e o gesto que a troca, com as sugestões do app já resolvidas.
 *
 * `running` é o turno em andamento; `hasDelivery` é uma entrega atribuída à
 * conversa ativa. As duas sugerem "alteracoes" e nenhuma passa por cima de você.
 * O run sugere UMA vez por turno (o ref existe pra isso, e só pra isso).
 */
export function useContextPanelTab(
  running: boolean,
  hasDelivery: boolean,
): ContextPanelTabControl {
  const tab = useApp((s) => s.contextPanelTab)
  const setTab = useApp((s) => s.setContextPanelTab)
  const jumpedOnRun = useRef(false)

  const selectTab = useCallback(
    (escolhida: ContextPanelTab) => {
      registrarEscolhaDeAba()
      setTab(escolhida)
    },
    [setTab],
  )

  // Sugerir = passar pela régua. Ler a aba corrente com `getState()` e não pela
  // `tab` do render mantém os efeitos fora da lista de dependências dela (que
  // muda a cada troca) e faz a decisão olhar o estado do momento em que corre.
  const sugerir = useCallback((sugerida: ContextPanelTab) => {
    const atual = useApp.getState().contextPanelTab
    const alvo = abaSugerida(atual, sugerida, abaFoiEscolhida())
    if (alvo !== atual) useApp.getState().setContextPanelTab(alvo)
  }, [])

  useEffect(() => {
    if (hasDelivery) sugerir("alteracoes")
  }, [hasDelivery, sugerir])

  useEffect(() => {
    if (running && !jumpedOnRun.current) {
      jumpedOnRun.current = true
      sugerir("alteracoes")
    }
    if (!running) jumpedOnRun.current = false
  }, [running, sugerir])

  return { tab, selectTab }
}
