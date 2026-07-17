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
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
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
