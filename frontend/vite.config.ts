import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    tailwindcss(),
    // Fluff has no server logic: every read is an RPC call from the browser and every
    // write is signed by the visitor's wallet. Building as a prerendered SPA keeps the
    // deployment a static bundle with nothing to run or keep warm.
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
