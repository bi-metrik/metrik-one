// ============================================================
// Referencias estables a archivos guardados FUERA de Google Drive
// (proveedor `supabase_externo`: el proyecto Supabase del propio cliente).
//
// Por qué una referencia y no una URL: una URL firmada vence (5 minutos), así que
// guardarla en la base deja un enlace muerto. Lo que se guarda es
// `sbext://<bucket>/<path>`, en el MISMO campo donde un workspace en Drive guarda su
// `drive_url`, y el enlace para abrirlo se firma en el momento, en
// `/api/archivos/abrir` (que además valida sesión y workspace).
//
// Módulo PURO y sin dependencias: lo importan el servidor y el navegador.
// ============================================================

/** Prefijo de toda referencia a un archivo en almacenamiento externo. */
export const PREFIJO_REFERENCIA = 'sbext://'

/** Bucket privado del proyecto externo donde ONE guarda los archivos de negocios. */
export const BUCKET_ARCHIVOS = 'one-documentos'

/** Endpoint que valida sesión + workspace, firma por 5 minutos y redirige. */
export const RUTA_ABRIR_ARCHIVO = '/api/archivos/abrir'

const CARPETA_NEGOCIOS = 'negocios'

/**
 * Subidas que el navegador hizo y todavía nadie confirmó. Viven dentro del prefijo
 * del negocio (nunca en un bucket público de ONE) y al confirmar se MUEVEN a su
 * nombre definitivo. Existen para que cancelar no destruya el archivo anterior.
 */
export const CARPETA_PENDIENTES = '_pendientes'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Una referencia externa. Tipo propio para que el `else` de un `string` siga siendo `string`. */
export type ReferenciaExterna = `sbext://${string}`

export function esReferenciaExterna(valor: unknown): valor is ReferenciaExterna {
  return typeof valor === 'string' && valor.startsWith(PREFIJO_REFERENCIA)
}

export function construirReferencia(bucket: string, path: string): string {
  return `${PREFIJO_REFERENCIA}${bucket}/${path}`
}

/**
 * Descompone una referencia. Devuelve null ante cualquier forma sospechosa: un
 * `..`, un segmento vacío o un bucket con caracteres raros no se "corrigen", se
 * rechazan (la referencia llega del navegador en más de un flujo).
 */
export function parsearReferencia(ref: unknown): { bucket: string; path: string } | null {
  if (!esReferenciaExterna(ref)) return null
  const resto = ref.slice(PREFIJO_REFERENCIA.length)
  const corte = resto.indexOf('/')
  if (corte <= 0) return null
  const bucket = resto.slice(0, corte)
  const path = resto.slice(corte + 1)
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(bucket)) return null
  if (!path) return null
  if (path.split('/').some(s => s === '' || s === '.' || s === '..')) return null
  if (/[\\?#]/.test(path)) return null
  return { bucket, path }
}

/** El negocio dueño de una ruta `negocios/<uuid>/...`, o null si la ruta no es de un negocio. */
export function negocioDeRuta(path: string): string | null {
  const [raiz, id, siguiente] = path.split('/')
  if (raiz !== CARPETA_NEGOCIOS || !id || !UUID.test(id) || !siguiente) return null
  return id.toLowerCase()
}

/**
 * El `href` con el que la pantalla abre un archivo. Una referencia externa pasa por
 * el endpoint que firma; cualquier otra URL (Drive, Storage heredado) queda igual, así
 * que en un workspace en Drive esto no cambia un solo enlace.
 */
export function hrefArchivo(
  url: string | null | undefined,
  opciones: { descargar?: boolean } = {},
): string | null {
  if (!url) return null
  if (!esReferenciaExterna(url)) return url
  const descargar = opciones.descargar ? '&descargar=1' : ''
  return `${RUTA_ABRIR_ARCHIVO}?ref=${encodeURIComponent(url)}${descargar}`
}

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Un segmento de carpeta aceptable como clave de Storage.
 *
 * ⚠️ Storage RECHAZA claves con tildes: medido contra el proyecto de Trappvel el
 * 2026-09-14, `…/Asistencia médica.pdf` respondió `Invalid key`. Los rótulos de los
 * bloques vienen en español ("5. Documentos del viajero"), así que se normalizan.
 */
export function carpetaSegura(texto: string): string {
  return slugSeguro(texto) || 'carpeta'
}

function slugSeguro(texto: string): string {
  return sinTildes(texto)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Un nombre de archivo aceptable como clave de Storage, conservando la extensión. */
export function nombreArchivoSeguro(nombre: string): string {
  const punto = nombre.lastIndexOf('.')
  const ext = punto > 0 ? extensionSegura(nombre.slice(punto + 1)) : ''
  // Sin extensión reconocible, el punto es parte del nombre y no se corta.
  const base = ext ? nombre.slice(0, punto) : nombre
  const baseLimpia = slugSeguro(base) || 'archivo'
  return ext ? `${baseLimpia}.${ext}` : baseLimpia
}

/** Extensión en minúsculas, solo letras y dígitos, máximo 8. Sin extensión válida → ''. */
export function extensionSegura(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '')
  return /^[a-z0-9]{1,8}$/.test(e) ? e : ''
}

function exigirNegocio(negocioId: string): string {
  if (!UUID.test(negocioId)) throw new Error(`negocioId inválido para ruta de almacenamiento: ${negocioId.slice(0, 40)}`)
  return negocioId.toLowerCase()
}

/** Prefijo de un negocio: `negocios/<id>/`. Usa el id y no el código, que puede cambiar. */
export function prefijoNegocio(negocioId: string): string {
  return `${CARPETA_NEGOCIOS}/${exigirNegocio(negocioId)}/`
}

/**
 * Ruta definitiva de un archivo: `negocios/<negocio_id>/<subcarpeta>/<nombre>`.
 * La subcarpeta admite varios niveles ("1. Legal/Propuestas") y es opcional.
 */
export function rutaArchivoNegocio(
  negocioId: string,
  subcarpeta: string | null | undefined,
  nombre: string,
): string {
  const segmentos = (subcarpeta ?? '')
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)
    .map(carpetaSegura)
  return `${prefijoNegocio(negocioId)}${[...segmentos, nombreArchivoSeguro(nombre)].join('/')}`
}

/** Ruta de una subida pendiente de confirmar. `marca` la pone quien llama (reloj como parámetro). */
export function rutaPendiente(
  negocioId: string,
  negocioBloqueId: string,
  extension: string,
  marca: number,
): string {
  const bloque = UUID.test(negocioBloqueId) ? negocioBloqueId.toLowerCase() : carpetaSegura(negocioBloqueId)
  const ext = extensionSegura(extension) || 'bin'
  return `${prefijoNegocio(negocioId)}${CARPETA_PENDIENTES}/${bloque}-${Math.trunc(marca)}.${ext}`
}

/** ¿La ruta es una subida pendiente de ESTE negocio? */
export function esRutaPendienteDe(path: string, negocioId: string): boolean {
  if (!UUID.test(negocioId)) return false
  return path.startsWith(`${prefijoNegocio(negocioId)}${CARPETA_PENDIENTES}/`) && negocioDeRuta(path) === negocioId.toLowerCase()
}

/** ¿La ruta cuelga del prefijo de ESTE negocio? */
export function esRutaDeNegocio(path: string, negocioId: string): boolean {
  if (!UUID.test(negocioId)) return false
  return negocioDeRuta(path) === negocioId.toLowerCase()
}
