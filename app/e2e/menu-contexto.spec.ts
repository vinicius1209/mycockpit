import { expect, test, type Page } from "@playwright/test"

// O e2e é o ÚNICO lugar que prova a supressão do menu do motor num navegador
// de verdade: teste unitário não tem evento `contextmenu` nativo pra cancelar.
// Aqui roda o `dist/` servido pelo `vite preview` (Chromium puro, isTauri()
// false), então dá pra provar duas coisas de uma vez: que ninguém deixa o
// clique direito escapar, e que "Colar"/"Mostrar na pasta" somem honestamente
// onde o app não consegue executá-los.
//
// O gravador é um ouvinte de BOLHA na `window`: no caminho de propagação a
// `window` vem DEPOIS do `document`, que é onde mora a guarda. Se ele vê
// `defaultPrevented === true`, o WebKit/Chromium não abre menu nenhum.

async function abrir(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __ctx: boolean[] }
    w.__ctx = []
    window.addEventListener("contextmenu", (e) => w.__ctx.push(e.defaultPrevented))
  })
  await page.addInitScript(() => {
    localStorage.setItem(
      "mc.app",
      JSON.stringify({
        state: {
          theme: "dark",
          sidebarOpen: true,
          contextOpen: false,
          viewMode: "linear",
          settings: { onboarded: true },
        },
        version: 3,
      }),
    )
  })
  await page.goto("/", { waitUntil: "domcontentloaded" })
}

const prevenidos = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ctx: boolean[] }).__ctx)

test("nenhum clique direito escapa pro menu do motor", async ({ page }) => {
  await abrir(page)

  const conversa = page.getByRole("button", { name: /Nova conversa/ }).first()
  await expect(conversa).toBeVisible()

  // Três superfícies diferentes: a que tem menu próprio (sidebar), o miolo do
  // app e o canto do rodapé. Em todas o motor tem que ficar calado.
  await conversa.click({ button: "right" })
  await page.keyboard.press("Escape")
  await page.mouse.click(700, 400, { button: "right" })
  await page.keyboard.press("Escape")
  await page.mouse.click(700, 700, { button: "right" })
  await page.keyboard.press("Escape")

  const vistos = await prevenidos(page)
  expect(vistos.length).toBe(3)
  expect(vistos).toEqual([true, true, true])
})

/**
 * O campo de renomear da sidebar é o campo de texto que existe no caminho sem
 * Tauri. Ele nasce VAZIO (o "Nova conversa" da linha é título derivado, não
 * valor salvo), então o teste enche antes: campo vazio e sem leitura de área
 * de transferência não tem item honesto nenhum, e aí o menu não abre mesmo.
 *
 * Ele também mora DENTRO da linha da conversa, que é um trigger de menu do
 * Radix. Que apareça o menu de EDIÇÃO aqui, e não "Renomear · Duplicar ·
 * Excluir", é a prova de que campo de texto ganha de menu de container.
 */
async function campoComTexto(page: Page) {
  const conversa = page.getByRole("button", { name: /Nova conversa/ }).first()
  await conversa.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Renomear" }).click()
  const campo = page.getByRole("textbox", { name: "Renomear conversa" })
  await expect(campo).toBeFocused()
  await campo.fill("conversa de teste")
  return campo
}

test("em campo de texto o menu do app entra no lugar do menu do sistema", async ({
  page,
}) => {
  await abrir(page)
  const campo = await campoComTexto(page)

  await campo.click({ button: "right" })

  const menu = page.getByRole("menu")
  await expect(menu).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: "Selecionar tudo" })).toBeVisible()
  // Não é o menu do container: o campo ganhou.
  await expect(menu.getByRole("menuitem", { name: "Renomear" })).toHaveCount(0)
  // O clique direito põe o cursor sem selecionar nada: sem seleção não há o
  // que cortar nem copiar, e o item some em vez de ficar morto.
  await expect(menu.getByRole("menuitem", { name: "Cortar" })).toHaveCount(0)
  await expect(menu.getByRole("menuitem", { name: "Copiar" })).toHaveCount(0)
  // Fora do Tauri não há como LER a área de transferência (no WKWebView o
  // readText() do navegador é recusado): "Colar" some em vez de falhar.
  await expect(menu.getByRole("menuitem", { name: "Colar" })).toHaveCount(0)
})

test("com texto selecionado o campo passa a oferecer cortar e copiar", async ({
  page,
}) => {
  await abrir(page)
  const campo = await campoComTexto(page)
  await campo.selectText()

  await campo.click({ button: "right" })

  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitem", { name: "Cortar" })).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: "Copiar" })).toBeVisible()
})

test("o menu do app é alcançável pelo teclado e sai no Esc", async ({ page }) => {
  await abrir(page)
  const campo = await campoComTexto(page)
  await campo.click({ button: "right" })

  const menu = page.getByRole("menu")
  await expect(menu).toBeVisible()
  await page.keyboard.press("ArrowDown")
  await expect(menu.getByRole("menuitem", { name: "Selecionar tudo" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(menu).toHaveCount(0)
})

test("superfície com menu próprio continua com o dela, sem menu duplo", async ({
  page,
}) => {
  await abrir(page)

  const conversa = page.getByRole("button", { name: /Nova conversa/ }).first()
  await conversa.click({ button: "right" })

  // Um menu só na tela, e é o da conversa: o host global vê o clique já
  // assumido pelo Radix e não abre um segundo por cima.
  await expect(page.getByRole("menu")).toHaveCount(1)
  await expect(page.getByRole("menuitem", { name: "Renomear" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Copiar texto" })).toHaveCount(0)
})
