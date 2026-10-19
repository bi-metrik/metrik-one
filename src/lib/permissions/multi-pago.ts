/**
 * Quién edita el bloque «Pagos ePayco» multi-pago (`config_extra.es_multi_pago`).
 *
 * Una sola regla para la pantalla (`negocio-detail-client.tsx`, modo del bloque) y para el
 * servidor (`guardarPagosMulti`). Hasta el 2026-10-19 la pantalla solo dejaba editar a
 * owner/admin y el servidor aceptaba a cualquiera que pasara el guard genérico del bloque
 * (rol + área + responsable): el permiso real era más ancho que el que se veía.
 *
 * Unificar hacia la regla de la pantalla no le quita nada a nadie que hoy lo vea editable.
 */
const ROLES_EDITAN_MULTI_PAGO = ['owner', 'admin'] as const

export function puedeEditarMultiPago(role: string | null | undefined): boolean {
  return (ROLES_EDITAN_MULTI_PAGO as readonly string[]).includes(role ?? '')
}
