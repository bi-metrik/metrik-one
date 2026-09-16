// ============================================================
// Los archivos que cuelgan de un COBRO: el soporte del pago y el recibo de caja.
//
// Los dos viven en Drive, y hasta ahora se entregaban abriendo el archivo a "cualquiera
// con el enlace" y mandando al usuario a drive.google.com. Ese permiso no vence,
// sobrevive al cierre del negocio y a que el correo se reenvie. Ninguno de los dos tiene
// un cliente final al otro lado: los lee el equipo, con sesion.
//
// Ahora se entregan por una ruta de ONE (`/api/archivos/cobro`) que baja los bytes con
// la cuenta de servicio, igual que `send-cuenta-cobro.ts` adjunta el PDF de una cuenta
// de cobro. Por eso `cuentas_cobro_emitidas` y `planillas_pila_periodo` fueron los dos
// unicos origenes que la medicion del 2026-09-16 encontro CERRADOS: nunca necesitaron
// abrirse.
//
// Modulo PURO: lo importan el navegador (para armar el href) y el servidor (para
// resolver el archivo). Sin el habria dos criterios, y el dia que uno cambie la pantalla
// pintaria un enlace que el endpoint no abre.
//
// La puerta, y por que es la que es
// ---------------------------------
// Sesion + que el cobro sea del workspace de quien pide. NO hay puerta por negocio, y no
// es un olvido: es el mismo criterio que `abrir.ts` ya documenta para el soporte de un
// pago. Las pantallas que pintan estos dos enlaces (el panel de pagos externos y el
// control de recibos de /conciliacion) filtran por workspace y por ROL, nunca por
// negocio. Una puerta por negocio seria MAS estrecha que la pantalla que pinta el
// enlace, y el usuario veria una fila cuyo soporte no puede abrir.
//
// Lo que si es innegociable: el id de Drive NO llega del navegador. Llega el id del
// COBRO, y el archivo se resuelve leyendo esa fila ya filtrada por workspace. Aceptar un
// `fileId` del cliente convertiria esta ruta en un descargador generico de cualquier
// archivo del Drive de MeTRIK: un hueco peor que el que se esta cerrando.
// ============================================================

import { esReferenciaArchivo, hrefArchivo } from './referencia'

/** Ruta que baja los bytes de un archivo de cobro con la cuenta de servicio. */
export const RUTA_ARCHIVO_COBRO = '/api/archivos/cobro'

/**
 * Los documentos que cuelgan de un cobro. Lista CERRADA: el nombre llega del navegador y
 * es lo que decide que columna se lee.
 */
export const DOCUMENTOS_COBRO = ['soporte', 'recibo'] as const
export type DocumentoCobro = (typeof DOCUMENTOS_COBRO)[number]

export function esDocumentoCobro(valor: unknown): valor is DocumentoCobro {
  return typeof valor === 'string' && (DOCUMENTOS_COBRO as readonly string[]).includes(valor)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un id de Drive: base64url, y nunca tan corto como para confundirlo con otra cosa. */
const ID_DRIVE = /^[A-Za-z0-9_-]{10,}$/

const HOSTS_DRIVE = new Set(['drive.google.com', 'docs.google.com'])

/**
 * El id de Drive detras de un enlace, con un parser EXPLICITO y no un split.
 *
 * Existe porque `cobros.siigo_recibo` guarda `archivo_url` y no el id (medido contra
 * produccion el 2026-09-16: 7 de 7 con la forma `/file/d/<id>/view?usp=drivesdk`). Desde
 * este cambio el id se guarda aparte; esto queda para las filas anteriores.
 *
 * Devuelve null ante cualquier cosa que no sea inequivocamente un enlace de Drive: un
 * `one://`, una URL de otro host, o un id con forma sospechosa. Null significa "no se
 * abre", nunca "se intenta igual".
 */
export function idDeArchivoDrive(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith('http')) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (!HOSTS_DRIVE.has(u.hostname.toLowerCase())) return null

  // `.../file/d/<id>/view`, `.../d/<id>/edit`
  const segmentos = u.pathname.split('/').filter(Boolean)
  const i = segmentos.indexOf('d')
  const porRuta = i >= 0 ? segmentos[i + 1] : undefined
  if (porRuta && ID_DRIVE.test(porRuta)) return porRuta

  // `.../open?id=<id>`, `.../uc?export=download&id=<id>`
  const porQuery = u.searchParams.get('id')
  if (porQuery && ID_DRIVE.test(porQuery)) return porQuery

  return null
}

/** La parte de un cobro que este modulo necesita. Se lee con filtro por workspace. */
export interface FilaCobroArchivo {
  soporte?: {
    url?: string | null
    file_name?: string | null
    mime_type?: string | null
    drive_file_id?: string | null
  } | null
  siigo_recibo?: {
    numero?: string | null
    archivo_url?: string | null
    drive_file_id?: string | null
  } | null
}

export interface ArchivoDeCobro {
  fileId: string
  fileName: string
  mimeType: string
}

/**
 * Nombre servible: sin controles, comillas ni separadores de ruta. Viaja en una cabecera
 * `Content-Disposition`, donde un salto de linea o una comilla parten la respuesta.
 */
function nombreServible(nombre: string, respaldo: string): string {
  let limpio = ''
  for (const ch of nombre) {
    const c = ch.charCodeAt(0)
    if (c < 32 || c === 127) continue
    if (ch === '"' || ch === '\\' || ch === '/') continue
    limpio += ch
  }
  return limpio.trim() || respaldo
}

/**
 * Que archivo de Drive es, a partir de la fila del cobro.
 *
 * Prefiere el id guardado aparte y cae al del enlace solo si no lo hay: el id es estable
 * y el enlace es una forma que Drive puede cambiar.
 */
export function archivoDeCobro(
  fila: FilaCobroArchivo | null | undefined,
  doc: DocumentoCobro,
): ArchivoDeCobro | null {
  if (!fila) return null

  if (doc === 'soporte') {
    const s = fila.soporte
    if (!s) return null
    const fileId = (s.drive_file_id || '').trim() || idDeArchivoDrive(s.url)
    if (!fileId || !ID_DRIVE.test(fileId)) return null
    return {
      fileId,
      fileName: nombreServible(s.file_name ?? '', 'soporte'),
      mimeType: (s.mime_type || '').trim() || 'application/octet-stream',
    }
  }

  const r = fila.siigo_recibo
  if (!r) return null
  const fileId = (r.drive_file_id || '').trim() || idDeArchivoDrive(r.archivo_url)
  if (!fileId || !ID_DRIVE.test(fileId)) return null
  const numero = nombreServible(r.numero ?? '', 'recibo')
  return { fileId, fileName: `${numero}.pdf`, mimeType: 'application/pdf' }
}

/**
 * El `href` con el que la pantalla abre un archivo de cobro.
 *
 * Una referencia (`one://`, `sbext://`) sigue por la puerta que ya existe: esos archivos
 * viven en Storage, que ya es privado, y `/api/archivos/abrir` los firma. Solo lo que
 * apunta a Drive pasa por la ruta nueva. Sin url no hay enlace: un recibo emitido cuyo
 * PDF no se pudo archivar existe igual, y la pantalla lo dice en vez de ofrecer un
 * enlace que no lleva a ninguna parte.
 */
export function hrefArchivoDeCobro(
  cobroId: string | null | undefined,
  doc: DocumentoCobro,
  url: string | null | undefined,
  opciones: { descargar?: boolean } = {},
): string | null {
  if (!url) return null
  if (esReferenciaArchivo(url)) return hrefArchivo(url, opciones)
  if (!cobroId) return null
  const descargar = opciones.descargar ? '&descargar=1' : ''
  return `${RUTA_ARCHIVO_COBRO}?cobro=${encodeURIComponent(cobroId)}&doc=${doc}${descargar}`
}

export type ResultadoArchivoCobro =
  | { tipo: 'archivo'; workspaceId: string; archivo: ArchivoDeCobro }
  | { tipo: 'error'; status: 400 | 401 | 404; mensaje: string }

export interface DependenciasArchivoCobro {
  /** Workspace efectivo de la sesion (respeta "Ver como"), o null sin sesion. */
  workspaceDeSesion(): Promise<string | null>
  /** La fila del cobro, leida YA filtrada por workspace. null si no es de ese workspace. */
  cobroDelWorkspace(cobroId: string, workspaceId: string): Promise<FilaCobroArchivo | null>
}

const NO_ENCONTRADO = { tipo: 'error', status: 404, mensaje: 'Archivo no encontrado' } as const

/**
 * Las puertas, en orden. 404 y no 403 en los dos ultimos casos: a quien no es del
 * workspace no se le confirma que el cobro existe.
 */
export async function resolverArchivoDeCobro(
  cobroId: string | null,
  doc: string | null,
  deps: DependenciasArchivoCobro,
): Promise<ResultadoArchivoCobro> {
  if (!cobroId || !UUID.test(cobroId) || !esDocumentoCobro(doc)) {
    return { tipo: 'error', status: 400, mensaje: 'Peticion de archivo invalida' }
  }

  const workspaceId = await deps.workspaceDeSesion()
  if (!workspaceId) {
    return { tipo: 'error', status: 401, mensaje: 'Inicia sesion para abrir este archivo' }
  }

  const fila = await deps.cobroDelWorkspace(cobroId, workspaceId)
  if (!fila) return NO_ENCONTRADO

  const archivo = archivoDeCobro(fila, doc)
  if (!archivo) return NO_ENCONTRADO

  return { tipo: 'archivo', workspaceId, archivo }
}
