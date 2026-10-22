import { getRolePermissions } from '@/lib/roles'

/**
 * ¿Quién puede ASIGNAR y QUITAR responsables de un negocio?
 *
 * Por rol, como siempre: owner, admin y supervisor (`canAssignResponsable` de
 * `@/lib/roles`, que sigue siendo la fuente del rol).
 *
 * PERMISO DECLARADO POR PERSONA, además del rol (decisión de Mauricio, 2026-10-22):
 *
 *   workspaces.config_extra.asignar_responsable.staff_ids = ["<staff_id>", ...]
 *
 * Una persona con rol operator puede asignar responsables si su `staff.id` está en la
 * lista, sin subirle el rol: subirla a supervisor le daría en silencio todo lo demás
 * que cuelga de ese rol. Mismo patrón que `omitir_gate.staff_ids`.
 *
 * - owner/admin/supervisor conservan el permiso: los workspaces sin la lista no cambian.
 * - FAIL-CLOSED: lista ausente, vacía o mal formada = nadie más. De una lista solo
 *   cuentan los elementos con forma de uuid; lo demás se ignora.
 * - Alcance: los responsables del NEGOCIO (`agregarResponsable`/`quitarResponsable`,
 *   la lista y el detalle). La asignación de contactos en el directorio NO lee esta
 *   lista: sigue solo con `canAssignResponsable`.
 *
 * Fuente ÚNICA: la consumen los guards del servidor Y las pantallas que deciden si
 * dibujan el selector. Copiar la regla en los dos lados los desincroniza: la pantalla
 * ofrecería algo que el servidor rechaza, o se lo escondería a quien sí puede.
 *
 * Módulo puro, sin IO: quien llama lee `workspaces.config_extra` y pasa el objeto.
 */

export type ActorAsignarResponsable = {
  /** Rol del staff en el workspace (`getWorkspace().role`). */
  role: string | null | undefined
  /** `staff.id`, NO `profile.id`: es lo que guarda la lista. */
  staffId: string | null | undefined
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Los `staff_id` declarados en `config_extra.asignar_responsable.staff_ids`, en
 * minúscula.
 *
 * Tolerante con la forma: si la clave falta o no es una lista, devuelve vacío; de una
 * lista solo conserva los textos con forma de uuid. Un valor mal cargado no puede
 * abrir el permiso a nadie.
 */
export function staffIdsQuePuedenAsignarResponsable(configExtraWorkspace: unknown): string[] {
  if (!configExtraWorkspace || typeof configExtraWorkspace !== 'object') return []
  const asignar = (configExtraWorkspace as { asignar_responsable?: unknown }).asignar_responsable
  if (!asignar || typeof asignar !== 'object') return []
  const ids = (asignar as { staff_ids?: unknown }).staff_ids
  if (!Array.isArray(ids)) return []
  return ids
    .filter((id): id is string => typeof id === 'string' && UUID.test(id.trim()))
    .map(id => id.trim().toLowerCase())
}

export function puedeAsignarResponsable(
  actor: ActorAsignarResponsable,
  configExtraWorkspace: unknown,
): boolean {
  if (actor.role && getRolePermissions(actor.role).canAssignResponsable) return true
  if (!actor.staffId) return false
  return staffIdsQuePuedenAsignarResponsable(configExtraWorkspace).includes(actor.staffId.toLowerCase())
}
