import { test, expect, type Page } from "@playwright/test"

// O COMPOSER, NOS GESTOS QUE SÓ O DOM PROVA.
//
// A regra pura do composer (o gate do envio, a identidade efetiva, a
// precedência da permissão) tem teste unitário; a marcação em repouso é medida
// por `renderToStaticMarkup` nos `CommandConsole.*.test.tsx`. O que nenhum dos
// dois alcança é o GESTO: clicar no segmented e ver o clima da janela acender,
// andar de modo com as setas (é um radiogroup, não três botões soltos), abrir a
// linha de identidade no chevron, e digitar no editor Lexical de verdade até o
// Enviar acender.
//
// Mede-se no `dist/` buildado (mesmo modelo do `painel-abas.spec.ts`). Fora do
// Tauri o app degrada pro caminho de demonstração — projeto seed, sem banco —,
// então o que se observa aqui é a UI e o store em memória, que é exatamente
// onde estes gestos moram. A gravação nas três camadas (store, SQLite,
// `.mycockpit/config.toml`) é assunto de `lib/permission.test.ts`.

const RADIOGROUP = '[aria-label="Permissões do projeto"]'
/** A moldura do clima (lib/climate: `CLIMATE_FRAME_CLASS`). */
const CLIMA = 'div[aria-hidden].ring-st-warning\\/30'

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
  await expect(page.locator(RADIOGROUP)).toBeVisible({ timeout: 10_000 })
}

const modo = (page: Page, nome: string) =>
  page.locator(`${RADIOGROUP} [role="radio"]`, { hasText: nome })

test("o modo Liberado acende o clima da janela inteira, e sair dele apaga", async ({
  page,
}) => {
  // A ligação de ponta a ponta que o `lib/climate` puro não prova: o segmented
  // do composer é o único lugar onde o modo se troca, e a moldura âmbar é a
  // promessa que o app faz na descrição do modo ("a tela inteira ganha moldura
  // âmbar"). Se o fio entre os dois arrebentar, o usuário libera a máquina e
  // nada na tela muda.
  await abrirApp(page)
  await expect(modo(page, "Pede")).toHaveAttribute("aria-checked", "true")
  await expect(page.locator(CLIMA)).toHaveCount(0)

  await modo(page, "Liberado").click()
  await expect(modo(page, "Liberado")).toHaveAttribute("aria-checked", "true")
  await expect(page.locator(CLIMA)).toHaveCount(1)

  // E o clima é autolimitado: só o modo perigoso acende.
  await modo(page, "Só lê").click()
  await expect(modo(page, "Só lê")).toHaveAttribute("aria-checked", "true")
  await expect(page.locator(CLIMA)).toHaveCount(0)
})

test("as setas andam entre os modos (é um radiogroup, não três botões soltos)", async ({
  page,
}) => {
  // O teclado é a única via de quem não usa mouse pra mexer no controle de
  // maior consequência do app. E o `stopPropagation` da faixa existe por causa
  // disto: sem ele o clique mandava o foco pro campo de texto e as setas
  // paravam de andar.
  await abrirApp(page)
  await modo(page, "Pede").focus()
  await page.keyboard.press("ArrowRight")
  await expect(modo(page, "Liberado")).toHaveAttribute("aria-checked", "true")
  await page.keyboard.press("ArrowLeft")
  await expect(modo(page, "Pede")).toHaveAttribute("aria-checked", "true")
  await page.keyboard.press("ArrowLeft")
  await expect(modo(page, "Só lê")).toHaveAttribute("aria-checked", "true")
  // Circular: da primeira posição, ← volta pra última.
  await page.keyboard.press("ArrowLeft")
  await expect(modo(page, "Liberado")).toHaveAttribute("aria-checked", "true")
})

test("a linha de identidade nasce fechada e abre no chevron", async ({ page }) => {
  await abrirApp(page)
  // Localizado pelo `title`: o nome acessível do botão é o RESUMO da identidade
  // ("Claude Code · Opus 5"), que muda com a escolha do usuário — o title é o
  // que descreve o controle.
  const chevron = page.locator(
    'button[title="Escolher agent, modelo e esforço"]',
  )
  await expect(chevron).toHaveAttribute("aria-expanded", "false")
  // Fechada, o resumo é o que aparece; os seletores crus não existem no DOM.
  await expect(page.getByLabel("Agent")).toHaveCount(0)
  await expect(page.getByLabel("Modelo")).toHaveCount(0)

  await chevron.click()
  await expect(chevron).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByLabel("Agent")).toBeVisible()
  await expect(page.getByLabel("Modelo")).toBeVisible()

  await chevron.click()
  await expect(chevron).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByLabel("Agent")).toHaveCount(0)
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

test("clicar no cartão devolve o foco ao editor, e clicar na faixa NÃO", async ({
  page,
}) => {
  // Duas regras opostas na mesma caixa: o cartão inteiro é `cursor-text` e foca
  // o editor; a faixa de execução barra a propagação, senão mexer na permissão
  // roubava o foco e matava as setas do radiogroup.
  await abrirApp(page)
  const editor = page.locator('[contenteditable="true"]').first()
  await page.locator('[aria-label="Anexar arquivo"]').hover()

  await editor.click()
  await expect(editor).toBeFocused()

  await modo(page, "Liberado").click()
  await expect(editor).not.toBeFocused()
})
