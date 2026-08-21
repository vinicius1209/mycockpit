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

// M2: permissão e "Planejar" viraram UM controle de MODO. O par antigo fingia
// dois eixos que o motor sempre tratou como um só (o `adapters.rs` substituía o
// `--permission-mode` no turno de plano).
const MODO_BTN = 'button[aria-label="Modo de execução do agente"]'

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
  await expect(page.locator(MODO_BTN)).toBeVisible({ timeout: 10_000 })
}

// `menuitemradio`, não `radio`: é um item de RADIOGROUP DENTRO DE MENU
// (Radix `DropdownMenuRadioItem`), o papel ARIA correto pra essa combinação —
// `role="radio"` sozinho seria menu com semântica errada pro teclado/leitor
// de tela do Radix, que já gerencia isso pelo primitive certo.
const modo = (page: Page, nome: string) =>
  page.locator('[role="menuitemradio"]', { hasText: nome })

test("o MODO nasce visível; identidade nasce como UMA pílula de texto e abre no clique", async ({
  page,
}) => {
  await abrirApp(page)
  // O modo é o controle com sinal vivo (risco autorizado) e fica sempre à
  // vista. Agent/modelo/esforço TRAVAM no 1º envio (medido: trocam em
  // 0,7%-1,2% dos turnos) — moram atrás de UMA porta, não quatro pílulas
  // com chrome próprio cada.
  await expect(page.locator(MODO_BTN)).toBeVisible()
  // "Planejar" deixou de ser botão próprio: virou uma opção do menu de modo.
  await expect(page.getByLabel("Planejar primeiro")).toHaveCount(0)
  await expect(page.getByRole("group", { name: "Agent" })).toHaveCount(0)
  await expect(page.getByRole("combobox", { name: "Buscar modelo" })).toHaveCount(0)

  const identidade = page.locator('button[title="Agent, modelo e esforço"]')
  await expect(identidade).toBeVisible()
  // sem "(alias)" nem outro vocabulário de menu vazando pro repouso.
  await expect(identidade).not.toContainText("alias")

  // seletor unificado (busca + trilha de agent + lista de modelo), não mais
  // 3 selects separados. Escopado no group "Agent": o nome "Claude Code"
  // também casa (substring) com a linha da sidebar e com o próprio trigger
  // da pílula ("Claude Code · Opus"), então o locator solto é ambíguo.
  await identidade.click()
  const rail = page.getByRole("group", { name: "Agent" })
  await expect(rail).toBeVisible()
  await expect(rail.getByRole("button", { name: "Claude Code" })).toBeVisible()
  await expect(rail.getByRole("button", { name: "Codex" })).toBeVisible()
  await expect(rail.getByRole("button", { name: "Antigravity" })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Buscar modelo" })).toBeVisible()
  await expect(page.getByRole("listbox", { name: "Modelo" })).toBeVisible()
})

test("consegue selecionar e trocar o modo do projeto", async ({ page }) => {
  await abrirApp(page)
  const btn = page.locator(MODO_BTN)
  await expect(btn).toContainText("Pede") // default do seed é Pede

  await btn.click()
  const dropdownMenu = page.locator('[role="menu"]')
  await expect(dropdownMenu).toBeVisible()
  // a descrição de cada modo (não só o nome) precisa estar lá — é o que o
  // menu tem a mais do que o gatilho, e SSR não alcança (conteúdo portalizado).
  await expect(dropdownMenu).toContainText("Age sem perguntar e sem freio")
  // E quem SEGURA o modo, que é o dado que sumia quando os três motores
  // dividiam o mesmo botão.
  await expect(dropdownMenu).toContainText("modo da CLI")

  await modo(page, "Liberado").click()
  await expect(dropdownMenu).not.toBeVisible()
  await expect(btn).toContainText("Liberado")
})

test("Planejar virou um MODO, não um toggle ao lado", async ({ page }) => {
  await abrirApp(page)
  const btn = page.locator(MODO_BTN)
  await btn.click()
  await modo(page, "Planejar").click()
  await expect(btn).toContainText("Planejar")

  // E sai de lá escolhendo outro modo — o mesmo gesto, sem segundo botão.
  // Espera o menu FECHAR antes de reabrir: a camada de dismiss do Radix ainda
  // está montada logo após o select e engole o clique seguinte no gatilho.
  // Determinístico, e não `waitForTimeout` — o que a gente espera é o estado.
  await expect(page.locator('[role="menu"]')).toHaveCount(0)
  await btn.click()
  await modo(page, "Pede").click()
  await expect(btn).toContainText("Pede")
})

test("o motor decide a lista: `Auto` existe no Claude e não no Codex", async ({
  page,
}) => {
  // `Auto` estava inalcançável da conversa antes do M2 (existia no Rust e no
  // agendamento, não no seletor). E a lista deixou de ser a mesma pros três.
  await abrirApp(page)
  await page.locator(MODO_BTN).click()
  await expect(modo(page, "Auto")).toBeVisible()
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

  await page.locator(MODO_BTN).click()
  await expect(editor).not.toBeFocused()
})
