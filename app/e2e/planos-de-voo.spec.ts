import { expect, test, type Page } from "@playwright/test"

async function abrirPlanos(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "mc.app",
      JSON.stringify({
        state: {
          theme: "dark",
          sidebarOpen: true,
          contextOpen: true,
          viewMode: "linear",
          settings: { onboarded: true },
        },
        version: 4,
      }),
    )
  })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await page.getByText("Planos de voo", { exact: true }).first().click()
  await expect(page.getByText("Fluxo executável", { exact: true })).toBeVisible()
}

test("a prancheta usa a área útil inteira e Esc devolve ao cartão", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await abrirPlanos(page)

  await page.getByText("Testar e capturar", { exact: true }).click()
  await expect(page.getByLabel("Nome da fase")).toHaveValue("Testar e capturar")
  await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
  const fullscreen = page.locator('[data-flight-plan-fullscreen="true"]')
  await expect(fullscreen).toBeVisible()
  const box = await fullscreen.boundingBox()
  expect(box?.x).toBe(0)
  expect(box?.y).toBe(56)
  expect(box?.width).toBe(1440)
  expect(box?.height).toBe(844)
  await expect(page.getByLabel("Nome da fase")).toHaveValue("Testar e capturar")
  await expect(
    page.getByText("Plano válido, alterações salvas automaticamente.", { exact: true }),
  ).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(page.locator('[data-flight-plan-fullscreen="true"]')).toHaveCount(0)
  await expect(page.locator('[data-flight-plan-fullscreen="false"]')).toBeVisible()
})

test("fase, segurança, rotas e validação refletem o contrato executável", async ({ page }) => {
  await abrirPlanos(page)

  await page.getByRole("button", { name: "Segurança", exact: true }).click()
  await expect(page.getByText("Permissão do projeto", { exact: true })).toBeVisible()
  await expect(page.getByText(/Efetivo:/)).toBeVisible()
  await expect(page.getByText("Decisão humana", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Rotas", exact: true }).click()
  await page.getByRole("button", { name: /Definir régua.*Implementar/ }).click()
  await expect(page.getByRole("button", { name: "Concluiu", exact: true })).toBeVisible()
  await expect(page.getByLabel("Limite de travessias da conexão")).toBeVisible()

  await page.getByRole("button", { name: "Adicionar ao plano", exact: true }).nth(1).click()
  await expect(page.getByText(/não é alcançável a partir da entrada/)).toBeVisible()
  await page.getByRole("button", { name: "Ver validação", exact: true }).click()
  await expect(page.getByText("Validação do plano", { exact: true })).toBeVisible()
})
