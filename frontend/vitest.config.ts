import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// The unit suite covers pure logic — phase derivation, payout maths, the transaction
// lifecycle — so it needs no framework plugins and no browser environment.
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
