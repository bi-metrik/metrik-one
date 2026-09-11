/**
 * Decisiones del envio del Excel de negocios a Google Drive.
 *
 * Este modulo es PURO: no sabe de Supabase, ni de Drive, ni de XLSX. Recibe lo que ya se
 * leyo (la config del workspace, la ficha del archivo en Drive, los permisos que ya
 * tiene) y devuelve QUE hay que hacer. La server action ejecuta.
 *
 * Se separa por lo de siempre: las tres reglas que deciden si se pisa el archivo de un
 * cliente o se crea uno nuevo son justo las que hay que poder ejercitar sin red.
 *
 * ── El modelo: UN archivo, actualizado en sitio ──
 *
 * Decision cerrada (2026-09-10): la descarga a Drive NO crea un archivo por clic. Hay un
 * unico documento por workspace, se sobreescribe su contenido y el enlace no cambia
 * nunca — quien lo tenga guardado sigue viendo el dato de hoy. El `fileId` vive en
 * `config_extra.drive_export_negocios.file_id`.
 */

// ── Llave de configuracion ──────────────────────────────────────────────────

/**
 * Donde vive todo lo de este frente dentro de `config_extra`.
 *
 * Un solo objeto contenedor en vez de dos claves sueltas (`..._file_id` y
 * `..._correos`) porque las dos se leen y se escriben juntas, y porque asi el
 * `jsonb_set` del reclamo apunta a una sola rama.
 *
 * ```json
 * "drive_export_negocios": {
 *   "file_id": "1AbC…",                              // lo escribe el sistema
 *   "compartir_con": ["deisy.ramirez@gruposoena.com"] // lo pone una persona
 * }
 * ```
 */
export const LLAVE_EXPORT_DRIVE = 'drive_export_negocios'

/** Sub-llaves, nombradas una vez para que el SQL y el TypeScript no se separen. */
export const LLAVE_FILE_ID = 'file_id'
export const LLAVE_CORREOS = 'compartir_con'

// ── Entradas ────────────────────────────────────────────────────────────────

/** Un `config_extra` cualquiera, tal como sale de la base. */
export type ConfigExtra = Record<string, unknown> | null | undefined

/** Lo que Drive dice de un archivo. `null` = no existe (404) o no se pudo leer. */
export type FichaArchivoDrive = {
  id: string
  trashed: boolean
  /**
   * `true` si el archivo lo puede escribir quien pregunta. Un archivo que existe pero
   * que dejo de ser nuestro tampoco se puede actualizar.
   */
  puedeEditar?: boolean
} | null

/** Un permiso ya concedido sobre el archivo. */
export type PermisoDrive = {
  emailAddress?: string | null
  role?: string | null
  type?: string | null
}

// ── Lectura de la configuracion ─────────────────────────────────────────────

/**
 * Resuelve la config del export recorriendo los ambitos en orden de precedencia.
 *
 * Se recibe una LISTA a proposito. Hoy la unica fuente es el workspace, pero el
 * `drive_folder_id` de este mismo producto ya se resuelve «linea primero, workspace
 * despues» (`ensureNegocioDriveFolder`), y el dia que una linea necesite su propio
 * archivo basta con pasarle su `config_extra` de primero: no hay que tocar esta funcion
 * ni a quien la llama para decidir.
 *
 * Gana el PRIMER ambito que traiga la clave, y gana por clave, no en bloque: una linea
 * puede fijar su `file_id` y heredar los correos del workspace. Lo contrario obligaria a
 * repetir la lista de correos en cada linea, que es justo como se desincronizan.
 */
export function leerConfigExportDrive(ambitos: ConfigExtra[]): {
  fileId: string | null
  correos: string[]
} {
  let fileId: string | null = null
  let correos: string[] | null = null

  for (const cfg of ambitos) {
    const bloque = (cfg ?? {})[LLAVE_EXPORT_DRIVE]
    if (!bloque || typeof bloque !== 'object' || Array.isArray(bloque)) continue
    const b = bloque as Record<string, unknown>

    if (fileId === null) {
      const crudo = b[LLAVE_FILE_ID]
      if (typeof crudo === 'string' && crudo.trim() !== '') fileId = crudo.trim()
    }
    if (correos === null && Array.isArray(b[LLAVE_CORREOS])) {
      correos = normalizarCorreos(b[LLAVE_CORREOS] as unknown[])
    }
  }

  return { fileId, correos: correos ?? [] }
}

/**
 * Deja la lista de correos en algo con lo que se pueda llamar a Drive.
 *
 * Recorta, baja a minusculas y descarta lo que no parezca un correo. Es config escrita a
 * mano: una entrada vacia o un nombre suelto no puede tumbar la subida entera, y tampoco
 * puede viajar a la API como si fuera una direccion. Se descarta en silencio y el
 * archivo sube igual — compartir es un paso aparte de subir, y esa es la razon por la que
 * el orden importa (ver `PLAN` abajo).
 *
 * ⚠️ La comprobacion es a proposito laxa (hay algo, una arroba en el medio, un punto en
 * el dominio). Un validador estricto de RFC rechazaria direcciones reales y el sintoma
 * seria «a esa persona no le llega», que es peor que intentar y que Drive lo rechace.
 */
export function normalizarCorreos(crudos: unknown[]): string[] {
  const vistos = new Set<string>()
  const out: string[] = []
  for (const c of crudos) {
    if (typeof c !== 'string') continue
    const limpio = c.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) continue
    if (vistos.has(limpio)) continue
    vistos.add(limpio)
    out.push(limpio)
  }
  return out
}

// ── Crear vs. actualizar ────────────────────────────────────────────────────

export type AccionArchivo =
  | { accion: 'actualizar'; fileId: string }
  | { accion: 'crear'; soltarFileId: string | null; motivo: MotivoCreacion }

export type MotivoCreacion = 'sin_file_id' | 'no_existe' | 'en_papelera' | 'sin_permiso'

/**
 * Decide si el clic actualiza el archivo que ya hay o crea uno nuevo.
 *
 * ⚠️ Un `file_id` guardado NO alcanza para actualizar: el archivo pudo borrarse o irse a
 * la papelera desde el propio Drive del cliente, y ahi el `files.update` responde 404
 * para siempre. Sin este paso, el boton quedaria roto de forma permanente y la unica
 * salida seria que alguien editara `config_extra` a mano. Por eso se pregunta por la
 * ficha ANTES de escribir, y un archivo inalcanzable se trata como si no existiera.
 *
 * `soltarFileId` es el id que hay que soltar de la config antes de reclamar uno nuevo, y
 * viene aparte del motivo porque quien ejecuta tiene que poder soltar **ese** id y no
 * cualquiera: si entre la lectura y el borrado otra persona ya reclamo un archivo sano,
 * soltar a ciegas tirarian el bueno.
 */
export function decidirAccionArchivo(
  fileId: string | null,
  ficha: FichaArchivoDrive,
): AccionArchivo {
  if (!fileId) return { accion: 'crear', soltarFileId: null, motivo: 'sin_file_id' }
  if (ficha === null) return { accion: 'crear', soltarFileId: fileId, motivo: 'no_existe' }
  if (ficha.trashed) return { accion: 'crear', soltarFileId: fileId, motivo: 'en_papelera' }
  if (ficha.puedeEditar === false) {
    return { accion: 'crear', soltarFileId: fileId, motivo: 'sin_permiso' }
  }
  return { accion: 'actualizar', fileId }
}

// ── El reclamo del archivo ──────────────────────────────────────────────────

/**
 * Lo que la base contesto al reclamo del `file_id`.
 *
 * `no_se_guardo` existe para que NO se pueda confundir con `gane`. Son indistinguibles
 * desde afuera —en los dos casos «no me devolvieron el id de otro»— y esa confusion es
 * justo la que convierte un defecto en un fallo mudo: la version anterior de este codigo
 * preguntaba `typeof ganador === 'string' && ganador !== elMio` y mandaba TODO lo demas
 * al `else` del camino feliz, incluido el `null`. Con eso, un reclamo que no escribio
 * nada le entregaba al usuario un enlace que funcionaba y dejaba el `file_id` sin
 * guardar: el clic siguiente creaba otra hoja y abandonaba la anterior, sin un solo
 * error en ningun lado.
 */
export type Reclamo =
  | { resultado: 'gane'; fileId: string }
  | { resultado: 'perdi'; fileId: string }
  | { resultado: 'no_se_guardo' }

/**
 * Clasifica la respuesta de `reclamar_export_negocios_file_id`.
 *
 * La RPC devuelve el id que QUEDO guardado, que puede no ser el que se mando (si otra
 * persona gano la carrera). Solo hay tres desenlaces posibles y los tres tienen que ser
 * explicitos:
 *
 *   - vuelve mi id        → gane, el archivo que acabo de crear es el del workspace
 *   - vuelve otro id      → perdi: el mio sobra y el bueno es el que vuelve
 *   - no vuelve ningun id → NADA quedo guardado; quien llama tiene que fallar, no seguir
 *
 * El tercero no deberia ocurrir nunca: la funcion escribe y despues relee. Si ocurre, o
 * el workspace no existe, o la escritura no tomo — y en los dos casos continuar deja un
 * archivo huerfano en el Drive del cliente por cada clic. Se clasifica aqui, y no dentro
 * de la server action, para poder ejercitarlo sin red ni base.
 */
export function interpretarReclamo(devuelto: unknown, fileIdPropio: string): Reclamo {
  const guardado = typeof devuelto === 'string' ? devuelto.trim() : ''
  if (guardado === '') return { resultado: 'no_se_guardo' }
  return guardado === fileIdPropio.trim()
    ? { resultado: 'gane', fileId: guardado }
    : { resultado: 'perdi', fileId: guardado }
}

// ── Compartir ───────────────────────────────────────────────────────────────

/**
 * Los correos a los que todavia hay que darles permiso.
 *
 * Se compara contra los permisos que el archivo YA tiene para no volver a llamar a
 * `permissions.create` en cada clic. No es solo ahorro de peticiones: Drive puede avisar
 * por correo al conceder un permiso, y repetirlo cada vez que alguien oprime el boton
 * convierte una funcion util en ruido que la gente aprende a ignorar.
 *
 * Solo se mira la direccion, no el rol: si a alguien le subieron el permiso a editor a
 * mano dentro de Drive, esta funcion NO se lo baja a lector. Bajarlo seria pisar una
 * decision que alguien tomo con el archivo delante, y este boton no tiene contexto para
 * eso.
 */
export function correosPendientes(deseados: string[], permisos: PermisoDrive[]): string[] {
  const yaTienen = new Set(
    permisos
      .map((p) => (p.emailAddress ?? '').trim().toLowerCase())
      .filter((e) => e !== ''),
  )
  return normalizarCorreos(deseados).filter((c) => !yaTienen.has(c))
}

// ── Nombre del archivo ──────────────────────────────────────────────────────

/**
 * El nombre del documento en Drive.
 *
 * SIN fecha, a proposito: el archivo es uno solo y se actualiza en sitio, asi que
 * ponerle la fecha del dia en que se creo lo dejaria mintiendo desde el segundo clic.
 * La fecha del dato vive en la propia hoja (la descarga la lleva en el nombre del .xlsx
 * porque ahi si cada archivo es una foto distinta).
 */
export function nombreArchivoDrive(nombreWorkspace: string): string {
  const limpio = nombreWorkspace.trim()
  return limpio === '' ? 'Negocios' : `Negocios — ${limpio}`
}

// ── El plan completo, para poder leerlo de un vistazo ───────────────────────

/**
 * PLAN de una corrida, en el orden en que la server action lo ejecuta:
 *
 *   1. leer config  →  `leerConfigExportDrive`
 *   2. si hay file_id, pedir su ficha a Drive
 *   3. `decidirAccionArchivo`
 *        actualizar → `files.update` (multipart, mimeType de conversion)
 *        crear      → soltar el id roto (comparando contra el que se leyo),
 *                     `files.create`, y RECLAMAR el id en la base;
 *                     si el reclamo lo gano otro, se manda el propio a la papelera
 *                     y se actualiza el del ganador
 *   4. `correosPendientes` → `permissions.create` uno por uno
 *   5. devolver el enlace
 *
 * El paso 4 va DESPUES del 3 y nunca al reves: si compartir falla, el archivo ya esta
 * subido y el usuario tiene su enlace. Al reves, un correo mal escrito en la config
 * dejaria sin dato a todo el mundo.
 */
export const ORDEN_DE_EJECUCION = [
  'leer_config',
  'ficha_archivo',
  'crear_o_actualizar',
  'compartir',
] as const
