/**
 * Doble de `@/lib/modulos/exigir-modulo` para las pruebas de acciones.
 *
 * No es un "siempre sí": aplica el criterio REAL (`cumpleRequisitoModulo`) sobre los módulos
 * que la prueba declare, así que una prueba que diga "4D SOFT" prueba lo que de verdad haría
 * la acción con los `modules` de 4D SOFT. La lectura de la base, que es lo único que se
 * sustituye, la prueba `src/lib/modulos/exigir-modulo.test.ts`.
 *
 * Uso:
 *   vi.mock('@/lib/modulos/exigir-modulo', async () =>
 *     (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())
 *   import { estadoModulo, MODULES } from '../../../test/exigir-modulo-doble'
 *   estadoModulo.modules = MODULES.cuatroDSoft
 */

import type { RequisitoModulo } from '@/lib/modulos/requisito'

/** `modules` medidos en producción el 2026-09-16 (lectura por PostgREST). */
export const MODULES = {
  cuatroDSoft: { valida_api: true },
  cda: { valida_consulta: true },
  afi: { business: true, valida_consulta: true },
  almaAfi: { compliance: true, compliance_vinculacion: true, compliance_dual_informa: true },
  soena: { business: true, fab_pago_epayco: true, fab_registrar_pago: true },
  termotech: { business: true, fab_registrar_pago: true },
  metrik: { business: true, valida_consulta: true, compliance_audit: true },
} as const satisfies Record<string, Record<string, boolean>>

export const estadoModulo: {
  workspaceId: string | null
  modules: Record<string, boolean> | null
  platformAdmin: boolean
  llamadas: RequisitoModulo[]
} = { workspaceId: 'ws-1', modules: { business: true }, platformAdmin: false, llamadas: [] }

export function reiniciarModulo(workspaceId: string, modules: Record<string, boolean> | null) {
  estadoModulo.workspaceId = workspaceId
  estadoModulo.modules = modules
  estadoModulo.platformAdmin = false
  estadoModulo.llamadas.length = 0
}

export async function dobleExigirModulo() {
  const { REQUISITO, cumpleRequisitoModulo } = await import('@/lib/modulos/requisito')
  return {
    REQUISITO,
    MENSAJE_MODULO_NO_ACTIVO: 'Este espacio no tiene activo el módulo que usa esta acción.',
    exigirModulo: async (req: RequisitoModulo) => {
      estadoModulo.llamadas.push(req)
      if (!estadoModulo.workspaceId) return { ok: false as const, error: 'no_autenticado' as const }
      const ok = cumpleRequisitoModulo(req, {
        modules: estadoModulo.modules,
        platformAdmin: estadoModulo.platformAdmin,
        modoVitrina: false,
      })
      return ok
        ? { ok: true as const, workspaceId: estadoModulo.workspaceId }
        : { ok: false as const, error: 'modulo_no_activo' as const }
    },
  }
}
