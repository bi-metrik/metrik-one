/**
 * La firma del servicio `apartar` no tiene campo de mesa, de puesto ni de monto: Sabor no asigna puestos (alcance del
 * 2026-10-22) y el monto lo calcula la base («Todo sale y vuelve a ONE», Mauricio 2026-10-22). Tampoco tiene modalidad
 * desde el 2026-10-25 (P14b): el cliente elige total o solo la reserva al pagar, en `generar_link_pago`.
 *
 * Vive en `src/` y no junto al servicio a propósito: `tsc` (job «Tipos y pruebas») revisa `src/` y lo que importa,
 * y `supabase/functions/` queda fuera de su tsconfig. Si alguien le agrega `mesaId`, `puesto` o `montoTotal` a
 * `PropuestaApartado`, el `@ts-expect-error` correspondiente deja de tener error y `tsc` falla. La mitad de la base
 * (`dato_no_admitido` para esas claves) está en `funciones-sql.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import type { PropuestaApartado } from '../../../supabase/functions/_shared/funciones/tipos.ts'

const base: PropuestaApartado = {
  llave: { workspaceId: '00000000-0000-4000-8000-000000000001', cuentaId: 1, conversacionId: 2 },
  canal: 'instagram',
  funcionId: '00000000-0000-4000-8000-000000000002',
  personas: 2,
  nombre: 'Ana',
  documento: null,
  telefono: null,
  contactoCanal: null,
  solicitudCliente: 'vamos 6, queremos estar juntos',
  atribucion: { fuente: 'anuncio', ref: null },
  huellaPropuesta: 'h',
}

describe('la propuesta de apartado no lleva mesa, puesto, monto ni modalidad', () => {
  it('un literal con mesa no compila', () => {
    const p: PropuestaApartado = {
      ...base,
      // @ts-expect-error la propuesta no tiene campo de mesa
      mesaId: '00000000-0000-4000-8000-000000000003',
    }
    expect(p.solicitudCliente).toBe('vamos 6, queremos estar juntos')
  })

  it('un literal con puesto tampoco compila', () => {
    const p: PropuestaApartado = {
      ...base,
      // @ts-expect-error la propuesta no tiene campo de puesto
      puesto: 'F1',
    }
    expect(p.personas).toBe(2)
  })

  it('un literal con monto tampoco compila: el monto lo calcula la base', () => {
    const p: PropuestaApartado = {
      ...base,
      // @ts-expect-error la propuesta no tiene campo de monto
      montoTotal: 360_000,
    }
    expect(p.huellaPropuesta).toBe('h')
  })

  it('P14b: un literal con modalidad tampoco compila; se elige al pagar', () => {
    const p: PropuestaApartado = {
      ...base,
      // @ts-expect-error la propuesta no tiene modalidad (va en generar_link_pago)
      modalidad: 'abono',
    }
    expect(p.personas).toBe(2)
  })
})
