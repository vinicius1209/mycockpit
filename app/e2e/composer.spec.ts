import { test, expect, type Page } from "@playwright/test"

// O COMPOSER, NOS GESTOS QUE SÓ O DOM PROVA.
//
// A regra pura do composer (o gate do envio, a identidade efetiva, a
// precedência da permissão) tem teste unitário; a marcação em repouso é medida
// por `renderToStaticMarkup` nos `CommandConsole.*.test.tsx` e
// `ExecutionRow.permissao.test.tsx`. O que nenhum dos dois alcança é o GESTO:
// interagir com os seletores na barra inferior do composer, abrir os dropdowns
// flutuantes (Radix Popover) sem deforma visual do card, ligar/desligar o
// toggle "Planeja antes", e digitar no editor Lexical de verdade.
//
// Mede-se no `dist/` buildado (mesmo modelo do `painel-abas.spec.ts`). Fora do
// Tauri o app degrada pro caminho de demonstração — projeto seed, sem banco —,
// então o que se observa aqui é a UI e o store em memória, que é exatamente
// onde estes gestos moram. A gravação nas três camadas (store, SQLite,
// `.mycockpit/config.toml`) é assunto de `lib/permission.test.ts`.

const PERMISSAO_BTN = 'button[aria-label="Permissões do projeto"]'

async function abrirApp(page: Page) {
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
        version: 4,
      }),
    )
  })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.locator(PERMISSAO_BTN)).toBeVisible({ timeout: 10_000 })
}

// `menuitemradio`, não `radio`: é um item de RADIOGROUP DENTRO DE MENU
// (Radix `DropdownMenuRadioItem`), o papel ARIA correto pra essa combinação —
// `role="radio"` sozinho seria menu com semântica errada pro teclado/leitor
// de tela do Radix, que já gerencia isso pelo primitive certo.
const modo = (page: Page, nome: string) =>
  page.locator('[role="menuitemradio"]', { hasText: nome })

test("permissão e Planejar nascem visíveis; identidade nasce como UMA pílula de texto e abre no clique", async ({
  page,
}) => {
  await abrirApp(page)
  // Permissão e "Planejar" são os dois controles com sinal vivo (risco
  // autorizado; modificador por-turno sem dado de uso) — ficam sempre à
  // vista. Agent/modelo/esforço TRAVAM no 1º envio (medido: trocam em
  // 0,7%-1,2% dos turnos) — moram atrás de UMA porta, não quatro pílulas
  // com chrome próprio cada.
  await expect(page.locator(PERMISSAO_BTN)).toBeVisible()
  await expect(page.getByLabel("Planejar primeiro")).toBeVisible()
  await expect(page.getByLabel("Agent")).toHaveCount(0)
  await expect(page.getByLabel("Modelo")).toHaveCount(0)

  const identidade = page.locator('button[title="Agent, modelo e esforço"]')
  await expect(identidade).toBeVisible()
  // sem "(alias)" nem outro vocabulário de menu vazando pro repouso.
  await expect(identidade).not.toContainText("alias")

  await identidade.click()
  await expect(page.getByLabel("Agent")).toBeVisible()
  await expect(page.getByLabel("Modelo")).toBeVisible()
})

test("consegue selecionar e trocar a permissão do projeto", async ({
  page,
}) => {
  await abrirApp(page)
  const btn = page.locator(PERMISSAO_BTN)
  await expect(btn).toContainText("Pede") // default do seed é Pede

  await btn.click()
  const dropdownMenu = page.locator('[role="menu"]')
  await expect(dropdownMenu).toBeVisible()
  // a descrição de cada modo (não só o nome) precisa estar lá — é o que o
  // menu tem a mais do que o gatilho, e SSR não alcança (conteúdo portalizado).
  await expect(dropdownMenu).toContainText("O agente executa e escreve sem pedir confirmação")

  // seleciona o modo "Liberado"
  await modo(page, "Liberado").click()
  await expect(dropdownMenu).not.toBeVisible()
  await expect(btn).toContainText("Liberado")
})

test("Planejar primeiro liga e desliga no clique", async ({
  page,
}) => {
  await abrirApp(page)
  const toggle = page.getByLabel("Planejar primeiro")
  await expect(toggle).not.toHaveClass(/text-brass/)

  await toggle.click()
  await expect(toggle).toHaveClass(/text-brass/)

  await toggle.click()
  await expect(toggle).not.toHaveClass(/text-brass/)
})

test("o Enviar só acende quando há o que enviar", async ({ page }) => {
  // O editor é o Lexical de verdade (chunk lazy), e o rascunho passa pela store
  // antes de virar o `canSend`. É o caminho que a marcação estática não anda.
  await abrirApp(page)
  const enviar = page.getByRole("button", { name: "Enviar", exact: true })
  await expect(enviar).toBeDisabled()

  const editor = page.locator('[contenteditable="true"]').first()
  await editor.click()
  await editor.pressSequentially("roda os testes")
  await expect(enviar).toBeEnabled()

  // Só espaço em branco não é conteúdo: o mesmo `trim` do envio vale aqui.
  await page.keyboard.press("ControlOrMeta+a")
  await editor.pressSequentially("   ")
  await expect(enviar).toBeDisabled()
})

test("clicar no cartão devolve o foco ao editor, e clicar nos botões do rodapé NÃO", async ({
  page,
}) => {
  // Duas regras opostas na mesma caixa: o cartão inteiro é `cursor-text` e foca
  // o editor; os seletores do rodapé barram a propagação, senão interagir com os
  // dropdowns focaria o editor e fecharia o menu.
  await abrirApp(page)
  const editor = page.locator('[contenteditable="true"]').first()
  await page.locator('[aria-label="Anexar arquivo"]').hover()

  await editor.click()
  await expect(editor).toBeFocused()

  await page.locator(PERMISSAO_BTN).click()
  await expect(editor).not.toBeFocused()
})
