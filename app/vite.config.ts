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
