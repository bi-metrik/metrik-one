/**
 * Qué cierra la edición de un bloque según su tipo. Puro: lo usan la ficha del negocio (modo del
 * bloque) y el servidor que la arma (`_areaReadonly`).
 *
 * «Servicios del viaje» no se cierra ni al quedar completo ni por área: su estado lo deriva el
 * gate (`servicios_listos`) y sus permisos son por fila (`puedeEditarServicios`,
 * `puedeAdjuntarVoucher`), revisados por el servidor en cada acción. Cerrarlo dejaba el viaje
 * trabado (QA Trappvel 2026-10-29): con la fila Confirmada desaparecía el voucher que la etapa
 * siguiente exige (M1-1), y la comercial responsable no veía el botón del voucher (H3-1).
 */

/** Tipos que siguen editables aunque la instancia esté «completa» mientras el negocio esté en su etapa. */
const SIGUEN_ABIERTOS_AL_COMPLETAR = new Set(['datos', 'documento', 'servicios'])

/** ¿Un bloque completo pasa a solo lectura? */
export function completoCierraLaEdicion(tipo: string | null | undefined): boolean {
  return !SIGUEN_ABIERTOS_AL_COMPLETAR.has(tipo ?? '')
}

/** Tipos cuyos permisos son por fila y no por el área de la etapa. */
const PERMISO_POR_FILA = new Set(['servicios'])

/** ¿El área de la etapa NO cierra este bloque? (sus permisos los decide cada fila). */
export function areaNoCierraElBloque(tipo: string | null | undefined): boolean {
  return PERMISO_POR_FILA.has(tipo ?? '')
}
