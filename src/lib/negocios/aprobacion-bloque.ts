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
 * Quién PUEDE ser aprobador (`puedeSerAprobador`) es una sola función para la lista del
 * selector, para la designación en el servidor y para la decisión: un dueño o administrador
 * del workspace que no esté desactivado en el equipo. Antes la lista ofrecía a todos los
 * profiles, y designar a un operador dejaba el bloque sin nadie que pudiera decidir.
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
export const MENSAJE_APROBADOR_NO_PUEDE_DECIDIR =
  'Solo se puede designar como aprobador a un dueño o administrador activo del equipo'
export const MENSAJE_DECISOR_INACTIVO =
  'Tu usuario está desactivado en este equipo y no puede decidir aprobaciones'

export function rolGestionaAprobacion(role: string | null | undefined): boolean {
  return (ROLES_APROBACION as readonly string[]).includes(role ?? '')
}

/**
 * ¿Sigue activo en el equipo? Lo único que saca a alguien es una fila de `staff` de ESTE
 * workspace marcada `is_active = false`. Sin fila no hay desactivación registrada: el profile
 * es del workspace y `getWorkspace` le crea su staff activo al entrar (y un platform_admin
 * tiene el suyo en su workspace de origen).
 */
export function activoEnEquipo(staff: { is_active: boolean | null } | null | undefined): boolean {
  return !(staff && staff.is_active === false)
}

/**
 * Marca cada profile del workspace con su estado en el equipo. Recibe la fila de `staff` de ESTE
 * workspace (la consulta filtra por workspace); es la lista que llega al selector de aprobador.
 */
export function perfilesConEstadoEnEquipo<P extends { id: string }>(
  perfiles: P[],
  staffDelWorkspace: Array<{ profile_id: string | null; is_active: boolean | null }>,
): Array<P & { activo: boolean }> {
  const porProfile = new Map(
    staffDelWorkspace.filter((s) => s.profile_id).map((s) => [s.profile_id as string, s]),
  )
  return perfiles.map((p) => ({ ...p, activo: activoEnEquipo(porProfile.get(p.id)) }))
}

/** Lo que hace falta saber de una persona para decidir si puede aprobar. */
export type PersonaAprobacion = { role: string | null | undefined; activo: boolean | undefined }

/**
 * ¿Puede esta persona decidir una aprobación, y por tanto ser designada? Una sola regla para
 * la lista del selector, la designación y la decisión. Un `activo` ausente no autoriza.
 */
export function puedeSerAprobador(persona: PersonaAprobacion | null | undefined): boolean {
  return !!persona && rolGestionaAprobacion(persona.role) && persona.activo === true
}

export type MotivoAprobadorInvalido = 'fuera_del_equipo' | 'rol' | 'inactivo'

export type PerfilAprobable = {
  id: string
  full_name: string | null
  role?: string | null
  activo?: boolean
}

/**
 * Lista del selector: solo quien puede decidir. Si el designado actual no pasa la regla NO se
 * borra en silencio: vuelve aparte, con su motivo, para que la pantalla lo muestre marcado y
 * el gerente lo cambie.
 */
export function opcionesAprobador<T extends PerfilAprobable>(
  perfiles: T[],
  aprobadorId: string | null | undefined,
): {
  elegibles: T[]
  designadoInvalido: { id: string; perfil: T | null; motivo: MotivoAprobadorInvalido } | null
} {
  const elegibles = perfiles.filter((p) => puedeSerAprobador({ role: p.role, activo: p.activo }))
  if (!aprobadorId || elegibles.some((p) => p.id === aprobadorId)) {
    return { elegibles, designadoInvalido: null }
  }
  const perfil = perfiles.find((p) => p.id === aprobadorId) ?? null
  const motivo: MotivoAprobadorInvalido = !perfil
    ? 'fuera_del_equipo'
    : !rolGestionaAprobacion(perfil.role)
      ? 'rol'
      : 'inactivo'
  return { elegibles, designadoInvalido: { id: aprobadorId, perfil, motivo } }
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
  /** Si quien actúa sigue activo en el equipo (`activoEnEquipo`). Cuenta para decidir. */
  activo: boolean
  profileId: string | null | undefined
  /**
   * Al designar: la persona designada, resuelta en ESTE workspace; `null` si no es del
   * equipo. Se ignora al decidir y al quitar el aprobador.
   */
  designado?: PersonaAprobacion | null
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
    // Quitar el aprobador (vacío) sigue permitido; designar exige a alguien que pueda decidir.
    if (p.entrada.aprobadorId) {
      if (!p.designado) return { error: MENSAJE_APROBADOR_AJENO }
      if (!puedeSerAprobador(p.designado)) return { error: MENSAJE_APROBADOR_NO_PUEDE_DECIDIR }
    }
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
  // La misma regla que decide quién aparece en la lista: si no podría ser designado, no decide.
  if (!puedeSerAprobador({ role: p.role, activo: p.activo })) {
    return { error: MENSAJE_DECISOR_INACTIVO }
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
