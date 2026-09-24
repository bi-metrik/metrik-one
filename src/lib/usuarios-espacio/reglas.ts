/**
 * Gestión de usuarios de un espacio: las reglas, puras. Genéricas a propósito: nacen para la sección
 * Suscripción de los CDA y se van a llevar a los espacios de Clarity (decisión de Mauricio,
 * 2026-09-23). Nada aquí sabe de Valida ni de contratos: el límite de licencias y la persona
 * designada entran por parámetro.
 *
 * ## Roles que se asignan desde aquí
 *
 * Dos, con nombre de persona y no de sistema: Administrador (`admin`) y Operador (`operator`). El
 * dueño (`owner`) se muestra como Administrador pero no se toca desde aquí: ni se retira ni cambia
 * de rol. Los demás roles del sistema (supervisor, solo lectura, contador) se muestran como Operador
 * y tampoco se asignan desde aquí.
 *
 * ## Qué no se puede hacer
 *
 *   - retirarse a sí mismo ni cambiarse el rol (se quedaría sin acceso a esta misma pantalla);
 *   - retirar o degradar a la persona designada del contrato: sin ella nadie puede aceptar términos;
 *   - retirar o cambiar al dueño.
 *
 * ## Licencias
 *
 * Cuenta a quien tiene acceso al espacio: invitaciones pendientes incluidas (ya ocupan su cupo:
 * el usuario existe y puede entrar), retirados y soporte de MeTRIK (platform admin) excluidos.
 */

export const ROLES_ASIGNABLES = ['admin', 'operator'] as const
export type RolAsignable = (typeof ROLES_ASIGNABLES)[number]

export function esRolAsignable(r: unknown): r is RolAsignable {
  return typeof r === 'string' && (ROLES_ASIGNABLES as readonly string[]).includes(r)
}

export function etiquetaRol(role: string | null | undefined): 'Administrador' | 'Operador' {
  return role === 'owner' || role === 'admin' ? 'Administrador' : 'Operador'
}

/** `rol_plataforma` de `staff` que corresponde a cada rol (el trigger `trg_sync_staff_role` lo espeja en `profiles.role`). */
export const ROL_PLATAFORMA: Record<RolAsignable, string> = { admin: 'administrador', operator: 'ejecutor' }

export interface UsuarioDelEspacio {
  id: string
  nombre: string
  correo: string | null
  role: string
  /** ISO. `null` = nunca ha entrado: la invitación sigue pendiente. */
  ultimoIngreso: string | null
}

export interface AccionesUsuario {
  puedeRetirar: boolean
  puedeCambiarRol: boolean
  puedeReenviar: boolean
  /** Por qué no se puede retirar ni cambiar, para decirlo en la fila. */
  nota: string | null
}

export function accionesSobreUsuario(p: {
  actorId: string
  objetivo: Pick<UsuarioDelEspacio, 'id' | 'role' | 'ultimoIngreso'>
  designadoId: string | null
}): AccionesUsuario {
  const puedeReenviar = p.objetivo.ultimoIngreso === null
  if (p.objetivo.id === p.actorId) {
    return { puedeRetirar: false, puedeCambiarRol: false, puedeReenviar: false, nota: 'Eres tú' }
  }
  if (p.designadoId && p.objetivo.id === p.designadoId) {
    return { puedeRetirar: false, puedeCambiarRol: false, puedeReenviar, nota: 'Persona designada del contrato' }
  }
  if (p.objetivo.role === 'owner') {
    return { puedeRetirar: false, puedeCambiarRol: false, puedeReenviar, nota: 'Dueño del espacio' }
  }
  return { puedeRetirar: true, puedeCambiarRol: esRolAsignable(p.objetivo.role), puedeReenviar, nota: null }
}

export interface Cupo {
  licencias: number
  usados: number
  libres: number
}

export function cupo(licencias: number, usados: number): Cupo {
  const l = Number.isInteger(licencias) && licencias > 0 ? licencias : 0
  return { licencias: l, usados, libres: Math.max(0, l - usados) }
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase()
}

export type ProblemaInvitacion = 'correo' | 'nombre' | 'rol' | 'sin_cupo'

export function validarInvitacion(p: { correo: string; nombre: string; rol: unknown; cupo: Cupo }): ProblemaInvitacion | null {
  if (!CORREO.test(normalizarCorreo(p.correo))) return 'correo'
  const nombre = p.nombre.trim()
  if (nombre.length < 2 || nombre.length > 120) return 'nombre'
  if (!esRolAsignable(p.rol)) return 'rol'
  if (p.cupo.libres <= 0) return 'sin_cupo'
  return null
}

export const MENSAJE_INVITACION: Record<ProblemaInvitacion, string> = {
  correo: 'Escribe un correo válido.',
  nombre: 'Escribe el nombre de la persona.',
  rol: 'Elige Administrador u Operador.',
  sin_cupo: 'No hay cupos de usuario libres. Agrega un usuario adicional para invitar a otra persona.',
}

/**
 * Al retirar a alguien, ¿queda libre una licencia ADICIONAL que se puede dejar de pagar? Sí si hay
 * adicionales vigentes y, con el retiro, sobra al menos una licencia.
 */
export function licenciaAdicionalLiberable(p: { licencias: number; usadosDespues: number; adicionalesVigentes: number }): boolean {
  return p.adicionalesVigentes > 0 && p.usadosDespues < p.licencias
}
