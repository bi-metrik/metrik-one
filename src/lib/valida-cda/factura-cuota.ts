/**
 * Reglas puras de la factura electrónica de una cuota (`facturas_cuota`, 20260924010000).
 *
 * MeTRIK sube cada mes el PDF y el XML de la factura de la cuota; el cliente los descarga desde la
 * pestaña Pagos de `/valida`. El mecanismo es el de los recibos de 4D SOFT (`valida-api/recibo-manual.ts`):
 * bucket PRIVADO `documentos-servicio`, ruta por huella, URL firmada de 60 s. Nunca Drive.
 *
 * Aquí vive lo que se decide ANTES de subir nada (tipo, tamaño, contenido y número) y cómo se
 * nombran la ruta y la descarga. El servidor lo aplica en `actions/factura-cuota-carga.ts`.
 */

/**
 * 2 MB por archivo. Los dos viajan juntos en el cuerpo de UNA acción del servidor, y Vercel corta el
 * cuerpo de una función en 4,5 MB: con 10 MB por archivo (el tope del recibo) la carga fallaría en
 * producción con un error que no nombra el tamaño. Una factura electrónica pesa decenas de KB.
 */
export const TAMANO_MAX_FACTURA = 2 * 1024 * 1024

export type ClaseArchivoFactura = 'pdf' | 'xml'

export interface ArchivoFactura {
  nombre: string
  tipo: string
  tamano: number
  /** Los primeros bytes del archivo: el tipo declarado por el navegador no prueba nada. */
  cabecera: Uint8Array
}

const TIPOS_XML = new Set(['application/xml', 'text/xml', ''])

/** El número de la factura: letras, dígitos y guiones, hasta 40. El mismo CHECK de la tabla. */
export function numeroFacturaValido(numero: string | null | undefined): string | null {
  const n = (numero ?? '').trim().toUpperCase()
  return /^[A-Z0-9-]{1,40}$/.test(n) ? n : null
}

function empiezaCon(bytes: Uint8Array, texto: string): boolean {
  if (bytes.length < texto.length) return false
  for (let i = 0; i < texto.length; i++) if (bytes[i] !== texto.charCodeAt(i)) return false
  return true
}

/** ¿El contenido es un XML? Tolera la marca BOM de UTF-8 y espacios antes del primer `<`. */
function pareceXml(bytes: Uint8Array): boolean {
  let i = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++
  return bytes[i] === 0x3c /* < */
}

/** Motivo por el que un archivo no sirve como esa parte de la factura, o null. */
export function problemaArchivoFactura(clase: ClaseArchivoFactura, archivo: ArchivoFactura | null): string | null {
  const etiqueta = clase === 'pdf' ? 'El PDF' : 'El XML'
  if (!archivo || archivo.tamano === 0) return `${etiqueta} de la factura está vacío`
  if (archivo.tamano > TAMANO_MAX_FACTURA) return `${etiqueta} de la factura pesa más de 2 MB`
  const nombre = archivo.nombre.toLowerCase()
  if (clase === 'pdf') {
    const declarado = archivo.tipo === 'application/pdf' || nombre.endsWith('.pdf')
    if (!declarado || !empiezaCon(archivo.cabecera, '%PDF-')) return 'El PDF de la factura no es un PDF'
    return null
  }
  const declarado = nombre.endsWith('.xml') && TIPOS_XML.has(archivo.tipo)
  if (!declarado || !pareceXml(archivo.cabecera)) return 'El XML de la factura no es un XML'
  return null
}

/** Ruta en el bucket: por espacio y por huella, sin el número ni el cliente. */
export function rutaFactura(workspaceId: string, sha256: string, clase: ClaseArchivoFactura): string {
  return `${workspaceId}/facturas/${sha256}.${clase}`
}

/** Nombre con el que se descarga: el número de la factura. */
export function nombreDescargaFactura(numero: string | null, clase: ClaseArchivoFactura): string {
  const base = (numero ?? 'factura').trim().replace(/[^\w.-]+/g, '-') || 'factura'
  return `${base}.${clase}`
}
