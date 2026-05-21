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
 *   - owner/admin: siempre true
 *   - read_only/contador: siempre false (estan fuera del modelo de areas)
 *   - cerrado: solo owner/admin (otros solo lectura)
 *   - supervisor: true si su area efectiva incluye area_duena del stage
 *   - operator: true si su area efectiva incluye area_duena Y es responsable
 */
export function canEditBloque(
  user: UserContext,
  bloque: BloqueContext,
  negocioResponsables: string[]
): boolean {
  // owner/admin: passthrough total
  if (user.role === 'owner' || user.role === 'admin') return true

  // read_only / contador: fuera del modelo
  if (user.role === 'read_only' || user.role === 'contador') return false

  // Stage cerrado: solo owner/admin (ya retornaron arriba)
  const areaDuena = STAGE_TO_AREA[bloque.stage]
  if (areaDuena === null) return false

  const areasEfectivas = getAreasEfectivas(user)

  // supervisor: debe tener area que cubra el stage
  if (user.role === 'supervisor') {
    return areasEfectivas.has(areaDuena)
  }

  // operator: area + responsable explicito
  if (user.role === 'operator') {
    return areasEfectivas.has(areaDuena) && negocioResponsables.includes(user.id)
  }

  return false
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
