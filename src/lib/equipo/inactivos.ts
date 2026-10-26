/**
 * El histórico de una persona inactiva se mantiene (SOE-006, decisión de Mauricio 2026-10-08):
 * «Siempre cuando inactivamos un usuario, el histórico se debe mantener. Todos los indicadores
 * los debemos poder trazar.»
 *
 * `staff.is_active` es un estado de HOY. Ningún indicador de un periodo pasado puede depender de
 * él: quien se retiró aparece en todo periodo en que tuvo actividad, con un rótulo junto al
 * nombre para que se lea que hoy ya no está. Lo que SÍ filtra por `is_active` (selectores de
 * asignación, asignación automática, avisos, cupo de licencias) no pasa por aquí.
 *
 * El rótulo se pone en el servidor sobre el `nombre` de la fila de persona: así llega igual al
 * ranking, a la tabla del mes, al filtro por vendedor y a la hoja de la persona, sin tocar cada
 * componente. Solo se aplica a filas de PERSONA (`responsable_id` / `staff_id`), nunca al nombre
 * de un negocio.
 */

export const ROTULO_INACTIVO = '(inactivo)'

/** `Ana Pérez` → `Ana Pérez (inactivo)`. Idempotente: no lo pone dos veces. */
export function rotularNombre(nombre: string, inactivo: boolean): string {
  if (!inactivo) return nombre
  if (nombre.endsWith(ROTULO_INACTIVO)) return nombre
  return `${nombre} ${ROTULO_INACTIVO}`
}

/** Rotula las filas cuya persona está inactiva hoy. No toca filas sin persona (bucket «sin responsable»). */
export function rotularFilas<T extends { nombre: string }>(
  filas: T[] | null | undefined,
  idDe: (fila: T) => string | null | undefined,
  inactivos: ReadonlySet<string>,
): T[] {
  if (!filas) return []
  if (inactivos.size === 0) return filas
  return filas.map((f) => {
    const id = idDe(f)
    return id && inactivos.has(id) ? { ...f, nombre: rotularNombre(f.nombre, true) } : f
  })
}

/**
 * Los `staff.id` del workspace que hoy están inactivos. Una lectura corta (solo ids) con el cliente
 * de la sesión: la política `staff_ws` ya acota al workspace. Si falla, devuelve vacío: el
 * indicador se pinta igual, solo sin rótulo.
 */
export async function staffInactivos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('is_active', false)
    if (error) {
      console.error('[equipo] no se pudieron leer los inactivos:', error.message)
      return new Set()
    }
    return new Set(((data ?? []) as Array<{ id: string }>).map((s) => s.id))
  } catch (e) {
    console.error('[equipo] no se pudieron leer los inactivos:', e)
    return new Set()
  }
}
