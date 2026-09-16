// ============================================================
// Referencias estables a archivos: qué se guarda en la base en vez de una URL.
//
// Por qué una referencia y no una URL: una URL firmada vence, así que guardarla en la
// base deja un enlace muerto; y una URL pública solo funciona mientras el bucket sea
// público, que es justo lo que se está cerrando. Lo que se guarda es la referencia, en
// el MISMO campo donde un workspace en Drive guarda su `drive_url`, y el enlace para
// abrirlo se firma en el momento, en `/api/archivos/abrir` (que además valida sesión y
// workspace).
//
// DOS esquemas, porque son dos proyectos de Supabase distintos:
//
//   `sbext://<bucket>/<path>`  el proyecto del PROPIO CLIENTE (proveedor
//                              `supabase_externo`, hoy Trappvel). La ruta arranca en
//                              `negocios/<id>/`: NO trae el workspace, porque todo el
//                              proyecto es de un solo workspace.
//
//   `one://<bucket>/<path>`    los buckets del proyecto de ONE (`ve-documentos`,
//                              `gastos-soportes`). La ruta arranca en `<workspace_id>/`,
//                              porque el proyecto es compartido por los 17 workspaces:
//                              es el prefijo que ya exigen las policies de Storage.
//
// Esa diferencia de forma NO es un detalle: es la que decide con qué puerta se valida
// cada archivo (ver `duenoDeReferencia` abajo y `abrir.ts`).
//
// Módulo PURO y sin dependencias: lo importan el servidor y el navegador.
// ============================================================

/** Prefijo de toda referencia a un archivo en almacenamiento externo. */
export const PREFIJO_REFERENCIA = 'sbext://'

/** Bucket privado del proyecto externo donde ONE guarda los archivos de negocios. */
export const BUCKET_ARCHIVOS = 'one-documentos'

/** Prefijo de toda referencia a un archivo en los buckets del PROPIO proyecto de ONE. */
export const PREFIJO_REFERENCIA_ONE = 'one://'

/**
 * Los buckets de ONE que guardan archivos por referencia.
 *
 * Es una lista CERRADA, no un `startsWith`: la referencia llega del navegador en más de
 * un flujo, y sin la lista un `one://cert-databooks/...` haría que el endpoint firmara
 * un bucket que nada de esto gobierna.
 *
 *   · `ve-documentos`   documentos de negocio, pantallazos, soportes de pago
 *   · `gastos-soportes` el comprobante de un gasto
 */
export const BUCKETS_ONE = ['ve-documentos', 'gastos-soportes'] as const
export type BucketOne = (typeof BUCKETS_ONE)[number]

export const BUCKET_DOCUMENTOS_ONE: BucketOne = 've-documentos'
export const BUCKET_SOPORTES_GASTO: BucketOne = 'gastos-soportes'

/** Endpoint que valida sesión + workspace, firma por 5 minutos y redirige. */
export const RUTA_ABRIR_ARCHIVO = '/api/archivos/abrir'

/** Vista del repositorio de archivos de un negocio (reemplaza la carpeta de Drive). */
export function rutaRepositorioNegocio(negocioId: string): string {
  return `/negocios/${negocioId}/archivos`
}

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
 * Descompone `<prefijo><bucket>/<path>`. Devuelve null ante cualquier forma sospechosa:
 * un `..`, un segmento vacío o un bucket con caracteres raros no se "corrigen", se
 * rechazan (la referencia llega del navegador en más de un flujo).
 *
 * Los DOS esquemas pasan por aquí a propósito. Escrito dos veces, el día que a uno se le
 * agregue una forma sospechosa el otro se quedaría sin la guarda, y la que quedaría sin
 * guarda es justo la que apunta a los buckets compartidos por los 17 workspaces.
 */
function descomponer(ref: unknown, prefijo: string): { bucket: string; path: string } | null {
  if (typeof ref !== 'string' || !ref.startsWith(prefijo)) return null
  const resto = ref.slice(prefijo.length)
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

/** Descompone una referencia al proyecto del cliente (`sbext://`). */
export function parsearReferencia(ref: unknown): { bucket: string; path: string } | null {
  return descomponer(ref, PREFIJO_REFERENCIA)
}

/** Una referencia a un bucket del proyecto de ONE. */
export type ReferenciaOne = `one://${string}`

export function esReferenciaOne(valor: unknown): valor is ReferenciaOne {
  return typeof valor === 'string' && valor.startsWith(PREFIJO_REFERENCIA_ONE)
}

export function construirReferenciaOne(bucket: BucketOne, path: string): ReferenciaOne {
  return `${PREFIJO_REFERENCIA_ONE}${bucket}/${path}` as ReferenciaOne
}

/**
 * Descompone una referencia a un bucket de ONE, exigiendo que el bucket esté en la lista
 * cerrada. Un bucket ajeno devuelve null en vez de "casi" parsear: quien recibe null
 * responde 400, y eso es lo que impide que este endpoint se convierta en un firmador
 * genérico de cualquier objeto del proyecto.
 */
export function parsearReferenciaOne(ref: unknown): { bucket: BucketOne; path: string } | null {
  const partes = descomponer(ref, PREFIJO_REFERENCIA_ONE)
  if (!partes) return null
  if (!(BUCKETS_ONE as readonly string[]).includes(partes.bucket)) return null
  return { bucket: partes.bucket as BucketOne, path: partes.path }
}

/** ¿Es una referencia de cualquiera de los dos esquemas? */
export function esReferenciaArchivo(valor: unknown): boolean {
  return esReferenciaExterna(valor) || esReferenciaOne(valor)
}

/** El negocio dueño de una ruta `negocios/<uuid>/...`, o null si la ruta no es de un negocio. */
export function negocioDeRuta(path: string): string | null {
  const [raiz, id, siguiente] = path.split('/')
  if (raiz !== CARPETA_NEGOCIOS || !id || !UUID.test(id) || !siguiente) return null
  return id.toLowerCase()
}

// ── De quién es el archivo ───────────────────────────────────────────────────
//
// La ÚNICA derivación de dueño del producto. La usa `abrir.ts` para decidir con qué
// puerta se valida cada archivo, y por eso no se reimplementa en ningún consumidor:
// una segunda derivación deja a la pantalla listando lo que el endpoint no abre.
//
// Dos patas y no tres, y esa es la decisión que importa de este módulo:
//
//   `negocioId`   el archivo cuelga de un negocio. Pide la puerta del negocio
//                 (`puedeVerNegocio`: un `operator` solo ve los suyos).
//
//   `workspaceId` la RUTA declara el workspace. Se compara contra el de la sesión, que
//                 es exactamente lo que ya exigen las policies de Storage por prefijo.
//
// NO hay una pata "gasto" ni una "cobro", aunque `gastos-soportes/<ws>/<gasto>.jpg` y
// `ve-documentos/<ws>/pagos-externos/<uuid>.pdf` sean de un gasto y de un cobro. Dos
// razones medidas, no de comodidad:
//
//   1. Buscar el gasto para confirmar su workspace devolvería el MISMO workspace que ya
//      viene en la ruta. Sería un viaje a la base que no cambia ninguna respuesta.
//   2. Las pantallas que muestran esos enlaces —`/movimientos`, `/revisión`,
//      `/conciliación`— filtran por `workspace_id` y por ROL, nunca por negocio
//      (`getMovimientos` es literal: un solo `.eq('workspace_id', …)`). Una puerta por
//      gasto sería MÁS estrecha que la pantalla que pinta el enlace, así que el usuario
//      vería una fila cuyo soporte no puede abrir: el mismo desfase que este módulo
//      existe para evitar, entrando por el otro lado.
//
//   Y un gasto puede no tener negocio (gasto de empresa, gasto fijo): una tercera pata
//   se quedaría sin regla justo en ese caso.

export interface DuenoArchivo {
  /** Workspace que declara la RUTA. `null` cuando el esquema no lo trae (`sbext://`). */
  workspaceId: string | null
  /** Negocio dueño, o `null` si el archivo no cuelga de un negocio. */
  negocioId: string | null
}

/**
 * De quién es el archivo al que apunta la referencia. `null` si la referencia no es
 * válida o si su ruta no permite atribuirla a nadie — y entonces no se abre, en vez de
 * abrirse "por si acaso".
 */
export function duenoDeReferencia(ref: unknown): DuenoArchivo | null {
  const externa = parsearReferencia(ref)
  if (externa) {
    if (externa.bucket !== BUCKET_ARCHIVOS) return null
    const negocioId = negocioDeRuta(externa.path)
    return negocioId ? { workspaceId: null, negocioId } : null
  }

  const one = parsearReferenciaOne(ref)
  if (!one) return null
  const [ws, ...resto] = one.path.split('/')
  if (!UUID.test(ws) || resto.length === 0) return null
  return { workspaceId: ws.toLowerCase(), negocioId: negocioDeRuta(resto.join('/')) }
}

/**
 * El `href` con el que la pantalla abre un archivo. Una referencia (de cualquiera de los
 * dos esquemas) pasa por el endpoint que firma; cualquier otra URL (Drive, Storage
 * público heredado) queda igual, así que ni un workspace en Drive ni una fila que todavía
 * no se ha migrado cambian un solo enlace.
 */
export function hrefArchivo(
  url: string | null | undefined,
  opciones: { descargar?: boolean } = {},
): string | null {
  if (!url) return null
  if (!esReferenciaArchivo(url)) return url
  const descargar = opciones.descargar ? '&descargar=1' : ''
  return `${RUTA_ABRIR_ARCHIVO}?ref=${encodeURIComponent(url)}${descargar}`
}

/**
 * El mismo `href` pero ABSOLUTO, para un archivo que se abre fuera de la pantalla: hoy
 * la columna de soporte del Excel de revisión, que lo abre el contador desde Excel y ahí
 * una ruta relativa no resuelve contra nada.
 *
 * Sigue exigiendo sesión al abrirse — por eso NO sirve para el cliente final, que no
 * tiene cuenta en ONE (ese caso se resuelve con un enlace firmado de larga duración).
 */
export function hrefArchivoAbsoluto(
  base: string,
  url: string | null | undefined,
  opciones: { descargar?: boolean } = {},
): string | null {
  const href = hrefArchivo(url, opciones)
  if (!href) return null
  if (!href.startsWith(RUTA_ABRIR_ARCHIVO)) return href
  return `${base.replace(/\/+$/, '')}${href}`
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

// ── Rutas dentro de los buckets de ONE ─────────────────────────────────
//
// Todo objeto de `ve-documentos` y `gastos-soportes` cuelga de `<workspace_id>/`. No es
// una convención: es el prefijo que comparan las policies de Storage y, desde ahora, la
// puerta de `abrir.ts`. Un archivo escrito fuera de ese prefijo queda inabrible.

function exigirWorkspace(workspaceId: string): string {
  if (!UUID.test(workspaceId)) {
    throw new Error(`workspaceId inválido para ruta de almacenamiento: ${workspaceId.slice(0, 40)}`)
  }
  return workspaceId.toLowerCase()
}

/** Prefijo obligatorio de todo objeto de los buckets de ONE: `<workspace_id>/`. */
export function prefijoWorkspace(workspaceId: string): string {
  return `${exigirWorkspace(workspaceId)}/`
}

/**
 * ¿La ruta cuelga del prefijo de ESTE workspace?
 *
 * Compara el PRIMER SEGMENTO, no un `startsWith`: sin eso, `<ws>x/…` pasaría por ser un
 * prefijo de texto. Y no exige que el id tenga forma de uuid, a diferencia de los
 * constructores de arriba: este es un guard de escritura, y un id con otra forma no
 * debe hacerlo fallar en silencio (descartaría todo comprobante sin decir por qué).
 * La forma la exige `duenoDeReferencia`, que es quien decide si el archivo se abre.
 */
export function esRutaDeWorkspace(path: string, workspaceId: string): boolean {
  if (!workspaceId) return false
  const segmentos = path.split('/')
  if (segmentos.length < 2) return false
  if (segmentos.some(s => s === '' || s === '.' || s === '..')) return false
  return segmentos[0].toLowerCase() === workspaceId.toLowerCase()
}

/**
 * Ruta de un archivo en un bucket de ONE: `<workspace_id>/<segmentos...>`.
 *
 * Los segmentos se pasan tal cual (vienen de ids y slugs que ya saneó quien llama). Lo
 * que esta función garantiza es lo único que no puede fallar: el prefijo.
 */
export function rutaEnWorkspace(workspaceId: string, ...segmentos: string[]): string {
  const limpios = segmentos.flatMap(s => s.split('/')).map(s => s.trim()).filter(Boolean)
  if (limpios.length === 0) throw new Error('Ruta de almacenamiento sin segmentos')
  return `${prefijoWorkspace(workspaceId)}${limpios.join('/')}`
}

/** Referencia a un documento de negocio en `ve-documentos`. */
export function referenciaDocumentoNegocio(
  workspaceId: string,
  negocioId: string,
  negocioBloqueId: string,
  nombre: string,
): ReferenciaOne {
  return construirReferenciaOne(
    BUCKET_DOCUMENTOS_ONE,
    rutaEnWorkspace(workspaceId, CARPETA_NEGOCIOS, exigirNegocio(negocioId), negocioBloqueId, nombre),
  )
}
