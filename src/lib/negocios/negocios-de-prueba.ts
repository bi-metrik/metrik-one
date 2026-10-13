/**
 * Negocios de prueba (`negocios.metadata.es_prueba = true`) fuera de las listas del equipo real.
 *
 * El viaje de prueba de punta a punta (post-cotización F8, Vera C14 y F8-1) corre en el workspace
 * REAL del cliente, sobre una línea clon inactiva. Ese negocio no puede aparecer en la lista de
 * negocios de quien no participa en la prueba: solo lo ven sus responsables (las cuentas de prueba
 * CP y OP) y los aprobadores de SU línea (`config_extra.aprobaciones.staff_ids`, la cuenta de
 * prueba DP en el clon). El detalle por URL no cambia: esto es la lista, no un permiso.
 *
 * Sin negocios de prueba en la página, no lee nada más (cero costo para SOENA y los demás).
 */

import { aprobadoresDeConfig } from '@/lib/recordatorios/reglas'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export function esNegocioDePrueba(metadata: unknown): boolean {
  return !!metadata && typeof metadata === 'object' && (metadata as { es_prueba?: unknown }).es_prueba === true
}

/** Staff ids de los responsables embebidos (`negocio_responsables(staff:staff(id))`). */
function responsablesDe(fila: { negocio_responsables?: unknown }): string[] {
  const nr = Array.isArray(fila.negocio_responsables) ? fila.negocio_responsables : []
  return nr
    .map((r) => (r as { staff?: { id?: unknown } | null; staff_id?: unknown } | null))
    .map((r) => (typeof r?.staff?.id === 'string' ? r.staff.id : typeof r?.staff_id === 'string' ? r.staff_id : null))
    .filter((x): x is string => !!x)
}

/**
 * Puro. Deja los negocios reales y, de los de prueba, solo los que la persona lleva o aprueba.
 * Sin `staffId` (una sesión sin ficha de staff) no ve ninguno de prueba.
 */
export function filtrarNegociosDePrueba<T extends { metadata?: unknown; linea_id?: unknown; negocio_responsables?: unknown }>(
  filas: readonly T[],
  quien: { staffId: string | null; aprobadoresPorLinea: ReadonlyMap<string, readonly string[]> },
): T[] {
  return filas.filter((f) => {
    if (!esNegocioDePrueba(f.metadata)) return true
    if (!quien.staffId) return false
    if (responsablesDe(f).includes(quien.staffId)) return true
    const linea = typeof f.linea_id === 'string' ? f.linea_id : ''
    return (quien.aprobadoresPorLinea.get(linea) ?? []).includes(quien.staffId)
  })
}

/** Lee los aprobadores de las líneas de los negocios de prueba (solo si hay alguno) y filtra. */
export async function sinNegociosDePruebaAjenos<T extends { metadata?: unknown; linea_id?: unknown; negocio_responsables?: unknown }>(
  supabase: Db,
  workspaceId: string,
  staffId: string | null,
  filas: readonly T[],
): Promise<T[]> {
  const deprueba = filas.filter((f) => esNegocioDePrueba(f.metadata))
  if (deprueba.length === 0) return [...filas]
  const lineaIds = [...new Set(deprueba.map((f) => (typeof f.linea_id === 'string' ? f.linea_id : '')).filter(Boolean))]
  const aprobadoresPorLinea = new Map<string, string[]>()
  if (staffId && lineaIds.length > 0) {
    const { data, error } = await supabase
      .from('lineas_negocio')
      .select('id, config_extra')
      .eq('workspace_id', workspaceId)
      .in('id', lineaIds)
    // Sin poder leer los aprobadores, el negocio de prueba no se muestra (el error no abre la lista).
    if (error) console.error('[negocios de prueba] no se pudieron leer los aprobadores:', error.message)
    for (const l of (data ?? []) as Array<{ id: string; config_extra: unknown }>) {
      aprobadoresPorLinea.set(l.id, aprobadoresDeConfig(l.config_extra))
    }
  }
  return filtrarNegociosDePrueba(filas, { staffId, aprobadoresPorLinea })
}
