import { expect, test, type Page } from "@playwright/test"
import {
  cameraTransform,
  fitIsometricRoom,
  worldToScreenWith,
} from "../src/office/scene/logic"

const EVIDENCE_DIR = "artifacts/office-evidence"
const ROOM_FIT_OPTIONS = {
  insets: { top: 44, right: 0, bottom: 24, left: 0 },
  extents: { top: 104, right: 16, bottom: 24, left: 16 },
  padding: 24,
  maxZoom: 1.25,
}

function fittedRoomPoint(
  viewport: { w: number; h: number },
  room: { w: number; h: number },
  point: { x: number; y: number },
) {
  const fit = fitIsometricRoom(
    { origin: { x: 0, y: 0 }, ...room },
    viewport,
    ROOM_FIT_OPTIONS,
  )
  return worldToScreenWith(
    cameraTransform(
      fit.target,
      fit.zoom,
      viewport.w,
      viewport.h,
      fit.screenOffset,
    ),
    point.x,
    point.y,
  )
}

async function enterOffice(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "mc.app",
      JSON.stringify({
        state: {
          theme: "dark",
          // rail do escritório vive no Sidebar desde a limpeza de redundância
          // (jul/2026): a navegação por salas do teste depende dele aberto.
          sidebarOpen: true,
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
  await expect(page.getByTestId("office-canvas").locator("canvas")).toBeVisible()
}

test("o escritório renderiza a planta e abre uma mesa sem sobrepor seu rótulo", async ({
  page,
}) => {
  test.setTimeout(70_000)
  await enterOffice(page)

  await page.screenshot({
    path: `${EVIDENCE_DIR}/01-office-overview.png`,
    fullPage: true,
  })

  // Centraliza a sala de projeto vizinha à diretoria. Isso mantém o percurso
  // real do boss, mas evita que a estabilidade do teste dependa de atravessar
  // toda a ala em um renderer headless com poucos FPS. A navegação por salas
  // mora no rail do Sidebar ("Ir até a sala …") desde a limpeza da
  // redundância do topo do escritório.
  await page
    .getByRole("button", { name: "Ir até a sala Lab de ideias" })
    .click()
  await page.waitForTimeout(1_800)

  const box = await page.getByTestId("office-canvas").boundingBox()
  expect(box).not.toBeNull()
  const deskPoint = fittedRoomPoint(
    { w: box!.width, h: box!.height },
    { w: 12, h: 8 },
    { x: 2, y: 2.5 },
  )
  await page.mouse.click(
    box!.x + deskPoint.x,
    box!.y + deskPoint.y,
  )

  const menu = page.getByTestId("desk-menu")
  await expect(menu).toBeVisible({ timeout: 20_000 })
  await expect(menu.getByRole("button", { name: /Conversar|Abrir|Responder|Acompanhar/ })).toBeVisible()

  await page.screenshot({
    path: `${EVIDENCE_DIR}/02-desk-menu.png`,
    fullPage: true,
  })

  await menu.getByRole("button", { name: /Conversar|Abrir|Responder|Acompanhar/ }).click()
  await expect(page.getByText("Próximo turno", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: "Modelo do próximo turno" }),
  ).toBeVisible()
  await expect(
    page.getByRole("combobox", {
      name: "Esforço de raciocínio do próximo turno",
    }),
  ).toBeVisible()

  await page.screenshot({
    path: `${EVIDENCE_DIR}/03-model-effort-dock.png`,
    fullPage: true,
  })

  await page.getByRole("button", { name: "Fechar conversa" }).click()
  await page.getByRole("button", { name: "Ir até a Sala comum" }).click()
  // Selecionar uma sala conclui o enquadramento no mesmo frame; um pequeno
  // intervalo deixa o WebGL apresentar o frame antes da evidência/clique.
  await page.waitForTimeout(250)

  const commonsBox = await page.getByTestId("office-canvas").boundingBox()
  expect(commonsBox).not.toBeNull()
  await page.screenshot({
    path: `${EVIDENCE_DIR}/04-commons-preclick.png`,
    fullPage: true,
  })
  const missionPoint = fittedRoomPoint(
    { w: commonsBox!.width, h: commonsBox!.height },
    { w: 12, h: 9 },
    { x: 6, y: 4 },
  )
  await page.mouse.click(
    commonsBox!.x + missionPoint.x,
    commonsBox!.y + missionPoint.y,
  )
  await expect(page.getByTestId("mission-table-menu")).toBeVisible({
    // O avatar parte da primeira sala e atravessa também a coluna da
    // diretoria; o teste valida o percurso real em vez de teleportar.
    timeout: 35_000,
  })

  await page.screenshot({
    path: `${EVIDENCE_DIR}/04-commons-interaction.png`,
    fullPage: true,
  })
})
