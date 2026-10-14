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

/**
 * Los ids de los negocios de prueba del workspace que esta persona NO lleva ni aprueba (F8-1).
 *
 * Para los agregados y las colas que no leen la fila del negocio con sus responsables (cola de
 * facturación, recibos pendientes, tableros, cifras de /numeros, cartera): se resta este conjunto
 * de lo que cada una suma o lista. Una consulta acotada a `metadata->>es_prueba = 'true'`: en un
 * workspace sin negocios de prueba devuelve vacío y no lee nada más.
 *
 * Sin `staffId` (un cron, una sesión sin ficha de staff) todos los de prueba quedan ocultos.
 * Si la lectura falla, LANZA: un agregado que no pudo restar la prueba parece entero (mismo
 * criterio de la cola de facturación, que no se degrada a una bandeja corta).
 */
export async function negociosDePruebaOcultos(supabase: Db, workspaceId: string, staffId: string | null): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('negocios')
    .select('id, metadata, linea_id, negocio_responsables(staff_id)')
    .eq('workspace_id', workspaceId)
    .eq('metadata->>es_prueba', 'true')
  if (error) throw new Error(`No se pudieron leer los negocios de prueba: ${error.message}`)
  const deprueba = ((data ?? []) as Array<{ id: string; metadata?: unknown; linea_id?: unknown; negocio_responsables?: unknown }>)
    .filter((f) => esNegocioDePrueba(f.metadata))
  if (deprueba.length === 0) return new Set()
  const visibles = new Set((await sinNegociosDePruebaAjenos(supabase, workspaceId, staffId, deprueba)).map((f) => f.id))
  return new Set(deprueba.filter((f) => !visibles.has(f.id)).map((f) => f.id))
}

/**
 * Avisos a staff (crons de inactividad, etapas por fecha): del negocio de prueba solo se enteran sus
 * responsables y los aprobadores de su línea, nunca el respaldo del área, el supervisor ni el owner
 * (F8-1: «ni Edgar, ni Alejandra, ni las comerciales reales reciben nada»). Un negocio real pasa
 * sin cambios y sin leer nada. Recibe y devuelve `profile_id`.
 */
export async function avisoSoloAQuienLleva(
  svc: Db,
  negocio: { id: string; workspace_id: string; linea_id?: string | null; metadata?: unknown },
  perfiles: Iterable<string>,
): Promise<string[]> {
  const todos = [...perfiles]
  if (!esNegocioDePrueba(negocio.metadata) || todos.length === 0) return todos
  const [resp, linea] = await Promise.all([
    svc.from('negocio_responsables').select('staff_id').eq('negocio_id', negocio.id),
    negocio.linea_id
      ? svc.from('lineas_negocio').select('config_extra').eq('id', negocio.linea_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  // Sin poder leer quién lo lleva, el aviso de prueba no sale (el error no lo abre al equipo real).
  if (resp.error || linea.error) return []
  const staffIds = [
    ...new Set([
      ...((resp.data ?? []) as Array<{ staff_id: string | null }>).map((r) => r.staff_id ?? ''),
      ...aprobadoresDeConfig((linea.data as { config_extra?: unknown } | null)?.config_extra),
    ].filter(Boolean)),
  ]
  if (staffIds.length === 0) return []
  const st = await svc.from('staff').select('profile_id').eq('workspace_id', negocio.workspace_id).in('id', staffIds)
  if (st.error) return []
  const permitidos = new Set(((st.data ?? []) as Array<{ profile_id: string | null }>).map((s) => s.profile_id ?? '').filter(Boolean))
  return todos.filter((p) => permitidos.has(p))
}

/** Puro: quita las filas cuyo negocio está en `ocultos`. Filas sin negocio se quedan. */
export function sinOcultos<T>(filas: readonly T[], ocultos: ReadonlySet<string>, negocioDe: (f: T) => unknown): T[] {
  if (ocultos.size === 0) return [...filas]
  return filas.filter((f) => {
    const id = negocioDe(f)
    return !(typeof id === 'string' && ocultos.has(id))
  })
}
