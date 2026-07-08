import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Config mínima para tests unitarios de helpers puros (sin DOM, sin Next).
// Los tests viven junto al código (`*.test.ts`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
