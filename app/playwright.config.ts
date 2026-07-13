import { defineConfig, devices } from "@playwright/test"

// SMOKE-TEST de boot: sobe o app BUILDADO (dist/) via `vite preview` e checa
// que ele RENDERIZA num browser puro (fora do Tauri, isTauri()=false → degrada
// pro caminho não-Tauri com projetos seed). Pega a classe de bug que unit test
// NÃO pega: tela preta / crash de render / loop de useSyncExternalStore.
export default defineConfig({
  testDir: "./e2e",
  // Um retry no CI absorve flake de porta/servidor; local roda direto.
  retries: process.env.CI ? 1 : 0,
  // Um worker: é 1 smoke-test, sem paralelismo pra economizar.
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  // Teto por teste. Um loop de render nunca "estabiliza" → estoura aqui.
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Builda e serve o app real (dist/) antes de rodar. `preview` = vite preview,
  // porta 4173 (default do vite preview). Reusa server local, sobe do zero no CI.
  webServer: {
    command: "bun run build && bun run preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
