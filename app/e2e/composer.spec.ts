import { test, expect, type Page } from "@playwright/test"

// O COMPOSER, NOS GESTOS QUE SÓ O DOM PROVA.
//
// A regra pura do composer (o gate do envio, a identidade efetiva, a
// precedência da permissão) tem teste unitário; a marcação em repouso é medida
// por `renderToStaticMarkup` nos `CommandConsole.*.test.tsx` e
// `ExecutionRow.permissao.test.tsx`. O que nenhum dos dois alcança é o GESTO:
// abrir o painel no letreiro, andar de modo com as setas dentro dele (é um
// radiogroup, não três botões soltos), ligar "Planeja antes", e digitar no
// editor Lexical de verdade até o Enviar acender.
//
// Mede-se no `dist/` buildado (mesmo modelo do `painel-abas.spec.ts`). Fora do
// Tauri o app degrada pro caminho de demonstração — projeto seed, sem banco —,
// então o que se observa aqui é a UI e o store em memória, que é exatamente
// onde estes gestos moram. A gravação nas três camadas (store, SQLite,
// `.mycockpit/config.toml`) é assunto de `lib/permission.test.ts`.

const LETREIRO = 'button[aria-label="Como o próximo turno roda"]'
const RADIOGROUP = '[aria-label="Permissões do projeto"]'

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
  await expect(page.locator(LETREIRO)).toBeVisible({ timeout: 10_000 })
}

const modo = (page: Page, nome: string) =>
  page.locator(`${RADIOGROUP} [role="radio"]`, { hasText: nome })

test("o painel nasce fechado e abre no letreiro, com os três blocos dentro", async ({
  page,
}) => {
  await abrirApp(page)
  const letreiro = page.locator(LETREIRO)
  await expect(letreiro).toHaveAttribute("aria-expanded", "false")
  // Fechado: nem a permissão, nem "Planeja antes", nem os seletores crus
  // existem no DOM — o único sinal de fora é o modo escrito no próprio letreiro.
  await expect(page.locator(RADIOGROUP)).toHaveCount(0)
  await expect(page.getByRole("switch", { name: "Planejar primeiro" })).toHaveCount(0)
  await expect(page.getByLabel("Agent")).toHaveCount(0)
  await expect(page.getByLabel("Modelo")).toHaveCount(0)

  await letreiro.click()
  await expect(letreiro).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator(RADIOGROUP)).toBeVisible()
  await expect(page.getByRole("switch", { name: "Planejar primeiro" })).toBeVisible()
  await expect(page.getByLabel("Agent")).toBeVisible()
  await expect(page.getByLabel("Modelo")).toBeVisible()

  await letreiro.click()
  await expect(letreiro).toHaveAttribute("aria-expanded", "false")
  await expect(page.locator(RADIOGROUP)).toHaveCount(0)
})

test("as setas andam entre os modos (é um radiogroup, não três botões soltos)", async ({
  page,
}) => {
  // O teclado é a única via de quem não usa mouse pra mexer no controle de
  // maior consequência do app. E o `stopPropagation` da faixa existe por causa
  // disto: sem ele o clique mandava o foco pro campo de texto e as setas
  // paravam de andar.
  await abrirApp(page)
  await page.locator(LETREIRO).click()
  await modo(page, "Pede").focus()
  await page.keyboard.press("ArrowDown")
  await expect(modo(page, "Liberado")).toHaveAttribute("aria-checked", "true")
  await page.keyboard.press("ArrowUp")
  await expect(modo(page, "Pede")).toHaveAttribute("aria-checked", "true")
  await page.keyboard.press("ArrowUp")
  await expect(modo(page, "Só lê")).toHaveAttribute("aria-checked", "true")
  // Circular: da primeira posição, ↑ volta pra última.
  await page.keyboard.press("ArrowUp")
  await expect(modo(page, "Liberado")).toHaveAttribute("aria-checked", "true")
  // ←/→ continuam funcionando (compatibilidade com o segmented horizontal
  // antigo, que usava as mesmas teclas).
  await page.keyboard.press("ArrowLeft")
  await expect(modo(page, "Pede")).toHaveAttribute("aria-checked", "true")
})

test("Planeja antes liga e desliga no clique, e sobrevive a trocar de permissão", async ({
  page,
}) => {
  // O único controle do painel que é POR TURNO (não por conversa) e que não
  // persiste em lugar nenhum (`store/chat.ts`, sem `persist`) — furo aberto no
  // plano do colapso (docs/mocks/composer-README.md §7.1): sem nenhum teste,
  // clicar aqui nunca foi provado.
  await abrirApp(page)
  await page.locator(LETREIRO).click()
  const toggle = page.getByRole("switch", { name: "Planejar primeiro" })
  await expect(toggle).toHaveAttribute("aria-checked", "false")

  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-checked", "true")
  // O letreiro ganha o rastro (ícone) mesmo depois de fechar o painel — é o
  // único jeito de lembrar que um modificador por-turno está ligado.
  await page.locator(LETREIRO).click() // fecha
  await expect(
    page.locator(`${LETREIRO} [aria-label="Planeja antes ligado"]`),
  ).toBeVisible()

  // Mexer noutro controle do mesmo painel (a permissão) não derruba o toggle:
  // são dois estados independentes, não um raio-x da última interação.
  await page.locator(LETREIRO).click() // reabre
  await modo(page, "Liberado").click()
  await expect(toggle).toHaveAttribute("aria-checked", "true")

  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-checked", "false")
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

test("clicar no cartão devolve o foco ao editor, e clicar no letreiro NÃO", async ({
  page,
}) => {
  // Duas regras opostas na mesma caixa: o cartão inteiro é `cursor-text` e foca
  // o editor; a faixa de execução barra a propagação, senão abrir o painel
  // roubava o foco e fechava ele sozinho.
  await abrirApp(page)
  const editor = page.locator('[contenteditable="true"]').first()
  await page.locator('[aria-label="Anexar arquivo"]').hover()

  await editor.click()
  await expect(editor).toBeFocused()

  await page.locator(LETREIRO).click()
  await expect(editor).not.toBeFocused()
})
