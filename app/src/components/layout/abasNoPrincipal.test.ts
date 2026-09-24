import { beforeEach, describe, expect, it } from "vitest"
import {
  abrirAoLado,
  alternar,
  fecharArquivos,
  fecharAVista,
  haDialogoAberto,
  irParaPosicao,
  mostrar,
  reabrirUltima,
  trazerParaATira,
  vistaGuardada,
  vistaParaGuardar,
} from "./abasNoPrincipal"
import { SEM_ABAS, chaveDoDiff } from "@/lib/abasDeArquivo"
import { abasDo, useAbasDeArquivo } from "@/store/abasDeArquivo"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

const VIDEO = "docs/visual-reference/winglee-agent-ui/video.mp4"
const ARQ = "docs/architecture.md"
const FRAME = "docs/visual-reference/winglee-agent-ui/frame_020.png"

const abas = (conversa = "c1") => abasDo(useAbasDeArquivo.getState(), conversa)
const vista = () => useApp.getState().mainTab
/** O que o `switchConversation` faz com o store, sem o banco. */
const irParaConversa = (id: string | null) => useChat.setState({ activeId: id })

beforeEach(() => {
  useChat.setState({ activeId: null })
  useAbasDeArquivo.setState({ porConversa: {}, fechadas: {}, sumidos: {}, ladoCabe: true, revelar: null })
  useApp.setState({
    activeProjectId: "frota",
    mainTab: { kind: "conversa" },
    navegadorAberto: false,
    branchSplitOpen: false,
    viewMode: "linear",
  })
  irParaConversa("c1")
})

describe("abas de arquivo no painel principal (ADR-243)", () => {
  it("voltar para a Conversa não fecha o arquivo: o pedido de 24/09/2026", () => {
    useApp.getState().openFileTab(ARQ)
    useApp.getState().openFileTab(VIDEO)
    mostrar(null)
    expect(vista()).toEqual({ kind: "conversa" })
    expect(abas().abertas).toEqual([ARQ, VIDEO])
    mostrar(ARQ)
    expect(vista()).toEqual({ kind: "arquivo", path: ARQ })
  })

  it("fechar o arquivo à vista mostra a vizinha; fechar outro não mexe na vista", () => {
    for (const c of [VIDEO, ARQ, FRAME]) useApp.getState().openFileTab(c)
    mostrar(ARQ)
    fecharArquivos([VIDEO])
    expect(vista()).toEqual({ kind: "arquivo", path: ARQ })
    fecharAVista()
    expect(vista()).toEqual({ kind: "arquivo", path: FRAME })
    fecharAVista()
    expect(vista()).toEqual({ kind: "conversa" })
    expect(abas().abertas).toEqual([])
  })

  it("fechar as da direita com a vista entre elas cai na da esquerda", () => {
    for (const c of [VIDEO, ARQ, FRAME]) useApp.getState().openFileTab(c)
    fecharArquivos([ARQ, FRAME])
    expect(vista()).toEqual({ kind: "arquivo", path: VIDEO })
  })

  it("⌘W na Conversa não faz nada", () => {
    useApp.getState().openFileTab(ARQ)
    mostrar(null)
    fecharAVista()
    expect(abas().abertas).toEqual([ARQ])
  })

  it("⌘⇧T reabre a última fechada e a põe à vista", () => {
    useApp.getState().openFileTab(ARQ)
    useApp.getState().openFileTab(VIDEO)
    fecharArquivos([ARQ])
    fecharAVista()
    reabrirUltima()
    expect(vista()).toEqual({ kind: "arquivo", path: VIDEO })
    reabrirUltima()
    expect(abas().abertas).toEqual([VIDEO, ARQ])
    reabrirUltima()
    expect(vista()).toEqual({ kind: "arquivo", path: ARQ })
  })

  it("⌘1 é a Conversa, ⌘2 a primeira aba, e posição vazia não faz nada", () => {
    useApp.getState().openFileTab(ARQ)
    irParaPosicao(1)
    expect(vista()).toEqual({ kind: "conversa" })
    irParaPosicao(2)
    expect(vista()).toEqual({ kind: "arquivo", path: ARQ })
    irParaPosicao(7)
    expect(vista()).toEqual({ kind: "arquivo", path: ARQ })
  })

  it("ao lado: a conversa fica à vista, e pedir o arquivo do lado é pedir a Conversa", () => {
    useApp.getState().openFileTab(ARQ)
    abrirAoLado(FRAME)
    expect(vista()).toEqual({ kind: "conversa" })
    expect(abas()).toMatchObject({ abertas: [ARQ, FRAME], aoLado: FRAME })
    mostrar(ARQ)
    mostrar(FRAME)
    expect(vista()).toEqual({ kind: "conversa" })
    // ⌃Tab pula o do lado: ele já está na tela com a conversa.
    alternar(1)
    expect(vista()).toEqual({ kind: "arquivo", path: ARQ })
    alternar(1)
    expect(vista()).toEqual({ kind: "conversa" })
  })

  it("com o cartão estreito, o do lado vira aba comum", () => {
    abrirAoLado(FRAME)
    useAbasDeArquivo.getState().setLadoCabe(false)
    mostrar(FRAME)
    expect(vista()).toEqual({ kind: "arquivo", path: FRAME })
  })

  it("trazer para a tira tira do lado e mostra sozinho", () => {
    abrirAoLado(FRAME)
    trazerParaATira(FRAME)
    expect(abas().aoLado).toBeNull()
    expect(vista()).toEqual({ kind: "arquivo", path: FRAME })
  })
})

describe("a tira é da conversa (ADR-244)", () => {
  it("trocar de conversa com o Navegador à vista não leva o Navegador junto: o bug de 24/09/2026", () => {
    useApp.getState().openBrowserTab()
    irParaConversa("c2")
    expect(vista()).toEqual({ kind: "conversa" })
    expect(useApp.getState().navegadorAberto).toBe(false)
    irParaConversa("c1")
    expect(vista()).toEqual({ kind: "navegador" })
    expect(useApp.getState().navegadorAberto).toBe(true)
  })

  it("cada conversa tem os próprios arquivos e volta no que estava à vista", () => {
    useApp.getState().openFileTab(ARQ)
    irParaConversa("c2")
    expect(abas("c2").abertas).toEqual([])
    useApp.getState().openFileTab(VIDEO)
    mostrar(null)
    irParaConversa("c1")
    expect(vista()).toEqual({ kind: "arquivo", path: ARQ })
    expect(abas("c1").abertas).toEqual([ARQ])
    irParaConversa("c2")
    expect(vista()).toEqual({ kind: "conversa" })
    expect(abas("c2").abertas).toEqual([VIDEO])
  })

  it("Navegador aberto mas atrás de um arquivo volta assim: na tira, com o arquivo à vista", () => {
    useApp.getState().openBrowserTab()
    useApp.getState().openFileTab(ARQ)
    irParaConversa("c2")
    irParaConversa("c1")
    expect(vista()).toEqual({ kind: "arquivo", path: ARQ })
    expect(useApp.getState().navegadorAberto).toBe(true)
  })

  it("trocar de projeto não apaga o que a conversa de saída tinha à vista", () => {
    useApp.getState().openFileTab(ARQ)
    // `setActiveProject` volta para a Conversa ANTES de a conversa trocar.
    useApp.getState().setActiveProject("outro")
    irParaConversa("c-outro")
    expect(vista()).toEqual({ kind: "conversa" })
    useApp.getState().setActiveProject("frota")
    irParaConversa("c1")
    expect(vista()).toEqual({ kind: "arquivo", path: ARQ })
  })

  it("no boot, a conversa ativa reabre no que estava à vista", () => {
    useApp.getState().openFileTab(ARQ)
    irParaConversa(null)
    expect(vista()).toEqual({ kind: "conversa" })
    irParaConversa("c1")
    expect(vista()).toEqual({ kind: "arquivo", path: ARQ })
  })

  it("Alterações é passageira: ao voltar, a conversa abre na Conversa", () => {
    useApp.getState().openDiffTab(undefined)
    irParaConversa("c2")
    irParaConversa("c1")
    expect(vista()).toEqual({ kind: "conversa" })
  })

  it("na comparação de ramos, clicar no outro ramo não tira a comparação da tela", () => {
    irParaConversa("ramo")
    useApp.getState().openFileTab(ARQ)
    irParaConversa("c1")
    useApp.setState({ branchSplitOpen: true })
    irParaConversa("ramo")
    expect(vista()).toEqual({ kind: "conversa" })
    expect(useApp.getState().branchSplitOpen).toBe(true)
    useApp.setState({ branchSplitOpen: false })
  })

  it("trocar para uma conversa com a mesma vista não mexe no app", () => {
    irParaConversa("c2")
    let avisos = 0
    const desligar = useApp.subscribe(() => {
      avisos++
    })
    irParaConversa("c3")
    irParaConversa("c2")
    desligar()
    expect(avisos).toBe(0)
  })

  it("conversa que só teve a Conversa não ocupa lugar guardado", () => {
    irParaConversa("c2")
    irParaConversa("c1")
    expect(useAbasDeArquivo.getState().porConversa).toEqual({})
  })
})

describe("o que se guarda e o que volta (puro)", () => {
  it("guarda arquivo, Navegador à vista ou só aberto", () => {
    expect(vistaParaGuardar({ kind: "arquivo", path: ARQ }, true)).toEqual({ vista: ARQ, navegador: "aberto" })
    expect(vistaParaGuardar({ kind: "navegador" }, true)).toEqual({ vista: null, navegador: "a-vista" })
    expect(vistaParaGuardar({ kind: "diff" }, false)).toEqual({ vista: null, navegador: "fechado" })
  })

  it("arquivo que já saiu da tira não volta à vista", () => {
    expect(vistaGuardada({ ...SEM_ABAS, vista: ARQ }).mainTab).toEqual({ kind: "conversa" })
    expect(vistaGuardada({ ...SEM_ABAS, abertas: [ARQ], vista: ARQ }).mainTab).toEqual({ kind: "arquivo", path: ARQ })
  })
})

describe("as alterações de um arquivo ficam na tira (ADR-248)", () => {
  const HOOK = "app/src/components/browser/useNavegadorDoProjeto.ts"
  const TAB = "app/src/components/layout/MainTabs.tsx"

  it("abrir pelo painel do git e voltar para a Conversa não fecha: o caso de 24/09/2026", () => {
    // o que o clique no painel Alterações faz
    useApp.getState().openDiffTab(HOOK)
    expect(abas().abertas).toEqual([chaveDoDiff(HOOK)])
    mostrar(null)
    expect(vista()).toEqual({ kind: "conversa" })
    expect(abas().abertas).toEqual([chaveDoDiff(HOOK)])
  })

  it("abrir outro não fecha o primeiro, e dá para voltar a cada um", () => {
    useApp.getState().openDiffTab(HOOK)
    useApp.getState().openDiffTab(TAB)
    useApp.getState().openFileTab(ARQ)
    expect(abas().abertas).toEqual([chaveDoDiff(HOOK), chaveDoDiff(TAB), ARQ])
    mostrar(chaveDoDiff(HOOK))
    expect(vista()).toMatchObject({ kind: "diff", focusPath: HOOK })
    fecharAVista()
    expect(vista()).toMatchObject({ kind: "diff", focusPath: TAB })
  })

  it("a conversa volta no diff que estava à vista", () => {
    useApp.getState().openDiffTab(HOOK)
    irParaConversa("c2")
    expect(vista()).toEqual({ kind: "conversa" })
    irParaConversa("c1")
    expect(vista()).toMatchObject({ kind: "diff", focusPath: HOOK })
  })

  it("o diff inteiro (sem arquivo) segue passageiro", () => {
    useApp.getState().openDiffTab(undefined)
    expect(abas().abertas).toEqual([])
  })
})

describe("com um diálogo na frente, as teclas são dele", () => {
  it("reconhece o diálogo aberto pelo conteúdo que a primitiva desenha", () => {
    expect(haDialogoAberto({ querySelector: () => ({}) as Element })).toBe(true)
    expect(haDialogoAberto({ querySelector: () => null })).toBe(false)
  })
})

describe("conversa apagada leva a tira junto", () => {
  it("abas, pilha do ⌘⇧T e riscados dela saem; os da outra ficam", () => {
    useApp.getState().openFileTab(ARQ)
    fecharAVista()
    useApp.getState().openFileTab(VIDEO)
    useAbasDeArquivo.getState().marcarSumido("c1", VIDEO, true)
    irParaConversa("c2")
    useApp.getState().openFileTab(FRAME)
    useAbasDeArquivo.getState().esquecer("c1")
    const s = useAbasDeArquivo.getState()
    expect(s.porConversa.c1).toBeUndefined()
    expect(s.fechadas.c1).toBeUndefined()
    expect(Object.keys(s.sumidos)).toEqual([])
    expect(abas("c2").abertas).toEqual([FRAME])
  })
})
