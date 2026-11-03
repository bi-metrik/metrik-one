/**
 * Las obras (cierre, facturas por obra, llegadas, rubros, colaboradores con jornada y CSV) son una
 * función de Clarity que se enciende por workspace con `workspaces.modules.obras`. Sin la llave
 * nada de esto aparece: los demás workspaces no cambian.
 *
 * Los permisos: escriben dueño y administrador (facturas, marcar pagada, rubros, colaboradores,
 * llegadas, condiciones de la obra). Ven el cierre también supervisor, contador y solo lectura.
 */

export const LLAVE_OBRAS = 'obras'

export function obrasActivas(modules: unknown): boolean {
  return !!modules && typeof modules === 'object' && (modules as Record<string, unknown>)[LLAVE_OBRAS] === true
}

export const ROLES_EDITAN_OBRAS: readonly string[] = ['owner', 'admin']
export const ROLES_VEN_OBRAS: readonly string[] = ['owner', 'admin', 'supervisor', 'contador', 'read_only']

export function puedeEditarObras(role: string | null | undefined): boolean {
  return ROLES_EDITAN_OBRAS.includes(role ?? '')
}

export function puedeVerObras(role: string | null | undefined): boolean {
  return ROLES_VEN_OBRAS.includes(role ?? '')
}

/** Lo que responde la base cuando la migración de obras todavía no está aplicada. */
export function faltaMigracionObras(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false
  return (
    e.code === '42P01' || // tabla o vista no existe
    e.code === '42703' || // columna no existe
    e.code === 'PGRST205' || // tabla fuera de la caché del esquema
    e.code === 'PGRST204' || // columna fuera de la caché del esquema
    /obra_rubros|llegadas_obra|v_cierre_obra|v_facturas_obra|v_jornadas_dia|colaborador_jornada_valores/.test(e.message ?? '')
  )
}

export const MENSAJE_SIN_MIGRACION_OBRAS = 'Las obras todavía no están disponibles: falta aplicar la migración de la base.'
