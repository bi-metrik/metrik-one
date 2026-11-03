/**
 * El rótulo del TIPO de un servicio del viaje, como lo ve Reservas.
 *
 * M-07 del QA de Trappvel (2026-10-29): el paquete de bloqueo nace como servicio `otro` (el CHECK
 * `negocio_servicios_tipo_check` no tiene «paquete» y agregarlo pide migración y tocar cada
 * `Record<TipoServicio, …>`). El servicio ya se llama «PAQUETE · <hotel>» (`nombreDelServicio`): de
 * ahí sale el rótulo «Paquete», derivado y sin migración. Lo demás, el rótulo de su tipo.
 */

export const ETIQUETA_TIPO_SERVICIO: Record<string, string> = {
  vuelo: 'Vuelo',
  hotel: 'Hotel',
  traslado: 'Traslado',
  tren: 'Tren',
  actividad: 'Actividad',
  asistencia: 'Asistencia',
  otro: 'Otro',
  paquete: 'Paquete',
}

/** ¿El servicio es un paquete de bloqueo? Un `otro` que se llama «PAQUETE · …». */
export function esServicioPaquete(s: { tipo: string; nombre?: string | null }): boolean {
  return s.tipo === 'otro' && typeof s.nombre === 'string' && /^\s*paquete\b/i.test(s.nombre)
}

/** La clave del rótulo y del color: `paquete` para el paquete de bloqueo; si no, su tipo. */
export function claseDeServicio(s: { tipo: string; nombre?: string | null }): string {
  return esServicioPaquete(s) ? 'paquete' : s.tipo
}

/** «Paquete», «Vuelo», «Otro»… */
export function etiquetaTipoServicio(s: { tipo: string; nombre?: string | null }): string {
  return ETIQUETA_TIPO_SERVICIO[claseDeServicio(s)] ?? 'Otro'
}
