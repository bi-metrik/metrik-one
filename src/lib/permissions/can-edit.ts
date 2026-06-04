/**
 * Modelo roles · areas · stages — Funcion central canEditBloque
 * Fase 2 (2026-05-20)
 *
 * Reemplaza el switch de Tier 1/2/3 anterior. Calcula permisos en base a:
 *   - rol global del staff (owner/admin/supervisor/operator/contador/read_only)
 *   - area(s) del staff (comercial / operaciones / financiera / direccion)
 *   - stage del bloque (derivado de etapa -> negocios.stage_actual)
 *   - responsabilidad: el staff debe estar en negocio_responsables del negocio
 *
 * Fuentes canonicas:
 *   - cerebro/conceptos/modelo-roles-areas-stages.md
 *   - cerebro/reglas/permisos-negocios.md
 *
 * Diseno funcional puro: todo input se pasa explicitamente. No hace IO,
 * no consulta BD. Los callers en server actions resuelven user.areas
 * y negocioResponsables antes de invocar estas funciones.
 */

// ── Tipos ────────────────────────────────────────────────────────────

export type Role =
  | 'owner'
  | 'admin'
  | 'supervisor'
  | 'operator'
  | 'contador'
  | 'read_only'

export type Area = 'comercial' | 'operaciones' | 'financiera' | 'direccion'

export type Stage = 'venta' | 'ejecucion' | 'cobro' | 'cerrado'

export type UserContext = {
  /** profile.id (o staff.id segun caller). Usado para chequeo de responsable. */
  id: string
  role: Role
  /** Areas asignadas en staff_areas. Puede ser vacio para admin/owner/contador/read_only. */
  areas: Area[]
}

export type BloqueContext = {
  /** Stage al que pertenece la etapa donde vive el bloque. */
  stage: Stage
}

/** Stage -> area duena del stage. cerrado no tiene area (read-only). */
export const STAGE_TO_AREA: Record<Stage, Area | null> = {
  venta: 'comercial',
  ejecucion: 'operaciones',
  cobro: 'financiera',
  cerrado: null,
} as const

// ── Helper: areas efectivas ──────────────────────────────────────────

/**
 * Calcula el conjunto de areas efectivas de un staff.
 * Si el staff tiene 'direccion', se le suman las 3 areas operativas
 * (comercial + operaciones + financiera).
 */
export function getAreasEfectivas(user: UserContext): Set<Area> {
  const areas = new Set<Area>(user.areas)
  if (areas.has('direccion')) {
    areas.add('comercial')
    areas.add('operaciones')
    areas.add('financiera')
  }
  return areas
}

// ── canEditBloque ────────────────────────────────────────────────────

/**
 * Determina si un usuario puede editar un bloque dado.
 *
 * Reglas (cerebro/conceptos/modelo-roles-areas-stages.md):
 *   - read_only/contador: siempre false (fuera del modelo de areas)
 *   - La segmentacion por area se activa SOLO si el staff tiene area(s) en
 *     staff_areas. Sin area asignada: comportamiento por rol (owner/admin y
 *     supervisor pueden; operator requiere ser responsable).
 *   - Con area asignada: el staff (cualquier rol, incluido owner/admin) solo
 *     edita el stage cuya area_duena este en sus areas efectivas (direccion
 *     expande a las 3). Cambio 2026-06-04: owner/admin con area dejan de ser
 *     passthrough — se restringen como el resto.
 *   - cerrado (sin area_duena): solo owner/admin.
 *   - operator: ademas debe ser responsable del negocio.
 */
export function canEditBloque(
  user: UserContext,
  bloque: BloqueContext,
  negocioResponsables: string[]
): boolean {
  // read_only / contador: fuera del modelo
  if (user.role === 'read_only' || user.role === 'contador') return false

  const areaDuena = STAGE_TO_AREA[bloque.stage]
  const tieneAreas = user.areas.length > 0
  const areasEfectivas = getAreasEfectivas(user)
  // Cubre el stage si no tiene areas (sin segmentacion) o su area lo incluye.
  const cubreStage = areaDuena !== null && (!tieneAreas || areasEfectivas.has(areaDuena))

  // owner/admin: passthrough si no tienen area; con area, se restringen al stage.
  if (user.role === 'owner' || user.role === 'admin') {
    if (!tieneAreas) return true
    return areaDuena === null ? true : areasEfectivas.has(areaDuena)
  }

  // Stage cerrado: solo owner/admin (ya retornaron arriba)
  if (areaDuena === null) return false

  // supervisor: cubre el stage (o no tiene areas asignadas)
  if (user.role === 'supervisor') {
    return cubreStage
  }

  // operator: cubre el stage + responsable explicito
  if (user.role === 'operator') {
    return cubreStage && negocioResponsables.includes(user.id)
  }

  return false
}

// ── canAdvanceStage ──────────────────────────────────────────────────

/**
 * ¿Puede el usuario avanzar/cambiar un negocio al stage destino? Mismo criterio
 * que editar un bloque de ese stage: su área debe cubrirlo (o sin área →
 * passthrough por rol); operator además debe ser responsable del negocio.
 */
export function canAdvanceStage(
  user: UserContext,
  stageTo: Stage,
  negocioResponsables: string[],
): boolean {
  return canEditBloque(user, { stage: stageTo }, negocioResponsables)
}

// ── canEditHeader ────────────────────────────────────────────────────

/**
 * Header del negocio (empresa + contacto): independiente del stage actual.
 * Editable por owner, admin o cualquier persona con 'comercial' en areas
 * efectivas (direccion tambien lo da, via expansion).
 */
export function canEditHeader(user: UserContext): boolean {
  if (user.role === 'owner' || user.role === 'admin') return true
  if (user.role === 'read_only' || user.role === 'contador') return false

  // supervisor u operator deben tener comercial (directo o via direccion)
  return getAreasEfectivas(user).has('comercial')
}

// ── canViewNegocio ───────────────────────────────────────────────────

/**
 * Determina si el usuario puede ver el negocio en su lista / detalle.
 *
 *   - owner/admin/supervisor/read_only: ven todos los negocios del WS
 *   - operator: solo los negocios donde es responsable explicito
 *   - contador: NO ve negocios (esta fuera del modelo)
 */
export function canViewNegocio(
  user: UserContext,
  negocioResponsables: string[]
): boolean {
  if (user.role === 'contador') return false

  if (
    user.role === 'owner' ||
    user.role === 'admin' ||
    user.role === 'supervisor' ||
    user.role === 'read_only'
  ) {
    return true
  }

  // operator: solo si esta listado como responsable
  if (user.role === 'operator') {
    return negocioResponsables.includes(user.id)
  }

  return false
}

// ── canWriteActivityLog ──────────────────────────────────────────────

/**
 * Activity log: todos los que ven el negocio pueden escribir.
 * Por defecto = canViewNegocio. Es el hub de comunicacion del negocio.
 */
export function canWriteActivityLog(
  user: UserContext,
  negocioResponsables: string[]
): boolean {
  return canViewNegocio(user, negocioResponsables)
}

// ── Helper: filtrar negocios visibles para operator ──────────────────

/**
 * Util para queries: dado un usuario operator, retorna si debe filtrar
 * por responsable en la query.
 */
export function operatorShouldFilterByResponsable(role: Role): boolean {
  return role === 'operator'
}
