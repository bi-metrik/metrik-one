import 'server-only'

/**
 * La biblioteca de fotos del workspace (`fotos_catalogo`): leer, sugerir desde Wikimedia Commons,
 * elegir de una de las tres fuentes, marcar la principal y quitar.
 *
 * Hasta TRES fotos por elemento (ciudad, hotel o actividad), una principal (migración
 * `20261016153000`): la base lo hace cumplir con el puesto (`posicion` 1 a 3, único por elemento)
 * y con un índice único parcial sobre `principal`; aquí se respeta antes de subir nada.
 *
 * Recibe el cliente de Supabase de la sesión (RLS por workspace) y el workspace YA revisado por
 * la acción. Los archivos van por `catalogo-almacen.ts`.
 *
 * Sin la migración del catálogo la tabla no existe: leer devuelve un catálogo vacío y escribir
 * devuelve el motivo, nunca un error sin explicar. La propuesta sale como hoy.
 */
import { puestoParaCategoria, type CategoriaFoto } from './categoria'
import { borrarDeCatalogo, bytesDeCatalogo, guardarEnCatalogo, prepararFoto, type FotoPreparada } from './catalogo-almacen'
import { MAX_FOTOS_POR_ELEMENTO, nombreLlano, seSugiereDeCommons, type ObjetivoFoto, type OrigenFoto, type TipoFoto } from './clave'
import { bajarFotoDeSitio, type Resolver } from './sitio-oficial'
import { AGENTE_COMMONS, archivoDeCommons, buscarEnCommons, consultasDeFoto, creditoDeCatalogo, elegirCandidata, esDeWikimedia, type CandidataFoto } from './wikimedia'

export const TABLA_CATALOGO = 'fotos_catalogo'
export const MENSAJE_SIN_TABLA = 'La biblioteca de fotos todavía no está disponible: falta aplicar la migración de la base.'
export const MENSAJE_HOTEL_SIN_COMMONS = 'La foto de un hotel la elige una persona: usa «Elegir foto» o «Subir la mía».'
export const MENSAJE_TOPE = `Ya tiene ${MAX_FOTOS_POR_ELEMENTO} fotos: cambia una o quítala para poner otra.`

export interface FilaCatalogo {
  id: string
  tipo: TipoFoto
  clave: string
  nombre_clave: string
  nombre: string
  ciudad: string | null
  ref: string
  origen: OrigenFoto
  fuente_url: string | null
  titulo_fuente: string | null
  autor: string | null
  licencia: string | null
  foco_x: number | null
  foco_y: number | null
  proporcion: number | null
  revisada: boolean
  descartadas: string[]
  /** La que sale primero. Una por elemento. */
  principal: boolean
  /** Puesto 1 a 3 dentro del elemento. */
  posicion: number
  /** Origen `sitio_oficial`: la imagen bajada (`fuente_url` es la página). */
  imagen_url: string | null
  /**
   * Hotel: fachada, habitación o zonas comunes (migración `20261016221500`). `null` en las filas
   * de antes y en ciudades y actividades.
   */
  categoria: CategoriaFoto | null
}

export const COLUMNAS =
  'id, tipo, clave, nombre_clave, nombre, ciudad, ref, origen, fuente_url, titulo_fuente, autor, licencia, foco_x, foco_y, proporcion, revisada, descartadas, principal, posicion, imagen_url, categoria'

/** El crédito que imprime el documento para esta foto (`null` = propia, sin crédito). */
export function creditoDeFila(f: Pick<FilaCatalogo, 'nombre' | 'autor' | 'licencia' | 'origen' | 'fuente_url'>): string | null {
  if (f.origen === 'wikimedia') return creditoDeCatalogo(f)
  if (f.origen === 'sitio_oficial' && f.fuente_url) {
    try {
      return `${f.nombre}, foto de ${new URL(f.fuente_url).hostname.replace(/^www\./, '')}`
    } catch {
      return null
    }
  }
  return null
}

/** ¿Este error es «la tabla o la columna no existe» (migración sin aplicar)? */
function sinTabla(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204' || /fotos_catalogo/.test(error.message ?? '')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

// ── Lectura ───────────────────────────────────────────────────────────────────

/** Principal primero, luego por puesto. */
function ordenar(filas: FilaCatalogo[]): FilaCatalogo[] {
  return [...filas].sort((a, b) => Number(b.principal !== false) - Number(a.principal !== false) || (a.posicion ?? 1) - (b.posicion ?? 1))
}

/**
 * Las filas del catálogo para lo que pide una cotización: por tipo y llave, y las actividades
 * también por nombre (un plan opcional del documento no siempre sabe su ciudad). Trae TODAS las
 * fotos de cada elemento (principal y extras).
 */
export async function leerCatalogo(
  supabase: Cliente,
  workspaceId: string,
  pedido: { objetivos?: ObjetivoFoto[]; nombresDeActividad?: string[] },
): Promise<FilaCatalogo[]> {
  const claves = [...new Set((pedido.objetivos ?? []).map((o) => o.clave))]
  const nombres = [...new Set((pedido.nombresDeActividad ?? []).map(nombreLlano).filter(Boolean))]
  if (claves.length === 0 && nombres.length === 0) return []
  const filas: FilaCatalogo[] = []
  try {
    if (claves.length > 0) {
      const { data, error } = await supabase.from(TABLA_CATALOGO).select(COLUMNAS).eq('workspace_id', workspaceId).in('clave', claves)
      if (error) {
        if (!sinTabla(error)) console.warn('[fotos-catalogo] no se pudo leer:', error.message)
        return []
      }
      filas.push(...((data ?? []) as FilaCatalogo[]))
    }
    if (nombres.length > 0) {
      const { data, error } = await supabase
        .from(TABLA_CATALOGO)
        .select(COLUMNAS)
        .eq('workspace_id', workspaceId)
        .eq('tipo', 'actividad')
        .in('nombre_clave', nombres)
      if (!error) filas.push(...((data ?? []) as FilaCatalogo[]))
    }
  } catch (e) {
    console.warn('[fotos-catalogo] no se pudo leer:', e instanceof Error ? e.message : e)
    return []
  }
  const vistos = new Set<string>()
  return filas.filter((f) => (vistos.has(f.id) ? false : (vistos.add(f.id), true)))
}

/** Todas las fotos de un elemento, la principal primero. */
export function fotosDe(filas: FilaCatalogo[], o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): FilaCatalogo[] {
  return ordenar(filas.filter((f) => f.tipo === o.tipo && f.clave === o.clave))
}

/** La foto principal de un elemento, si la hay (sin ninguna marcada, la del primer puesto). */
export function filaDe(filas: FilaCatalogo[], o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): FilaCatalogo | null {
  return fotosDe(filas, o)[0] ?? null
}

/** Las otras fotos del elemento (sin la principal), hasta dos. */
export function extrasDe(filas: FilaCatalogo[], o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): FilaCatalogo[] {
  return fotosDe(filas, o).slice(1, MAX_FOTOS_POR_ELEMENTO)
}

/**
 * La foto principal de un plan opcional por su nombre: la de su ciudad si la hay entre
 * `ciudades`, si no la única con ese nombre. Con varias de otras ciudades, ninguna (un «City
 * tour» de París no ilustra uno de Roma).
 */
export function actividadPorNombre(filas: FilaCatalogo[], nombre: string, claveCiudades: string[]): FilaCatalogo | null {
  const n = nombreLlano(nombre)
  const claves = [...new Set(filas.filter((f) => f.tipo === 'actividad' && f.nombre_clave === n).map((f) => f.clave))]
  if (claves.length === 0) return null
  const principal = (clave: string) => filaDe(filas, { tipo: 'actividad', clave })
  const enElViaje = claves.find((c) => claveCiudades.some((x) => x !== '' && c.endsWith(`|${x}`)))
  if (enElViaje) return principal(enElViaje)
  const sinCiudad = claves.find((c) => c.endsWith('|'))
  if (sinCiudad) return principal(sinCiudad)
  return claves.length === 1 ? principal(claves[0]) : null
}

/** Un elemento de la biblioteca con sus fotos (la principal primero). */
export interface ElementoBiblioteca {
  tipo: TipoFoto
  clave: string
  nombre: string
  ciudad: string | null
  fotos: FilaCatalogo[]
}

export function elementosDe(filas: FilaCatalogo[]): ElementoBiblioteca[] {
  const porClave = new Map<string, FilaCatalogo[]>()
  for (const f of filas) porClave.set(`${f.tipo}:${f.clave}`, [...(porClave.get(`${f.tipo}:${f.clave}`) ?? []), f])
  const orden: Record<TipoFoto, number> = { hotel: 0, actividad: 1, ciudad: 2 }
  return [...porClave.values()]
    .map((fs) => {
      const o = ordenar(fs)
      return { tipo: o[0].tipo, clave: o[0].clave, nombre: o[0].nombre, ciudad: o[0].ciudad, fotos: o }
    })
    .sort((a, b) => orden[a.tipo] - orden[b.tipo] || a.nombre.localeCompare(b.nombre, 'es'))
}

/** Tope de filas que lee la biblioteca de una vez (cientos de elementos por agencia). */
const TOPE_BIBLIOTECA = 3000

/**
 * La biblioteca entera del workspace, o lo que coincide con `buscar` (nombre o ciudad, sin
 * tildes) y con `tipo`. El filtro va en el servidor de ONE, no en un `.or()` de PostgREST.
 */
export async function leerBiblioteca(
  supabase: Cliente,
  workspaceId: string,
  filtro: { tipo?: TipoFoto | null; buscar?: string | null } = {},
): Promise<{ ok: true; elementos: ElementoBiblioteca[] } | { ok: false; mensaje: string }> {
  let q = supabase.from(TABLA_CATALOGO).select(COLUMNAS).eq('workspace_id', workspaceId)
  if (filtro.tipo) q = q.eq('tipo', filtro.tipo)
  const { data, error } = await q.limit(TOPE_BIBLIOTECA)
  if (error) return { ok: false, mensaje: sinTabla(error) ? MENSAJE_SIN_TABLA : 'No se pudo leer la biblioteca de fotos.' }
  const buscado = nombreLlano(filtro.buscar ?? '')
  const elementos = elementosDe((data ?? []) as FilaCatalogo[]).filter(
    (e) => !buscado || `${nombreLlano(e.nombre)} ${nombreLlano(e.ciudad)}`.includes(buscado),
  )
  return { ok: true, elementos }
}

// ── Escritura ─────────────────────────────────────────────────────────────────

type Resultado = { ok: true; fila: FilaCatalogo } | { ok: false; mensaje: string }

/** ¿Algún otro registro usa este archivo? (la misma foto puede ilustrar dos cosas). */
async function archivoEnUso(supabase: Cliente, workspaceId: string, ref: string, salvoId: string): Promise<boolean> {
  const { data } = await supabase.from(TABLA_CATALOGO).select('id').eq('workspace_id', workspaceId).eq('ref', ref).neq('id', salvoId).limit(1)
  return Array.isArray(data) && data.length > 0
}

async function fotosDelElemento(supabase: Cliente, workspaceId: string, o: Pick<ObjetivoFoto, 'tipo' | 'clave'>) {
  const { data, error } = await supabase.from(TABLA_CATALOGO).select(COLUMNAS).eq('workspace_id', workspaceId).eq('tipo', o.tipo).eq('clave', o.clave)
  if (error) return { error: sinTabla(error) ? MENSAJE_SIN_TABLA : 'No se pudo leer la biblioteca de fotos.' }
  return { filas: ordenar((data ?? []) as FilaCatalogo[]) }
}

/** Los campos de la foto que dicen de dónde salió. */
type Procedencia = Pick<FilaCatalogo, 'origen' | 'fuente_url' | 'titulo_fuente' | 'autor' | 'licencia' | 'imagen_url' | 'revisada'> & {
  descartadas?: string[]
}

/**
 * Guarda una foto ya preparada en un elemento:
 *  · `reemplaza` = el id de una de sus fotos → esa cambia (conserva su puesto y si es principal);
 *  · sin `reemplaza` → se agrega en el primer puesto libre; la primera del elemento es la
 *    principal. Con tres, no entra (`MENSAJE_TOPE`) y no se sube nada.
 *  · un HOTEL con `categoria` y sin `reemplaza` → el reparto por categoría decide
 *    (`puestoParaCategoria`): si ya tiene una de esa categoría, la cambia; si no, se agrega.
 */
export async function guardarFoto(a: {
  supabase: Cliente
  workspaceId: string
  staffId: string | null
  objetivo: ObjetivoFoto
  foto: FotoPreparada
  procedencia: Procedencia
  reemplaza?: string | null
  /** Hotel: la pestaña donde se eligió. Sin ella (quien llamaba antes), la foto queda sin categoría. */
  categoria?: CategoriaFoto | null
}): Promise<Resultado> {
  const leidas = await fotosDelElemento(a.supabase, a.workspaceId, a.objetivo)
  if ('error' in leidas) return { ok: false, mensaje: leidas.error as string }
  const actuales = leidas.filas
  let reemplaza = a.reemplaza ?? null
  if (!reemplaza && a.objetivo.tipo === 'hotel' && a.categoria !== undefined) {
    const puesto = puestoParaCategoria(actuales, a.categoria ?? null)
    if (puesto.tipo === 'tope') return { ok: false, mensaje: MENSAJE_TOPE }
    if (puesto.tipo === 'reemplazar') reemplaza = puesto.id
  }
  const anterior = reemplaza ? actuales.find((f) => f.id === reemplaza) ?? null : null
  if (reemplaza && !anterior) return { ok: false, mensaje: 'Esa foto ya no está en la biblioteca. Recarga.' }
  const ocupados = new Set(actuales.map((f) => f.posicion ?? 1))
  const libre = [1, 2, 3].slice(0, MAX_FOTOS_POR_ELEMENTO).find((p) => !ocupados.has(p))
  if (!anterior && (actuales.length >= MAX_FOTOS_POR_ELEMENTO || !libre)) return { ok: false, mensaje: MENSAJE_TOPE }

  let ref: string
  try {
    ref = await guardarEnCatalogo(a.workspaceId, a.objetivo.tipo, a.foto)
  } catch {
    return { ok: false, mensaje: 'No se pudo guardar la foto. Vuelve a intentarlo.' }
  }
  const fila = {
    workspace_id: a.workspaceId,
    tipo: a.objetivo.tipo,
    clave: a.objetivo.clave,
    nombre_clave: nombreLlano(a.objetivo.nombre),
    nombre: a.objetivo.nombre,
    ciudad: a.objetivo.ciudad,
    ref,
    origen: a.procedencia.origen,
    fuente_url: a.procedencia.fuente_url,
    titulo_fuente: a.procedencia.titulo_fuente,
    autor: a.procedencia.autor,
    licencia: a.procedencia.licencia,
    imagen_url: a.procedencia.imagen_url,
    categoria: a.objetivo.tipo === 'hotel' ? a.categoria ?? null : null,
    revisada: a.procedencia.revisada,
    descartadas: a.procedencia.descartadas ?? anterior?.descartadas ?? [],
    foco_x: null,
    foco_y: null,
    proporcion: a.foto.ancho / a.foto.alto,
    updated_by: a.staffId,
    updated_at: new Date().toISOString(),
  }
  const consulta = anterior
    ? a.supabase.from(TABLA_CATALOGO).update(fila).eq('id', anterior.id).eq('workspace_id', a.workspaceId)
    : a.supabase.from(TABLA_CATALOGO).insert({ ...fila, posicion: libre, principal: actuales.length === 0, created_by: a.staffId })
  const { data, error } = await consulta.select(COLUMNAS).maybeSingle()
  if (error || !data) {
    // El archivo nuevo ya se subió: si la fila no quedó, se borra.
    await borrarDeCatalogo(a.workspaceId, ref)
    const tope = error?.code === '23505' || error?.code === '23514'
    return { ok: false, mensaje: sinTabla(error) ? MENSAJE_SIN_TABLA : tope ? MENSAJE_TOPE : 'No se pudo guardar la foto en la biblioteca.' }
  }
  if (anterior && anterior.ref !== ref && !(await archivoEnUso(a.supabase, a.workspaceId, anterior.ref, anterior.id))) {
    await borrarDeCatalogo(a.workspaceId, anterior.ref)
  }
  return { ok: true, fila: data as FilaCatalogo }
}

/** Baja una candidata de Commons (de sus servidores) y la deja lista para guardar. */
async function bajarDeCommons(c: CandidataFoto, f: typeof fetch): Promise<FotoPreparada | string> {
  if (!esDeWikimedia(c.descarga)) return 'No se pudo bajar la foto de Wikimedia Commons.'
  try {
    const r = await f(c.descarga, { headers: { 'User-Agent': AGENTE_COMMONS }, signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return 'No se pudo bajar la foto de Wikimedia Commons. Vuelve a intentarlo.'
    const lista = await prepararFoto(Buffer.from(await r.arrayBuffer()))
    return lista ?? 'La foto de Wikimedia Commons no se pudo leer.'
  } catch {
    return 'No se pudo bajar la foto de Wikimedia Commons. Vuelve a intentarlo.'
  }
}

const deCommons = (c: CandidataFoto, revisada: boolean, descartadas?: string[]): Procedencia => ({
  origen: 'wikimedia',
  fuente_url: c.pagina,
  titulo_fuente: c.titulo,
  autor: c.autor,
  licencia: c.licencia,
  imagen_url: null,
  revisada,
  ...(descartadas ? { descartadas } : {}),
})

/**
 * Sugiere SOLA una foto de Wikimedia Commons para la principal de un objetivo (ciudades y
 * actividades; un hotel NUNCA) y la deja SIN revisar. `descartar` = archivos que alguien
 * rechazó («Otra foto»): no se vuelven a proponer. Reemplaza la principal si la hay.
 */
export async function sugerirDesdeCommons(a: {
  supabase: Cliente
  workspaceId: string
  staffId: string | null
  objetivo: ObjetivoFoto
  descartadas?: string[]
  fetch?: typeof fetch
}): Promise<Resultado> {
  // Un hotel lo elige siempre una persona: nunca se sugiere solo.
  if (!seSugiereDeCommons(a.objetivo.tipo)) return { ok: false, mensaje: MENSAJE_HOTEL_SIN_COMMONS }
  const f = a.fetch ?? fetch
  const descartadas = [...new Set(a.descartadas ?? [])]
  // De la consulta más precisa a la más amplia, hasta que alguna dé una foto que nadie descartó.
  let elegida: CandidataFoto | null = null
  for (const q of consultasDeFoto(a.objetivo.tipo, a.objetivo.nombre, a.objetivo.ciudad)) {
    elegida = elegirCandidata(await buscarEnCommons(q, { fetch: f }), descartadas)
    if (elegida) break
  }
  if (!elegida) return { ok: false, mensaje: 'Wikimedia Commons no tiene otra foto con licencia libre para esto. Sube la tuya.' }
  const lista = await bajarDeCommons(elegida, f)
  if (typeof lista === 'string') return { ok: false, mensaje: lista }
  const actuales = await fotosDelElemento(a.supabase, a.workspaceId, a.objetivo)
  if ('error' in actuales) return { ok: false, mensaje: actuales.error as string }
  return guardarFoto({
    supabase: a.supabase,
    workspaceId: a.workspaceId,
    staffId: a.staffId,
    objetivo: a.objetivo,
    foto: lista,
    procedencia: deCommons(elegida, false, descartadas),
    reemplaza: actuales.filas[0]?.id ?? null,
  })
}

/** Una foto de Commons que ELIGIÓ una persona en el selector: se revalida y queda revisada. */
export async function elegirDeCommons(a: {
  supabase: Cliente
  workspaceId: string
  staffId: string | null
  objetivo: ObjetivoFoto
  titulo: string
  reemplaza?: string | null
  categoria?: CategoriaFoto | null
  fetch?: typeof fetch
}): Promise<Resultado> {
  const f = a.fetch ?? fetch
  const c = await archivoDeCommons(a.titulo, { fetch: f })
  if (!c) return { ok: false, mensaje: 'Esa foto de Wikimedia Commons ya no tiene una licencia que se pueda imprimir. Elige otra.' }
  const lista = await bajarDeCommons(c, f)
  if (typeof lista === 'string') return { ok: false, mensaje: lista }
  return guardarFoto({ ...a, foto: lista, procedencia: deCommons(c, true) })
}

/**
 * Una foto de la página oficial que eligió una persona. La acción ya revisó el interruptor del
 * workspace: aquí se vuelve a leer la página y la imagen tiene que estar en ella.
 */
export async function elegirDeSitioOficial(a: {
  supabase: Cliente
  workspaceId: string
  staffId: string | null
  objetivo: ObjetivoFoto
  paginaUrl: string
  imagenUrl: string
  reemplaza?: string | null
  categoria?: CategoriaFoto | null
  red?: { fetch?: typeof fetch; resolver?: Resolver }
}): Promise<Resultado> {
  const r = await bajarFotoDeSitio(a.paginaUrl, a.imagenUrl, a.red)
  if (!r.ok) return { ok: false, mensaje: r.error }
  const lista = await prepararFoto(r.bytes)
  if (!lista) return { ok: false, mensaje: 'La foto de la página oficial no se pudo leer.' }
  return guardarFoto({
    ...a,
    foto: lista,
    procedencia: { origen: 'sitio_oficial', fuente_url: r.pagina, titulo_fuente: null, autor: null, licencia: null, imagen_url: r.imagen, revisada: true },
  })
}

/**
 * La foto que sube una persona (ya en bytes). Queda revisada y sin crédito. Sin `reemplaza` ni
 * `agregar`, cambia la principal (como el panel de la cotización y la foto del hotel de una
 * opción); con `agregar`, entra en un puesto libre.
 */
export async function ponerFotoPropia(a: {
  supabase: Cliente
  workspaceId: string
  staffId: string | null
  objetivo: ObjetivoFoto
  bytes: Buffer
  descartadas?: string[]
  reemplaza?: string | null
  agregar?: boolean
  categoria?: CategoriaFoto | null
}): Promise<Resultado> {
  const lista = await prepararFoto(a.bytes)
  if (!lista) return { ok: false, mensaje: 'Ese archivo no es una foto o pesa demasiado. Usa un JPG o un PNG.' }
  let reemplaza = a.reemplaza ?? null
  if (!reemplaza && !a.agregar) {
    const actuales = await fotosDelElemento(a.supabase, a.workspaceId, a.objetivo)
    if ('error' in actuales) return { ok: false, mensaje: actuales.error as string }
    reemplaza = actuales.filas[0]?.id ?? null
  }
  return guardarFoto({
    supabase: a.supabase,
    workspaceId: a.workspaceId,
    staffId: a.staffId,
    objetivo: a.objetivo,
    foto: lista,
    procedencia: { origen: 'asesora', fuente_url: null, titulo_fuente: null, autor: null, licencia: null, imagen_url: null, revisada: true, descartadas: a.descartadas },
    reemplaza,
    ...(a.categoria !== undefined ? { categoria: a.categoria } : {}),
  })
}

/** La fila de un id del workspace. */
async function filaPorId(supabase: Cliente, workspaceId: string, id: string): Promise<FilaCatalogo | null> {
  if (typeof id !== 'string' || !id) return null
  const { data } = await supabase.from(TABLA_CATALOGO).select(COLUMNAS).eq('workspace_id', workspaceId).eq('id', id).maybeSingle()
  return (data as FilaCatalogo | null) ?? null
}

/**
 * Marca una foto como la principal de su elemento. En dos pasos (la base no admite dos
 * principales ni un instante): primero se desmarca la actual, luego se marca la nueva.
 */
export async function marcarPrincipal(supabase: Cliente, workspaceId: string, staffId: string | null, id: string): Promise<{ ok: boolean; mensaje?: string }> {
  const f = await filaPorId(supabase, workspaceId, id)
  if (!f) return { ok: false, mensaje: 'Esa foto ya no está en la biblioteca. Recarga.' }
  if (f.principal) return { ok: true }
  const ahora = new Date().toISOString()
  const quitar = await supabase
    .from(TABLA_CATALOGO)
    .update({ principal: false, updated_by: staffId, updated_at: ahora })
    .eq('workspace_id', workspaceId)
    .eq('tipo', f.tipo)
    .eq('clave', f.clave)
    .eq('principal', true)
    .select('id')
  if (quitar.error) return { ok: false, mensaje: sinTabla(quitar.error) ? MENSAJE_SIN_TABLA : 'No se pudo cambiar la principal.' }
  const poner = await supabase
    .from(TABLA_CATALOGO)
    .update({ principal: true, updated_by: staffId, updated_at: ahora })
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .select('id')
  if (poner.error) return { ok: false, mensaje: 'No se pudo cambiar la principal.' }
  return { ok: true }
}

/** Quita una foto. Si era la principal y quedan otras, la del primer puesto pasa a serlo. */
export async function quitarFotoPorId(supabase: Cliente, workspaceId: string, id: string): Promise<{ ok: boolean; mensaje?: string }> {
  const f = await filaPorId(supabase, workspaceId, id)
  if (!f) return { ok: true }
  const { error } = await supabase.from(TABLA_CATALOGO).delete().eq('workspace_id', workspaceId).eq('id', id).select('id')
  if (error) return { ok: false, mensaje: sinTabla(error) ? MENSAJE_SIN_TABLA : 'No se pudo quitar la foto.' }
  if (f.principal) {
    const quedan = await fotosDelElemento(supabase, workspaceId, f)
    const siguiente = quedan.filas?.[0]
    if (siguiente && !siguiente.principal) {
      await supabase.from(TABLA_CATALOGO).update({ principal: true, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', siguiente.id)
    }
  }
  if (!(await archivoEnUso(supabase, workspaceId, f.ref, f.id))) await borrarDeCatalogo(workspaceId, f.ref)
  return { ok: true }
}

/** «Esta está bien»: la principal sugerida queda revisada. */
export async function confirmarFoto(supabase: Cliente, workspaceId: string, staffId: string | null, o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): Promise<{ ok: boolean; mensaje?: string }> {
  const { data, error } = await supabase
    .from(TABLA_CATALOGO)
    .update({ revisada: true, updated_by: staffId, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('tipo', o.tipo)
    .eq('clave', o.clave)
    .eq('principal', true)
    .select('id')
  if (error) return { ok: false, mensaje: sinTabla(error) ? MENSAJE_SIN_TABLA : 'No se pudo confirmar la foto.' }
  return Array.isArray(data) && data.length > 0 ? { ok: true } : { ok: false, mensaje: 'Esa foto ya no está en la biblioteca. Recarga.' }
}

/** Quita la foto principal de un elemento (el panel de la cotización): la siguiente pasa a principal. */
export async function quitarFoto(supabase: Cliente, workspaceId: string, o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): Promise<{ ok: boolean; mensaje?: string }> {
  const leidas = await fotosDelElemento(supabase, workspaceId, o)
  if ('error' in leidas) return { ok: false, mensaje: leidas.error as string }
  const principal = leidas.filas[0]
  if (!principal) return { ok: true }
  return quitarFotoPorId(supabase, workspaceId, principal.id)
}

/** La foto del catálogo como data URL, para el documento. `null` si no se pudo leer. */
export async function dataUrlDeFila(workspaceId: string, f: Pick<FilaCatalogo, 'ref'>): Promise<string | null> {
  const bytes = await bytesDeCatalogo(workspaceId, f.ref)
  return bytes ? `data:image/jpeg;base64,${bytes.toString('base64')}` : null
}

/**
 * Guarda en la fila la categoría que el modelo vio en una foto de hotel que no la tenía (las de
 * antes de las categorías): así no se vuelve a preguntar. Solo si sigue sin categoría.
 */
export async function anotarCategoria(supabase: Cliente, workspaceId: string, id: string, categoria: CategoriaFoto): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLA_CATALOGO)
    .update({ categoria })
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .eq('tipo', 'hotel')
    .is('categoria', null)
    .select('id')
  return !error && Array.isArray(data) && data.length > 0
}
