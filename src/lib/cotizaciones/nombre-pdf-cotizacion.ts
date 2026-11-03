/**
 * El nombre del PDF de una cotización (pedido de Mauricio, 2026-11-03): «que salga con la palabra
 * cotización, el COT, el nombre del cliente y, si hay, el destino principal».
 *
 *   Cotización COT-2026-0011 - MARÍA PÉREZ MUÑOZ - SAN ANDRÉS.pdf
 *   Cotización COT-2026-0011 - MARÍA PÉREZ MUÑOZ - SAN ANDRÉS - BORRADOR.pdf
 *
 * Sin cliente o sin destino, la parte no va (ni el guion que la separa). Antes el archivo era
 * `COT-2026-0011.pdf` y no decía de quién era.
 *
 * Es el MISMO nombre en todas partes: la descarga, el `<title>` del documento (el título que muestra
 * el visor del navegador; ver `tituloPdfCotizacion`), Drive y el almacenamiento externo (que lo
 * pasa por `nombreArchivoSeguro` porque una clave de Storage no admite tildes ni espacios).
 *
 * Pura: la usan la acción del PDF y la ruta de vista previa.
 */

export interface DatosNombrePdf {
  /** `cotizaciones.codigo` o, en las viejas, el consecutivo. */
  codigo: string | null | undefined
  /** La empresa del negocio o, sin ella, el contacto. La de relleno («Cliente») no cuenta. */
  cliente?: string | null
  /** El destino del viaje. Con varias paradas («Madrid · París») va la primera. */
  destino?: string | null
  borrador?: boolean
}

/** Lo que Windows y macOS no aceptan en un nombre de archivo (como `cronograma-gantt-actions.ts`). */
const PROHIBIDOS = /[\\/:*?"<>|]+/g
const CONTROL = /[\u0000-\u001f\u007f]+/g
/** Tope de cada parte: un nombre de cliente o de destino largo no se come el resto del archivo. */
const TOPE_PARTE = 60

function limpia(texto: string | null | undefined): string | null {
  if (typeof texto !== 'string') return null
  let t = texto.replace(CONTROL, ' ').replace(PROHIBIDOS, '-').replace(/\s+/g, ' ').trim()
  if (t.length > TOPE_PARTE) t = t.slice(0, TOPE_PARTE).trim()
  // Un nombre que termina en punto o guion se ve cortado y Windows quita el punto final.
  t = t.replace(/[\s.-]+$/, '').replace(/^[\s.-]+/, '')
  return t === '' ? null : t
}

/** El destino principal: la primera parada de una lista («Madrid · París», «Madrid, París»). */
export function destinoPrincipal(destino: string | null | undefined): string | null {
  if (typeof destino !== 'string') return null
  const primero = destino.split(/\s+·\s+|,/)[0]
  return limpia(primero)
}

/** El nombre sin extensión: el `<title>` del documento. */
export function tituloPdfCotizacion(d: DatosNombrePdf): string {
  const codigo = limpia(d.codigo)
  const cliente = limpia(d.cliente)
  const destino = destinoPrincipal(d.destino)
  const cabeza = codigo ? `Cotización ${codigo}` : 'Cotización'
  // Un destino igual al cliente (dato mal llenado) no se repite.
  const partes = [cabeza, cliente, destino && destino.toLowerCase() !== cliente?.toLowerCase() ? destino : null]
  if (d.borrador) partes.push('BORRADOR')
  return partes.filter((p): p is string => !!p).join(' - ')
}

/** El nombre del archivo, con `.pdf`. */
export function nombrePdfCotizacion(d: DatosNombrePdf): string {
  return `${tituloPdfCotizacion(d)}.pdf`
}

/**
 * La cabecera `content-disposition` con este nombre. El `filename` llano lleva solo ASCII (sin
 * tildes; lo demás, `_`) para los navegadores viejos; `filename*` lleva el nombre real en UTF-8
 * (RFC 6266), que es el que usan los de hoy.
 */
export function contentDispositionPdf(nombre: string, modo: 'inline' | 'attachment' = 'inline'): string {
  const ascii = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
  return `${modo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`
}
