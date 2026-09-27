// As abas do painel principal de cada conversa (ADR-243, ADR-244): os gestos
// (abrir, fechar, reabrir, alternar, pôr ao lado) e a ligação da tira com a
// conversa ativa. Cada gesto mexe no conjunto (`store/abasDeArquivo.ts`) e na
// vista (`mainTab` de `store/app.ts`) de uma vez, para a tira, o menu da aba e
// os atalhos dizerem a mesma coisa.

import { listen } from "@tauri-apps/api/event"
import { acaoDoAtalho, type AcaoDoAtalho } from "@/components/layout/atalhosDasAbas"
import {
  abaVizinha,
  chaveDoDiff,
  lerChave,
  vizinhaAoFechar,
  type AbasDaConversa,
} from "@/lib/abasDeArquivo"
import { currentPlatform } from "@/lib/commandMenu"
import { isTauri } from "@/lib/db"
import { planoDoPortao, resolverPerguntas, soltarAsFechadas } from "@/lib/edicao/portao"
import { raizEfetivaAgora } from "@/components/layout/raizEfetiva"
import type { MainTab } from "@/lib/mainTabs"
import { abasDo, useAbasDeArquivo } from "@/store/abasDeArquivo"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

function conversaAtiva(): string | null {
  return useChat.getState().activeId
}

/** A chave da aba da tira que está à vista: o arquivo, ou as alterações de
 *  um arquivo; `null` para a Conversa, o Navegador e o diff inteiro. Puro. */
export function chaveDaVista(tab: MainTab): string | null {
  if (tab.kind === "arquivo") return tab.path
  if (tab.kind === "diff" && tab.focusPath) return chaveDoDiff(tab.focusPath)
  return null
}

export function abaAVista(): string | null {
  return chaveDaVista(useApp.getState().mainTab)
}

/** O arquivo ao lado da conversa, se ele cabe lá agora. */
export function ladoEmUso(): string | null {
  const abas = useAbasDeArquivo.getState()
  return abas.ladoCabe ? abasDo(abas, conversaAtiva()).aoLado : null
}

/** Põe na tela uma aba da tira (chave), ou a Conversa (`null`). O arquivo que
 *  está ao lado já está na tela junto da conversa: pedi-lo é pedir a Conversa. */
export function mostrar(chave: string | null): void {
  const app = useApp.getState()
  if (chave === null || chave === ladoEmUso()) return app.closeMainTab()
  const { tipo, caminho } = lerChave(chave)
  if (tipo === "diff") app.openDiffTab(caminho)
  else app.openFileTab(caminho)
}

export function fecharArquivos(pedidos: readonly string[]): void {
  const convId = conversaAtiva()
  if (!convId || pedidos.length === 0) return
  // Aba com texto não salvo pergunta antes (docs/edicao-de-arquivos-spec.md
  // §9.1). Sem pergunta, o fechamento continua síncrono, como sempre foi.
  const root = raizEfetivaAgora()
  const plano = planoDoPortao(convId, pedidos, root)
  if (plano.perguntar.length === 0) return fecharJa(convId, pedidos, root)
  void resolverPerguntas(plano).then((fecham) => {
    if (fecham === null) return
    const podem = pedidos.filter((c) => plano.fechaDireto.includes(c) || fecham.includes(c))
    if (podem.length > 0 && conversaAtiva() === convId) fecharJa(convId, podem, root)
  })
}

function fecharJa(convId: string, caminhos: readonly string[], root: string | null): void {
  soltarAsFechadas(convId, caminhos, root)
  const abertas = abasDo(useAbasDeArquivo.getState(), convId).abertas
  const vista = abaAVista()
  const saiAVista = vista !== null && caminhos.includes(vista)
  // A vizinha se escolhe entre as que FICAM, mais a própria vista para ter
  // posição: fechar "as da direita" com a vista entre elas cai na da esquerda.
  const proxima = saiAVista
    ? vizinhaAoFechar(abertas.filter((c) => c === vista || !caminhos.includes(c)), vista)
    : undefined
  useAbasDeArquivo.getState().fechar(convId, caminhos)
  if (proxima !== undefined) mostrar(proxima)
}

/** ⌘W: fecha o arquivo à vista. Na Conversa não faz nada: ela não fecha. */
export function fecharAVista(): void {
  const vista = abaAVista()
  if (vista) fecharArquivos([vista])
}

/** ⌘⇧T */
export function reabrirUltima(): void {
  const convId = conversaAtiva()
  if (!convId) return
  const chave = useAbasDeArquivo.getState().reabrir(convId)
  if (chave) mostrar(chave)
}

/** ⌃Tab / ⌃⇧Tab, na ordem da tira (a Conversa é a primeira). */
export function alternar(passo: 1 | -1): void {
  const abertas = abasDo(useAbasDeArquivo.getState(), conversaAtiva()).abertas
  const lado = ladoEmUso()
  const ordem = abertas.filter((c) => c !== lado)
  mostrar(abaVizinha(ordem, abaAVista(), passo))
}

/** ⌘1 é a Conversa; ⌘2…⌘9 são os arquivos, na posição da tira. */
export function irParaPosicao(n: number): void {
  if (n <= 1) return mostrar(null)
  const caminho = abasDo(useAbasDeArquivo.getState(), conversaAtiva()).abertas[n - 2]
  if (caminho) mostrar(caminho)
}

export function abrirAoLado(caminho: string): void {
  const convId = conversaAtiva()
  if (!convId) return
  useAbasDeArquivo.getState().porAoLado(convId, caminho)
  useApp.getState().closeMainTab()
}

/** Tira o arquivo do lado e o põe à vista, sozinho. */
export function trazerParaATira(caminho: string): void {
  const convId = conversaAtiva()
  if (!convId) return
  useAbasDeArquivo.getState().porAoLado(convId, null)
  useApp.getState().openFileTab(caminho)
}

/** Deixa de mostrar ao lado; a aba continua aberta. */
export function fecharOLado(): void {
  const convId = conversaAtiva()
  if (convId) useAbasDeArquivo.getState().porAoLado(convId, null)
}

/** Abre a aba Arquivos do painel direito e pede à árvore para mostrar o caminho. */
export function mostrarNaArvore(caminho: string): void {
  const app = useApp.getState()
  app.setContextPanelTab("arquivos")
  if (!app.contextOpen) app.toggleContext()
  useAbasDeArquivo.getState().pedirRevelar(caminho)
}

// --- A tira segue a conversa (ADR-244) ---------------------------------------

/** O que guardar da tela de agora. O diff inteiro (sem arquivo) é índice
 *  passageiro: guarda como Conversa. Puro. */
export function vistaParaGuardar(
  tab: MainTab,
  navegadorAberto: boolean,
): Pick<AbasDaConversa, "vista" | "navegador"> {
  return {
    vista: chaveDaVista(tab),
    navegador: tab.kind === "navegador" ? "a-vista" : navegadorAberto ? "aberto" : "fechado",
  }
}

/** A mesma vista, para não trocar o objeto (e re-renderizar) à toa. Puro. */
export function mesmaVista(a: MainTab, b: MainTab): boolean {
  return a.kind === b.kind && chaveDaVista(a) === chaveDaVista(b)
}

/** A tela que a conversa guardou. Arquivo que já saiu da tira não volta. Puro. */
export function vistaGuardada(a: AbasDaConversa): { mainTab: MainTab; navegadorAberto: boolean } {
  const aba = a.vista && a.abertas.includes(a.vista) ? lerChave(a.vista) : null
  const mainTab: MainTab =
    a.navegador === "a-vista"
      ? { kind: "navegador" }
      : aba?.tipo === "diff"
        ? { kind: "diff", focusPath: aba.caminho, focusSeq: 1 }
        : aba
          ? { kind: "arquivo", path: aba.caminho }
          : { kind: "conversa" }
  return { mainTab, navegadorAberto: a.navegador !== "fechado" }
}

/**
 * Liga a tira à conversa ativa. Duas regras, e nenhuma copia a outra:
 *  - toda mudança de vista (ou da aba Navegador) fica anotada na conversa que
 *    está na tela; arquivo, ou alterações de um arquivo, postos à vista entram
 *    na tira dela;
 *  - trocar de conversa põe na tela o que a de destino guardou. É isto que
 *    também troca a tira ao mudar de projeto, e no boot.
 *
 * A mudança de vista que vem JUNTO com a troca de projeto não é anotada: é o
 * `setActiveProject` voltando para a Conversa antes de a conversa trocar, e
 * anotá-la apagaria o que a conversa de saída tinha à vista.
 *
 * Sem laço: a primeira escreve só no store das abas, que ninguém aqui escuta;
 * a segunda escreve no app, e a primeira, ao ouvir, só anota o que já estava
 * guardado (e o store não grava o que não mudou). Os ouvintes rodam a cada
 * mudança dos stores, inclusive a cada pedaço de texto que chega no fio: a
 * primeira coisa de cada um é sair cedo.
 */
export function ligarAbasAConversa(): () => void {
  const desligarApp = useApp.subscribe((s, antes) => {
    if (s.mainTab === antes.mainTab && s.navegadorAberto === antes.navegadorAberto) return
    if (s.activeProjectId !== antes.activeProjectId) return
    const convId = conversaAtiva()
    if (!convId) return
    const abas = useAbasDeArquivo.getState()
    const chave = chaveDaVista(s.mainTab)
    if (chave) abas.abrir(convId, chave)
    abas.marcarVista(convId, vistaParaGuardar(s.mainTab, s.navegadorAberto))
  })
  const desligarChat = useChat.subscribe((s, antes) => {
    if (s.activeId === antes.activeId) return
    const guardada = vistaGuardada(abasDo(useAbasDeArquivo.getState(), s.activeId))
    const app = useApp.getState()
    // Na comparação de ramos, clicar num lado troca a conversa ativa, e a
    // comparação É a vista: só a tira acompanha.
    const trocaVista = !app.branchSplitOpen && !mesmaVista(app.mainTab, guardada.mainTab)
    const trocaNavegador = app.navegadorAberto !== guardada.navegadorAberto
    if (!trocaVista && !trocaNavegador) return
    useApp.setState({
      ...(trocaVista ? { mainTab: guardada.mainTab } : {}),
      ...(trocaNavegador ? { navegadorAberto: guardada.navegadorAberto } : {}),
    })
  })
  return () => {
    desligarApp()
    desligarChat()
  }
}

// Liga no import: a tira existe desde o boot, e a conversa ativa do boot já
// chega por esta mesma troca. No dev, o HMR reavalia o módulo: a ligação
// antiga sai antes, senão cada edição somaria um par de ouvintes.
const desligar = ligarAbasAConversa()
import.meta.hot?.dispose(desligar)

/** Há um diálogo na frente (Configurações, ⌘K, confirmação)? Com ele aberto,
 *  as teclas são dele: ⌘2 ou ⌘W não podem mexer na tira que ficou atrás. */
export function haDialogoAberto(doc: Pick<Document, "querySelector"> = document): boolean {
  return doc.querySelector('[data-slot="dialog-content"]') !== null
}

function executar(acao: AcaoDoAtalho): void {
  if (acao.tipo === "posicao") irParaPosicao(acao.n)
  else if (acao.tipo === "alternar") alternar(acao.passo)
  else if (acao.tipo === "fechar") fecharAVista()
  else reabrirUltima()
}

/** Liga o teclado das abas e o ⌘W do menu nativo. Devolve o desligar. Quem
 *  chama é a tira, que só existe com a superfície Trabalho à vista. */
export function instalarAtalhosDasAbas(): () => void {
  const aoTeclar = (e: KeyboardEvent) => {
    const acao = acaoDoAtalho(e, currentPlatform())
    if (!acao || haDialogoAberto()) return
    e.preventDefault()
    executar(acao)
  }
  window.addEventListener("keydown", aoTeclar)
  let desligarMenu: (() => void) | null = null
  let desligado = false
  if (isTauri()) {
    void listen("frota://fechar-aba", () => {
      if (!haDialogoAberto()) fecharAVista()
    }).then((un) => {
      if (desligado) un()
      else desligarMenu = un
    })
  }
  return () => {
    desligado = true
    window.removeEventListener("keydown", aoTeclar)
    desligarMenu?.()
  }
}
