import { test, expect } from "@playwright/test"

// Padrões de console que denunciam um loop de render / crash silencioso. O bug
// que motivou este smoke-test: um selector zustand devolvendo `[]` novo a cada
// snapshot fazia o useSyncExternalStore do React entrar em loop infinito
// ("getSnapshot should be cached") e dava TELA PRETA — passava nos 80 unit e no
// build, só quebrava no boot real do browser.
const FATAL_CONSOLE = [
  "Maximum update depth exceeded",
  "getSnapshot should be cached",
  "Too many re-renders",
  "Rendered more hooks than during the previous render",
]

test("o app BOOTA e RENDERIZA (sem tela preta / loop de render)", async ({
  page,
}) => {
  const fatal: string[] = []

  // Erros de render/loop chegam como console.error E/OU pageerror. Capturamos
  // os dois: um loop de useSyncExternalStore vaza pelo console; um throw no
  // render vira pageerror.
  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    const text = msg.text()
    if (FATAL_CONSOLE.some((p) => text.includes(p))) fatal.push(text)
  })
  page.on("pageerror", (err) => {
    const text = err.message
    if (FATAL_CONSOLE.some((p) => text.includes(p))) fatal.push(text)
    // Um erro não-tratado no boot (ex.: throw no primeiro render) também é fatal.
    else fatal.push(`pageerror: ${text}`)
  })

  await page.goto("/", { waitUntil: "domcontentloaded" })

  // #root precisa RECEBER conteúdo. Tela preta = root vazio (React nunca montou
  // ou montou e derrubou). Se estiver em loop, o elemento-âncora nunca aparece
  // e o expect estoura no timeout → FALHA (é isso que unit test não pega).
  //
  // Âncora resiliente aos dois caminhos de boot no browser:
  //  - onboarding (1º run, onboarded=false): overlay "MyCockpit"
  //  - já onboardado: sidebar com o header "Projetos"
  const anchor = page
    .getByText("Projetos", { exact: true })
    .or(page.getByRole("heading", { name: "MyCockpit" }))
  await expect(anchor.first()).toBeVisible({ timeout: 10_000 })

  // O root de fato tem árvore montada (não uma casca vazia).
  const rootChildren = await page.locator("#root > *").count()
  expect(rootChildren).toBeGreaterThan(0)

  // Deixa o app "assentar" e re-verifica o console: um loop não estabiliza e
  // continua cuspindo erros mesmo depois da âncora aparecer.
  await page.waitForTimeout(1_500)

  expect(
    fatal,
    `Erros fatais de boot detectados:\n${fatal.join("\n")}`,
  ).toEqual([])
})
