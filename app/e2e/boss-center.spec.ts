import { expect, test, type Page } from "@playwright/test"

const EVIDENCE_DIR = "artifacts/office-evidence"

async function enterOffice(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "mc.app",
      JSON.stringify({
        state: {
          theme: "dark",
          sidebarOpen: false,
          contextOpen: false,
          viewMode: "linear",
          settings: { onboarded: true },
        },
        version: 3,
      }),
    )
    localStorage.setItem("mc.office.onboarded", "1")
  })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "Escritório" }).click()
  await expect(page.getByRole("heading", { name: "Agent Office" })).toBeVisible({
    timeout: 15_000,
  })
}

test("Central do Boss agrega o escritório e mantém o fluxo de foco", async ({
  page,
}) => {
  await enterOffice(page)

  const trigger = page.getByRole("button", { name: /Abrir Central do Boss/ })
  await trigger.click()

  const panel = page.getByRole("complementary", { name: "Central do Boss" })
  await expect(panel).toBeVisible()
  await expect(panel.getByText("Precisa de você")).toBeVisible()
  await expect(panel.getByText("Em execução")).toBeVisible()
  await expect(panel.getByText("Entregas recentes")).toBeVisible()
  await expect(panel.getByText("Custo por sala")).toBeVisible()
  await expect(panel.getByRole("button", { name: /Frota:.*Inspecionar sala/ })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Fechar Central do Boss" })).toBeFocused()

  await page.screenshot({
    path: `${EVIDENCE_DIR}/05-boss-center.png`,
    fullPage: true,
  })

  await page.keyboard.press("Escape")
  await expect(panel).toBeHidden()
  await expect(trigger).toBeFocused()
  const canvas = page.getByTestId("office-canvas")
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.wheel(0, -450)
  await page.waitForTimeout(250)
  await page.screenshot({
    path: `${EVIDENCE_DIR}/05-boss-room.png`,
    fullPage: true,
  })
})
