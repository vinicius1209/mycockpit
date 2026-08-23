import { test, expect, type Page } from "@playwright/test"

// O ANEL DE FOCO SÓ ACENDE NO TECLADO (§2.1).
//
// Regra que só existe no browser: `:focus-visible` é decisão do navegador, e
// jsdom não tem foco nem CSS computado. Mede-se no `dist/` buildado.
//
// O defeito que isto trava, relatado duas vezes pelo usuário ("parece bug de
// focus do radix", "aplicação web disfarçada de desktop"): abrir um dropdown do
// Radix com o MOUSE e fechar com o MOUSE deixava o gatilho com
// `:focus-visible`, porque o Radix devolve o foco por código e o navegador
// herda o "modo teclado" da navegação que rolou DENTRO do menu.
//
// As duas metades importam. Só apagar o anel seria regressão de acessibilidade;
// o teste exige que ele CONTINUE acendendo quando o foco veio de tecla.

async function preparar(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("mc.app", JSON.stringify({
      state: { theme: "dark", sidebarOpen: true, contextOpen: true,
               viewMode: "linear", settings: { onboarded: true } }, version: 4 }))
  })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.locator("header").first()).toBeVisible({ timeout: 10_000 })
}

const anel = (l: import("@playwright/test").Locator) =>
  l.evaluate((e) => {
    const s = getComputedStyle(e)
    return {
      modalidade: document.documentElement.dataset.modalidade,
      visivel: s.boxShadow !== "none" && s.boxShadow !== "",
    }
  })

test("mouse NÃO acende o anel; teclado acende", async ({ page }) => {
  await preparar(page)
  const b = page.locator('button[aria-label="Modo de execução do agente"]').first()
  await expect(b).toBeVisible({ timeout: 10_000 })

  // 1) só mouse: abre e fecha clicando fora
  await b.click()
  await page.waitForTimeout(200)
  await page.mouse.click(5, 5)
  await page.waitForTimeout(300)
  const m = await anel(b)
  console.log("MOUSE:", JSON.stringify(m))
  expect(m.modalidade).toBe("mouse")
  expect(m.visivel).toBe(false)

  // 2) teclado: tabula até o botão
  await page.keyboard.press("Tab")
  await page.waitForTimeout(150)
  await b.evaluate((e) => e.focus())
  await page.waitForTimeout(200)
  const t = await anel(b)
  console.log("TECLADO:", JSON.stringify(t))
  expect(t.modalidade).toBe("teclado")
  expect(t.visivel).toBe(true)
})
