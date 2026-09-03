// GUARDA DE FLUIDEZ: o custo de renderizar UM TOKEN não pode voltar a subir.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ SE ESTA GUARDA DISPARAR: você quebrou a identidade de alguma prop, ou    │
// │ desescopou alguma derivação. NÃO afrouxe o número — ache o que passou a  │
// │ nascer novo por token. Os números aqui só DESCEM (menos nós novos, menos │
// │ itens varridos, faixa reconstruída menor).                               │
// └──────────────────────────────────────────────────────────────────────────┘
//
// Por que os alvos são CONTADORES e não milissegundos: tempo de parede depende
// da máquina (o CI não é o M1 Pro onde a frente foi medida) e do JIT — o
// `perf-fio-plan.md` viu `buildNodes` oscilar 0,58 → 0,82 sem uma linha
// alterada. Uma guarda de tempo daria falso positivo, seria desligada em duas
// semanas, e aí não guardaria nada. Os contadores abaixo são idênticos em
// qualquer máquina e são EXATAMENTE o que a frente anterior comprou.
//
// Fixture: fio REAL de 1.885 itens (`src/test/fio-real.json`), o mesmo do
// `perf-fio-plan.md`. Extraído por `scripts/extrair-fio-real.mjs`, que é a
// proveniência. Não substitua por fio sintético: `continuesProse` decide a
// costura de prosa lendo o CONTEÚDO do texto, então prosa fabricada muda a
// contagem de nós e a guarda passa a medir outra coisa (ADR-016).
import { describe, expect, it } from "vitest"
import { medirFio, PASSES } from "./fio.bench"
import type { ChatItem } from "@/store/chat"

const cru = (glob: Record<string, unknown>): string => Object.values(glob)[0] as string

const fioReal = JSON.parse(
  cru(
    import.meta.glob("../../test/fio-real.json", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ),
) as ChatItem[]

describe("o fio de referência é o real, e é o mesmo do plano", () => {
  it("tem os 1.885 itens medidos em 13/08/2026", () => {
    // Trocar a fixture troca todos os números abaixo. Se este teste falhar,
    // pare: os alvos desta guarda não valem mais para o fio novo.
    expect(fioReal.length).toBe(1885)
  })
})

describe("JANELA (o caso normal: 150 nós na tela)", () => {
  const { contadores } = medirFio(fioReal, { tokens: 201 })

  it("só a bolha viva ganha identidade nova por token", () => {
    // A invariante do P1, e a mais importante do arquivo. Antes dele eram
    // 149/149 nós assentados renascendo a cada token, com dois `memo` escritos
    // que não memoizavam nada. Qualquer número acima de 1 aqui significa que
    // um nó que NÃO mudou está sendo reconstruído.
    expect(contadores.nosNovosPior).toBe(1)
    expect(contadores.nosNovos).toBe(contadores.tokens)
  })

  it("o mapa de selos de anexo não renasce (é o que o memo do MessageItem lê)", () => {
    // `attReads` era objeto novo a cada token, e por isso TODO MessageItem
    // re-renderizava. Zero é o alvo: nenhum anexo muda de selo durante o
    // streaming de texto.
    expect(contadores.attReadsNovos).toBe(0)
    // Sem esta linha a asserção acima seria vazia: "0 novos de 0 entradas"
    // passaria para sempre. O fio real tem 15 anexos, 6 no sufixo varrido.
    expect(contadores.attReadsEntradas).toBeGreaterThanOrEqual(6)
  })

  it("a dobra reconstrói só a ponta do fio, não o fio", () => {
    // Etapa B. De 395 nós, a dobra recomeça no 392: três nós de faixa.
    // Número MAIOR é melhor; se cair, a faixa cresceu.
    expect(contadores.rebuiltFromPior).toBeGreaterThanOrEqual(392)
    expect(contadores.nos).toBe(395)
    expect(contadores.visiveis).toBe(150)
  })

  it("as derivações escopadas varrem o sufixo, não o fio inteiro", () => {
    // Etapa A: 562 itens varridos para servir 150 nós, em vez dos 1.886 do
    // fio. Número MENOR é melhor.
    expect(contadores.sufixoVarridoPior).toBeLessThanOrEqual(562)
    expect(contadores.itens).toBe(1886)
  })
})

describe("showAll (janela desligada: o fio inteiro na tela)", () => {
  const { contadores } = medirFio(fioReal, { tokens: 201, showAll: true })

  it("as garantias de identidade valem igual, sem janela", () => {
    // O penhasco do `showAll` é de MONTAGEM (395 nós de uma vez), não de
    // token: com a janela desligada o custo por token não pode degradar.
    expect(contadores.nosNovosPior).toBe(1)
    expect(contadores.attReadsNovos).toBe(0)
    expect(contadores.visiveis).toBe(395)
  })

  it("sem janela, o escopo degrada para o fio inteiro — e isso é o correto", () => {
    // Degradação honesta: não havendo nada escondido, não há sufixo a inferir.
    // Errar para MENOS aqui seria dado sumindo da tela, que é pior que lentidão.
    expect(contadores.sufixoVarridoPior).toBe(1886)
  })
})

describe("o medidor não pode sair de sincronia com o MessageList", () => {
  const messageList = cru(
    import.meta.glob("./MessageList.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  )

  it("todo passe cronometrado é um passe que o MessageList realmente faz", () => {
    // O medidor imita a cadeia do componente. Se o componente parar de chamar
    // um passe (ou o medidor inventar um), os números passam a descrever uma
    // tela que não existe.
    const semEquivalenteNoComponente = new Set([
      "reducer", // mora na store, não no componente
      "buildNodes", // o componente chama via `useStableNodes`
      "reuseNodes", // idem
    ])
    for (const passe of PASSES) {
      if (semEquivalenteNoComponente.has(passe)) continue
      expect(messageList, `MessageList deveria chamar ${passe}`).toContain(passe)
    }
  })

  it("os dois passes que o hook esconde continuam vindo de useStableNodes", () => {
    expect(messageList).toContain("useStableNodes")
    expect(messageList).toContain("useStableAttReads")
  })
})
