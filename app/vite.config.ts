/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Dois entries: a janela principal (index.html → main.tsx, o App) e o popover
  // da tray (tray.html → tray.tsx, só o TrayPopover). O webview escondido para
  // de bootar o grafo inteiro do App.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tray: fileURLToPath(new URL('./tray.html', import.meta.url)),
      },
    },
  },
  // Vitest (unit) NÃO deve coletar os specs de e2e/ — eles usam a API do
  // @playwright/test, não a do vitest, e falhariam na coleção. O smoke-test de
  // boot roda via `bun run test:e2e` (playwright), não pelo `bun run test`.
  //
  // O `include` existe por causa das guardas de estilo (STYLEGUIDE §10): os
  // scripts de lint moram em `../scripts/` (fora da raiz do vitest) e os testes
  // dos núcleos puros deles precisam entrar no MESMO `bun run test`, senão
  // viram teste órfão que ninguém roda. O primeiro padrão repete o alcance
  // default dentro de `src/`.
  test: {
    include: [
      "src/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "../scripts/**/*.{test,spec}.?(c|m)[jt]s?(x)",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    // Drena o trabalho de fundo no fim de CADA teste (src/test/setup.ts). É o
    // que impede uma promessa disparada com `void` de acordar depois do
    // teardown do ambiente — o EnvironmentTeardownError que deixava o CI
    // vermelho de forma intermitente enquanto a suíte passava no Mac.
    setupFiles: ["./src/test/setup.ts"],
  },
  // Tauri expects a fixed dev port and doesn't need to clear the screen.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Vite doesn't need to watch the Rust side.
      ignored: ['**/src-tauri/**'],
    },
  },
})
