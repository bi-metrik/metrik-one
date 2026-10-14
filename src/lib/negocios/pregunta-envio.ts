/**
 * H33 · «¿Ya se la mandaste?» (2026-10-14, regla de Hana §2.1, boceto D de Noor).
 *
 * Descargar el PDF es revisar, no enviar. Tras una descarga, el editor PREGUNTA si la propuesta
 * ya salió; solo el «Sí» la marca enviada (por `enviarCotizacion`, con sus guardas). Esta función
 * decide si se pregunta:
 *
 *  · no, si el PDF salió como borrador (marca de agua): ese documento no se puede mandar;
 *  · no, si la cotización ya no está en borrador o está congelada: no hay nada que marcar;
 *  · sí, en la cotización de viaje (Trappvel) o con el seguimiento encendido en la línea, que son
 *    los dos perímetros donde la descarga era (o es) el envío real. Fuera de ellos, el editor
 *    tiene su botón «Enviar» de siempre y no se le agrega una pregunta a cada descarga.
 */
export function debePreguntarEnvio(a: {
  pdfBorrador: boolean
  estado: string
  editable: boolean
  viaje: boolean
  seguimiento: boolean
}): boolean {
  if (a.pdfBorrador) return false
  if (a.estado !== 'borrador' || !a.editable) return false
  return a.viaje || a.seguimiento
}
