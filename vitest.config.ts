import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Config mínima para tests unitarios de helpers puros (sin DOM, sin Next).
// Los tests viven junto al código (`*.test.ts`).
export default defineConfig({
  test: {
    environment: 'node',
    // `supabase/functions/**` entra aqui a proposito: hasta hoy las edge functions no las
    // verificaba ningun check de CI (solo `deno check` a mano). Solo se recogen modulos
    // PUROS — los que tocan `Deno.env` o la red no se pueden colectar desde node.
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
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
