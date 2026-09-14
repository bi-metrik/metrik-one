/**
 * Quién decide un bloque `aprobacion` y qué escribe la decisión.
 *
 * Fuente única que comparten la pantalla (`BloqueAprobacion`, `getBloqueMode`) y el
 * servidor (`actualizarAprobacion`). Antes la regla vivía solo en la pantalla y la server
 * action no la repetía: con cualquier id y `estado: 'aprobado'` escribía `completo` y
 * reemplazaba el `data` entero, sin guard ni mirar el tipo.
 *
 * La regla no es nueva, es la que la pantalla ya aplicaba:
 * - el bloque es gerencial: solo owner/admin lo ven editable (cerebro
 *   `reglas/bloques-permisos-por-rol.md`: "aprobaciones contractuales = gerencia");
 * - dentro de eso, un gerencial designa al aprobador (`data.aprobador_id`, un profile);
 * - solo el aprobador designado ve los botones de Aprobar y Rechazar;
 * - decidido (aprobado o rechazado), el bloque queda de solo lectura.
 * El área y el stage los sigue cortando `guardEditarBloque`, igual que `_areaReadonly`
 * en la pantalla.
 *
 * Puro: sin IO. El servidor resuelve el rol, el profile y lo guardado antes de llamar.
 */

export const ESTADOS_APROBACION = ['pendiente', 'aprobado', 'rechazado'] as const
export type EstadoAprobacion = (typeof ESTADOS_APROBACION)[number]

/** Roles que gestionan un bloque de aprobación: designan y deciden. */
export const ROLES_APROBACION = ['owner', 'admin'] as const

export const MENSAJE_NO_ES_APROBACION = 'Este bloque no es de aprobación'
export const MENSAJE_ESTADO_INVALIDO = 'Estado de aprobación inválido'
export const MENSAJE_FALTA_APROBADOR = 'Falta indicar el aprobador'
export const MENSAJE_ROL_APROBACION = 'Solo el dueño o un administrador gestiona esta aprobación'
export const MENSAJE_NO_ES_EL_APROBADOR = 'Solo el aprobador asignado puede decidir'
export const MENSAJE_YA_DECIDIDA = 'Esta aprobación ya se decidió'
export const MENSAJE_APROBADOR_AJENO = 'El aprobador no es del equipo de este workspace'

export function rolGestionaAprobacion(role: string | null | undefined): boolean {
  return (ROLES_APROBACION as readonly string[]).includes(role ?? '')
}

/** ¿Es este profile el aprobador designado? Un aprobador vacío no lo es nadie. */
export function esAprobadorAsignado(
  profileId: string | null | undefined,
  aprobadorId: unknown,
): boolean {
  return typeof aprobadorId === 'string' && aprobadorId !== '' && aprobadorId === profileId
}

export type EntradaAprobacion =
  /** `aprobadorId` vacío es quitar el aprobador: la pantalla lo permite con la opción en blanco. */
  | { accion: 'asignar'; aprobadorId: string }
  | { accion: 'decidir'; decision: 'aprobado' | 'rechazado'; comentario: string }

/**
 * Interpreta lo que manda la pantalla. `pendiente` con aprobador es designar; `aprobado`
 * o `rechazado` es decidir. Quién decide y cuándo NO se leen de aquí: los pone el servidor.
 */
export function leerEntradaAprobacion(raw: unknown): EntradaAprobacion | { error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const estado = r.estado
  if (typeof estado !== 'string' || !(ESTADOS_APROBACION as readonly string[]).includes(estado)) {
    return { error: MENSAJE_ESTADO_INVALIDO }
  }
  if (estado === 'pendiente') {
    if (typeof r.aprobador_id !== 'string') return { error: MENSAJE_FALTA_APROBADOR }
    return { accion: 'asignar', aprobadorId: r.aprobador_id.trim() }
  }
  const comentario = typeof r.comentario === 'string' ? r.comentario.trim() : ''
  return { accion: 'decidir', decision: estado as 'aprobado' | 'rechazado', comentario }
}

export type PlanAprobacion = {
  /** `data` completo a guardar: lo guardado con SOLO los campos de la aprobación encima. */
  data: Record<string, unknown>
  /** Aprobar cierra el bloque; rechazar lo deja como está, igual que antes. */
  completar: boolean
}

export function planAprobacion(p: {
  role: string | null | undefined
  profileId: string | null | undefined
  guardada: Record<string, unknown> | null | undefined
  bloqueEstado: string | null | undefined
  entrada: EntradaAprobacion
  ahoraISO: string
}): PlanAprobacion | { error: string } {
  if (!rolGestionaAprobacion(p.role) || !p.profileId) return { error: MENSAJE_ROL_APROBACION }

  const guardada = p.guardada ?? {}
  const estadoGuardado = typeof guardada.estado === 'string' ? guardada.estado : 'pendiente'
  // La pantalla solo ofrece designar y decidir mientras está pendiente.
  if (p.bloqueEstado === 'completo' || estadoGuardado !== 'pendiente') {
    return { error: MENSAJE_YA_DECIDIDA }
  }

  if (p.entrada.accion === 'asignar') {
    const { aprobador_id: _anterior, ...resto } = guardada
    return {
      data: p.entrada.aprobadorId
        ? { ...resto, aprobador_id: p.entrada.aprobadorId, estado: 'pendiente' }
        : { ...resto, estado: 'pendiente' },
      completar: false,
    }
  }

  if (!esAprobadorAsignado(p.profileId, guardada.aprobador_id)) {
    return { error: MENSAJE_NO_ES_EL_APROBADOR }
  }
  return {
    data: {
      ...guardada,
      estado: p.entrada.decision,
      comentario: p.entrada.comentario,
      aprobado_at: p.ahoraISO,
      decidido_por: p.profileId,
    },
    completar: p.entrada.decision === 'aprobado',
  }
}
