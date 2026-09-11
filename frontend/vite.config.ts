import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'

/**
 * The commit this bundle was built from.
 *
 * Vite inlines VITE_* at build time, so a pushed commit changes nothing until Vercel
 * rebuilds. Stamping the commit into the page makes that drift visible instead of
 * leaving the site quietly serving an older build. Vercel exposes the sha as an
 * environment variable; the git call is the local fallback.
 */
function buildCommit(): string {
  const fromCi = process.env.VERCEL_GIT_COMMIT_SHA
  if (fromCi) return fromCi.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
  },
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
