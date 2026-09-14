/**
 * ¿Quién puede OMITIR los gates pendientes de una etapa, con motivo escrito?
 *
 * Es el "override" del avance de etapa: `cambiarEtapaNegocioConGate` recibe un
 * `motivoOverride`, se salta los gates que retienen el caso y deja el motivo en
 * `activity_log`. Hasta el 2026-09-14 era exclusivo de owner/admin.
 *
 * PERMISO DECLARADO POR PERSONA, además del rol (decisión de Mauricio, 2026-09-14):
 *
 *   workspaces.config_extra.omitir_gate.staff_ids = ["<staff_id>", ...]
 *
 * Caso que lo motivó (SOENA): el dueño pidió que una supervisora comercial pudiera
 * saltarse etapas como él. Subirla a admin le habría dado en silencio todo lo demás
 * que cuelga del rol; la lista le da esto y nada más. Mismo patrón que
 * `correccion_precio.staff_ids`.
 *
 * - owner/admin conservan el permiso: los workspaces sin la lista no cambian.
 * - FAIL-CLOSED: lista ausente, vacía o mal formada = nadie más.
 * - No amplía nada más. Sigue haciendo falta poder avanzar la fase
 *   (`guardAvanzarStage`), los bloqueos con `omitible: false` no ceden a nadie, y
 *   retroceder, reabrir o reprocesar quedan fuera: esos siguen con su propio criterio.
 *
 * ⚠️ NO confundir con `puedeOmitirGate` de `@/lib/negocios/gate-omitible`: aquel deja
 * UN bloque en "no aplica" porque su paso venció, lo declara el bloque y lo decide el
 * área. Este se salta los gates pendientes de la etapa con un motivo y lo decide la
 * persona.
 *
 * Fuente ÚNICA: la consumen el guard del servidor Y la pantalla que decide si dibuja
 * el botón. Copiar la regla en los dos lados los desincroniza: la pantalla ofrecería
 * algo que el servidor rechaza, o se lo escondería a quien sí puede.
 *
 * Módulo puro, sin IO: quien llama lee `workspaces.config_extra` y pasa el objeto.
 */

export type ActorOmitirGates = {
  /** Rol del staff en el workspace (`getWorkspace().role`). */
  role: string | null | undefined
  /** `staff.id`, NO `profile.id`: es lo que guarda la lista. */
  staffId: string | null | undefined
}

/**
 * Los `staff_id` declarados en `config_extra.omitir_gate.staff_ids`.
 *
 * Tolerante con la forma: si la clave falta o no es una lista, devuelve vacío; de una
 * lista solo conserva los textos no vacíos. Un valor mal cargado no puede abrir el
 * permiso a nadie.
 */
export function staffIdsQuePuedenOmitirGates(configExtraWorkspace: unknown): string[] {
  if (!configExtraWorkspace || typeof configExtraWorkspace !== 'object') return []
  const omitir = (configExtraWorkspace as { omitir_gate?: unknown }).omitir_gate
  if (!omitir || typeof omitir !== 'object') return []
  const ids = (omitir as { staff_ids?: unknown }).staff_ids
  if (!Array.isArray(ids)) return []
  return ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
}

export function puedeOmitirGatesConMotivo(
  actor: ActorOmitirGates,
  configExtraWorkspace: unknown,
): boolean {
  if (actor.role === 'owner' || actor.role === 'admin') return true
  if (!actor.staffId) return false
  return staffIdsQuePuedenOmitirGates(configExtraWorkspace).includes(actor.staffId)
}
