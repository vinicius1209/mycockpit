// A ESTEIRA PARA QUANDO O TURNO ACABA. Sem exceção, e não só no caminho feliz.
//
// A escolha de movimento pra "rodando" (ADR-043) só é honesta se ela terminar
// junto com o turno: esteira que sobrevive ao fim é o `US$ 0,000` do medidor de
// novo, número parado vestido de vivo. Então aqui não se testa o caminho bom
// isolado; testa-se o turno morrendo de erro, de cancelamento e de fechamento
// do app, e a degradação obrigatória sem movimento.
//
// A renderização é server-side (`renderToStaticMarkup`), que é o que o repo
// tem: sem jsdom, sem testing-library. Serve exatamente pro que importa aqui —
// a marcação é função pura das props, e é isso que prova que o componente não
// tem onde esconder um estado de "ainda rodando".
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ConversationSlot } from "@/components/layout/ConversationSlot"
import { _resetMinuteTick, _setRelogio } from "@/lib/minuteTick"
import { useChat, type ConvState } from "@/store/chat"

const T0 = 1_785_512_000_000
const CONV = "conv-1"

let restaurarRelogio: (() => void) | null = null

beforeEach(() => {
  restaurarRelogio = _setRelogio(() => T0)
  useChat.setState({ byId: {} })
})

afterEach(() => {
  _resetMinuteTick()
  restaurarRelogio?.()
  useChat.setState({ byId: {} })
})

function rodando(over: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "proj-1",
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: "sess-1",
    model: "claude-opus-5",
    streamingTextId: null,
    running: true,
    finalizing: false,
    runId: "run-1",
    startedAt: T0 - 12_000,
    suggestions: [],
    suggesting: false,
    ...over,
  }
}

/** Renderiza o slot com os sinais que a linha de conversa lê do store. */
function render(c: ConvState | undefined, pede = false) {
  return renderToStaticMarkup(
    <ConversationSlot
      pede={pede}
      rodando={c?.running ?? false}
      falhou={c?.finishedUnseen === "error"}
      updatedAt={T0 - 5 * 60_000}
    />,
  )
}

const temEsteira = (html: string) => html.includes("conv-wire")

describe("a esteira só existe enquanto o turno existe", () => {
  it("turno rodando: a esteira está na linha", () => {
    useChat.setState({ byId: { [CONV]: rodando() } })
    const html = render(useChat.getState().byId[CONV])
    expect(temEsteira(html)).toBe(true)
    expect(html).toContain("turno rodando")
  })

  it("turno que morre por ERRO tira a esteira e deixa o ponto vermelho", () => {
    useChat.setState({ byId: { [CONV]: rodando() } })
    useChat.getState().handleEvent(CONV, {
      type: "error",
      message: "o CLI morreu no meio do turno",
    })
    const c = useChat.getState().byId[CONV]
    expect(c.running).toBe(false)
    const html = render({ ...c, finishedUnseen: "error" })
    expect(temEsteira(html)).toBe(false)
    expect(html).toContain("bg-st-error")
  })

  it("turno CANCELADO (você interrompeu) tira a esteira", () => {
    useChat.setState({ byId: { [CONV]: rodando() } })
    useChat.getState().handleEvent(CONV, { type: "cancelled" })
    const c = useChat.getState().byId[CONV]
    expect(c.running).toBe(false)
    expect(temEsteira(render(c))).toBe(false)
  })

  it("turno concluído tira a esteira e cai no tempo relativo", () => {
    useChat.setState({ byId: { [CONV]: rodando() } })
    useChat.getState().handleEvent(CONV, { type: "done" })
    const c = useChat.getState().byId[CONV]
    expect(c.running).toBe(false)
    const html = render(c)
    expect(temEsteira(html)).toBe(false)
    expect(html).toContain("5m")
  })

  it("finish() (o fim normal do turno) tira a esteira", () => {
    useChat.setState({ byId: { [CONV]: rodando() } })
    useChat.getState().finish(CONV)
    expect(useChat.getState().byId[CONV].running).toBe(false)
    expect(temEsteira(render(useChat.getState().byId[CONV]))).toBe(false)
  })

  it("app fechado e reaberto: a linha volta parada, porque turno vivo não vai pro disco", () => {
    // Depois de um restart a sidebar só conhece as METAS do banco
    // (`ConversationMeta`), que não têm campo de turno nenhum, e o `byId` do
    // store nasce vazio. Não existe caminho pelo qual "rodando" atravesse o
    // fechamento do app: o pior caso não é uma esteira órfã, é ausência de
    // esteira.
    useChat.setState({ byId: {} })
    const c = useChat.getState().byId[CONV]
    expect(c).toBeUndefined()
    const html = render(c)
    expect(temEsteira(html)).toBe(false)
    expect(html).toContain("5m")
  })

  it("o pedido pendente ganha da esteira: quem parou esperando você vem antes", () => {
    useChat.setState({ byId: { [CONV]: rodando() } })
    const html = render(useChat.getState().byId[CONV], true)
    expect(temEsteira(html)).toBe(false)
    expect(html).toContain("bg-st-warning")
  })
})

describe("o slot reserva o espaço mesmo calado", () => {
  it("sem carimbo de atividade, o slot renderiza vazio e do mesmo tamanho", () => {
    const html = renderToStaticMarkup(
      <ConversationSlot pede={false} rodando={false} falhou={false} updatedAt={null} />,
    )
    expect(html).toContain("w-9")
    expect(html).not.toContain("conv-wire")
    // Nada de "undefined" fantasma nem de rótulo inventado.
    expect(html).not.toMatch(/undefined|NaN/)
  })
})

describe("degradação sem movimento (prefers-reduced-motion)", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../../index.css", import.meta.url)),
    "utf8",
  )

  it("a esteira tem regra PRÓPRIA de reduced-motion", () => {
    // O bloco global só encurta a duração (`animation-duration: 0.001ms`), o
    // que deixaria a esteira congelada num quadro transparente: "rodando"
    // ficaria mudo. A regra própria é o que troca movimento por um traço
    // estático, e por isso ela é obrigatória.
    const bloco = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.conv-wire\s*\{([^}]*)\}/,
    )
    expect(bloco, "faltou o bloco reduced-motion da .conv-wire").toBeTruthy()
    const regra = bloco![1]
    expect(regra).toMatch(/animation:\s*none\s*!important/)
    // Estático mas VISÍVEL: um traço azul sólido, não o gradiente parado.
    expect(regra).toMatch(/background:\s*var\(--st-running\)/)
  })

  it("a esteira animada existe e é presa à presença do elemento, sem timer", () => {
    expect(css).toMatch(/@keyframes conv-wire/)
    expect(css).toMatch(/animation:\s*conv-wire\s+[\d.]+s[^;]*infinite/)
    // Se alguém trocar a esteira por um timer de JS, este teste continua
    // passando — por isso o componente não tem estado: ver os casos acima.
  })
})
