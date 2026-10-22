/**
 * La firma del servicio `apartar` no tiene campo de mesa ni de puesto (Sabor no asigna puestos; alcance del 2026-10-22).
 *
 * Vive en `src/` y no junto al servicio a propósito: `tsc` (job «Tipos y pruebas») revisa `src/` y lo que importa,
 * y `supabase/functions/` queda fuera de su tsconfig. Si alguien le agrega `mesaId` o `puesto` a `PropuestaApartado`, el
 * `@ts-expect-error` de abajo deja de tener error y `tsc` falla. La mitad de la base (`dato_no_admitido` y
 * que ninguna tabla tenga dónde guardarla) está en `funciones-sql.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import type { PropuestaApartado } from '../../../supabase/functions/_shared/funciones/tipos.ts'

describe('la propuesta de apartado no lleva mesa', () => {
  it('un literal con mesa no compila', () => {
    const p: PropuestaApartado = {
      llave: { workspaceId: '00000000-0000-4000-8000-000000000001', cuentaId: 1, conversacionId: 2 },
      canal: 'instagram',
      funcionId: '00000000-0000-4000-8000-000000000002',
      personas: 2,
      nombre: 'Ana',
      documento: null,
      telefono: null,
      contactoCanal: null,
      solicitudCliente: 'vamos 6, queremos estar juntos',
      huellaPropuesta: 'h',
      // @ts-expect-error la propuesta no tiene campo de mesa
      mesaId: '00000000-0000-4000-8000-000000000003',
    }
    expect(p.solicitudCliente).toBe('vamos 6, queremos estar juntos')
  })

  it('un literal con puesto tampoco compila', () => {
    const p: PropuestaApartado = {
      llave: { workspaceId: '00000000-0000-4000-8000-000000000001', cuentaId: 1, conversacionId: 2 },
      canal: 'instagram',
      funcionId: '00000000-0000-4000-8000-000000000002',
      personas: 2,
      nombre: null,
      documento: null,
      telefono: null,
      contactoCanal: null,
      solicitudCliente: null,
      huellaPropuesta: 'h',
      // @ts-expect-error la propuesta no tiene campo de puesto
      puesto: 'F1',
    }
    expect(p.personas).toBe(2)
  })
})
