/**
 * Prueba 16 del diseño de la etapa 2, la mitad de TIPOS: la firma del servicio `apartar` no tiene campo de mesa.
 *
 * Vive en `src/` y no junto al servicio a propósito: `tsc` (job «Tipos y pruebas») revisa `src/` y lo que importa,
 * y `supabase/functions/` queda fuera de su tsconfig. Si alguien le agrega `mesaId` a `PropuestaApartado`, el
 * `@ts-expect-error` de abajo deja de tener error y `tsc` falla. La mitad de la base (`dato_no_admitido` y
 * `funcion_asignar_mesas` sin EXECUTE para service_role) está en `funciones-sql.test.ts`.
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
      preferenciaMesa: 'cerca de la pantalla',
      huellaPropuesta: 'h',
      // @ts-expect-error la propuesta no tiene campo de mesa: la asigna el equipo en ONE
      mesaId: '00000000-0000-4000-8000-000000000003',
    }
    expect(p.preferenciaMesa).toBe('cerca de la pantalla')
  })
})
