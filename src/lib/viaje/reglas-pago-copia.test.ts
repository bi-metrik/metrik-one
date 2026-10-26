/**
 * La regla del pago a proveedor es UNA (Vera C12): el bot de WhatsApp (Deno) aplica la misma
 * que la pantalla. Deno no resuelve `@/lib`, así que vive copiada en `_shared/`; esta prueba
 * corre en CI y falla si las dos copias se separan (precedente: `texto-latino.ts`).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..', '..', '..')

describe('reglas-pago: la copia de Deno no se separa', () => {
  it('supabase/functions/_shared/reglas-pago.ts es idéntica a src/lib/viaje/reglas-pago.ts', () => {
    const fuente = readFileSync(join(RAIZ, 'src/lib/viaje/reglas-pago.ts'), 'utf8')
    const copia = readFileSync(join(RAIZ, 'supabase/functions/_shared/reglas-pago.ts'), 'utf8')
    expect(copia).toBe(fuente)
  })

  it('la pieza no importa nada (Deno no resuelve @/lib)', () => {
    const fuente = readFileSync(join(RAIZ, 'src/lib/viaje/reglas-pago.ts'), 'utf8')
    expect(fuente).not.toMatch(/^import /m)
  })
})
