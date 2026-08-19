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
      // Marcadores que Next resuelve con un alias interno y que no existen en
      // node_modules. Sin esto, cualquier prueba que arrastre un modulo de
      // servidor falla al COLECTAR, no al ejecutar. Ver test/modulo-vacio.ts
      'server-only': path.resolve(__dirname, 'test/modulo-vacio.ts'),
      'client-only': path.resolve(__dirname, 'test/modulo-vacio.ts'),
    },
  },
})
