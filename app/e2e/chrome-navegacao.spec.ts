import { test, expect } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
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
        version: 5,
      }),
    ),
  )
  await page.goto("/")
  await expect(
    page.getByRole("button", { name: "Abrir Painel", exact: true }),
  ).toBeVisible()
})

test("Painel em Geral e seleção de projeto retornando ao Trabalho", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Abrir Painel", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Abrir Painel", exact: true }),
  ).toHaveAttribute("aria-current", "page")
  await expect(
    page.getByRole("tab", { name: "Conversa", exact: true }),
  ).not.toBeVisible()
  await page.getByRole("button", { name: "Abrir Frota", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Abrir Painel", exact: true }),
  ).not.toHaveAttribute("aria-current", "page")
  await expect(
    page.getByRole("button", { name: "Abrir Frota", exact: true }),
  ).toHaveAttribute("aria-current", "page")
  await page.getByTestId("centro-de-comando").click()
  await page
    .getByRole("option", { name: "atlas-commerce", exact: true })
    .click()
  await expect(
    page.getByRole("tab", { name: "Conversa", exact: true }),
  ).toBeVisible()
})

test("Notas tem porta visível e a paleta abre a gaveta a partir do Painel", async ({
  page,
}) => {
  const notes = page.getByRole("button", { name: /^Notas/ })
  await expect(notes).toBeVisible()
  await notes.click()
  await expect(notes).toHaveAttribute("aria-expanded", "true")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Abrir Painel", exact: true }).click()
  await expect(notes).not.toBeVisible()
  await page.getByTestId("centro-de-comando").click()
  await page
    .getByRole("option", { name: "Bloco de notas", exact: true })
    .click()
  await expect(notes).toHaveAttribute("aria-expanded", "true")
  await expect(
    page.getByRole("tab", { name: "Conversa", exact: true }),
  ).toBeVisible()
})

test("menu da conta oferece preferências, atalhos e tema Sistema em tempo real", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" })
  await page
    .getByRole("button", { name: "Perfil do usuário e preferências" })
    .click()
  await expect(
    page.getByRole("menuitem", { name: "Sobre a Frota" }),
  ).toBeVisible()
  await page.getByRole("menuitemradio", { name: "Sistema" }).click()
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(page.locator("html")).toHaveClass(/dark/)
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("mc.app")!).state.themePreference,
    ),
  ).toBe("system")
  await page
    .getByRole("button", { name: "Perfil do usuário e preferências" })
    .click()
  await page.getByRole("menuitem", { name: "Atalhos de teclado" }).click()
  await expect(
    page.getByRole("dialog", { name: "Atalhos de teclado" }),
  ).toBeVisible()
})

test("Configurações continua acessível por teclado com sidebar fechada", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Alternar o painel de projetos" })
    .click()
  await page.keyboard.press("Control+,")
  await expect(page.getByRole("dialog")).toBeVisible()
})
