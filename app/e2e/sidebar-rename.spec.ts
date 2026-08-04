import { expect, test } from "@playwright/test"

test("renomear conversa entrega o foco ao campo imediatamente", async ({
  page,
}) => {
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

  const conversation = page.getByRole("button", { name: /Nova conversa/ }).first()
  await expect(conversation).toBeVisible()
  await conversation.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Renomear" }).click()

  const input = page.getByRole("textbox", { name: "Renomear conversa" })
  await expect(input).toBeFocused()

  // Sem clicar no campo: digitar já precisa substituir a seleção atual.
  await page.keyboard.type("Nome escrito direto")
  await expect(input).toHaveValue("Nome escrito direto")
})
