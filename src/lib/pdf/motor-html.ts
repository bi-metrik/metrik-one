/**
 * Qué plantillas de cotización tienen propuesta html y si el workspace la encendió. Sin
 * dependencias: lo importan el layout de la app (menú «Fotos»), las acciones y el PDF.
 */

/**
 * Las plantillas que tienen versión HTML impresa con Chromium (motor `html`, la propuesta de
 * viaje del 2026-10-14). Hoy solo la de Trappvel.
 *
 * Tener la versión no la enciende: la enciende el workspace con
 * `workspaces.config_extra.documento_viaje.motor = 'html'` (SQL aparte, por workspace).
 * Apagado, o con cualquier otro valor, sale el PDF de @react-pdf de siempre. Si el motor
 * `html` falla en una descarga, la acción cae a @react-pdf y lo avisa.
 */
const PLANTILLAS_CON_MOTOR_HTML = new Set(['trappvel'])

/**
 * ¿La plantilla del workspace tiene propuesta html (y por eso biblioteca de fotos)? La biblioteca
 * se abre aunque el motor siga apagado: así se precargan las fotos antes de encenderlo.
 */
export function tienePropuestaHtml(slug: string | null | undefined): boolean {
  return !!slug && PLANTILLAS_CON_MOTOR_HTML.has(slug)
}

export function usaMotorHtml(slug: string | null | undefined, configExtraWorkspace: unknown): boolean {
  if (!slug || !PLANTILLAS_CON_MOTOR_HTML.has(slug)) return false
  if (!configExtraWorkspace || typeof configExtraWorkspace !== 'object') return false
  const doc = (configExtraWorkspace as Record<string, unknown>).documento_viaje
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false
  return (doc as Record<string, unknown>).motor === 'html'
}
