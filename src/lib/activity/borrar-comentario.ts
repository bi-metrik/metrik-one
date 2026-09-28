/**
 * Quién puede borrar una entrada de la Actividad.
 *
 * Solo se borran COMENTARIOS: los cambios de etapa y los eventos del sistema son el
 * rastro de lo que pasó con el negocio, y borrarlos reescribe la historia. Y un
 * comentario lo borra quien lo escribió, o el dueño o un administrador del workspace
 * (moderación). Antes bastaba con estar en el workspace.
 *
 * Una sola regla para las dos puntas: el servidor la aplica antes de borrar y la
 * pantalla la usa para decidir si dibuja el botón. Escrita dos veces, el botón
 * terminaría ofreciendo lo que el servidor niega.
 */

export interface EntradaBorrable {
  tipo: string
  /** `activity_log.autor_id`, que es un `staff.id`. */
  autor_id: string | null
}

export interface QuienBorra {
  /** `staff.id` de quien actúa (el efectivo, si hay «Ver como»). */
  staffId: string | null
  /** Rol efectivo en el workspace (`profiles.role`). */
  role: string | null
}

const ROLES_MODERADORES = new Set(['owner', 'admin'])

export function puedeBorrarEntrada(entrada: EntradaBorrable, quien: QuienBorra): boolean {
  if (entrada.tipo !== 'comentario') return false
  if (quien.role && ROLES_MODERADORES.has(quien.role)) return true
  // Sin staff no hay autoría que comparar: un autor nulo no le pertenece a nadie.
  if (!quien.staffId || !entrada.autor_id) return false
  return entrada.autor_id === quien.staffId
}
