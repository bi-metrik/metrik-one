import 'server-only'

/**
 * El catálogo de fotos de la propuesta (`fotos_catalogo`, PR 4): leer, sugerir desde Wikimedia
 * Commons, poner la propia, confirmar y quitar.
 *
 * Recibe el cliente de Supabase de la sesión (RLS por workspace) y el workspace YA revisado por
 * la acción. Los archivos van por `catalogo-almacen.ts`.
 *
 * Sin la migración aplicada la tabla no existe: leer devuelve un catálogo vacío y escribir
 * devuelve el motivo, nunca un error sin explicar. La propuesta sale como hoy.
 */
import { borrarDeCatalogo, bytesDeCatalogo, guardarEnCatalogo, prepararFoto } from './catalogo-almacen'
import { nombreLlano, seSugiereDeCommons, type ObjetivoFoto, type TipoFoto } from './clave'
import { AGENTE_COMMONS, buscarEnCommons, consultasDeFoto, creditoDeCatalogo, elegirCandidata, esDeWikimedia, type CandidataFoto } from './wikimedia'

export const TABLA_CATALOGO = 'fotos_catalogo'
export const MENSAJE_SIN_TABLA = 'El catálogo de fotos todavía no está disponible: falta aplicar la migración de la base.'
export const MENSAJE_HOTEL_SIN_COMMONS = 'La foto de un hotel la sube la asesora: usa «Subir la mía».'

export interface FilaCatalogo {
  id: string
  tipo: TipoFoto
  clave: string
  nombre_clave: string
  nombre: string
  ciudad: string | null
  ref: string
  origen: 'wikimedia' | 'asesora'
  fuente_url: string | null
  titulo_fuente: string | null
  autor: string | null
  licencia: string | null
  foco_x: number | null
  foco_y: number | null
  proporcion: number | null
  revisada: boolean
  descartadas: string[]
}

const COLUMNAS = 'id, tipo, clave, nombre_clave, nombre, ciudad, ref, origen, fuente_url, titulo_fuente, autor, licencia, foco_x, foco_y, proporcion, revisada, descartadas'

/** El crédito que imprime el documento para esta foto (`null` = propia, sin crédito). */
export function creditoDeFila(f: Pick<FilaCatalogo, 'nombre' | 'autor' | 'licencia' | 'origen'>): string | null {
  return f.origen === 'wikimedia' ? creditoDeCatalogo(f) : null
}

/** ¿Este error es «la tabla no existe» (migración sin aplicar)? */
function sinTabla(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /fotos_catalogo/.test(error.message ?? '')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

/**
 * Las filas del catálogo para lo que pide una cotización: por tipo y llave, y las actividades
 * también por nombre (un plan opcional del documento no siempre sabe su ciudad).
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

/** La fila de un objetivo, si la hay. */
export function filaDe(filas: FilaCatalogo[], o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): FilaCatalogo | null {
  return filas.find((f) => f.tipo === o.tipo && f.clave === o.clave) ?? null
}

/**
 * La foto de un plan opcional por su nombre: la de su ciudad si la hay entre `ciudades`, si no
 * la única con ese nombre. Con varias de otras ciudades, ninguna (un «City tour» de París no
 * ilustra uno de Roma).
 */
export function actividadPorNombre(filas: FilaCatalogo[], nombre: string, claveCiudades: string[]): FilaCatalogo | null {
  const n = nombreLlano(nombre)
  const mismas = filas.filter((f) => f.tipo === 'actividad' && f.nombre_clave === n)
  if (mismas.length === 0) return null
  const enElViaje = mismas.find((f) => claveCiudades.some((c) => c !== '' && f.clave.endsWith(`|${c}`)))
  if (enElViaje) return enElViaje
  const sinCiudad = mismas.find((f) => f.clave.endsWith('|'))
  if (sinCiudad) return sinCiudad
  return mismas.length === 1 ? mismas[0] : null
}

type Resultado = { ok: true; fila: FilaCatalogo } | { ok: false; mensaje: string }

/** ¿Algún otro registro usa este archivo? (la misma foto puede ilustrar dos cosas). */
async function archivoEnUso(supabase: Cliente, workspaceId: string, ref: string, salvoId: string): Promise<boolean> {
  const { data } = await supabase.from(TABLA_CATALOGO).select('id').eq('workspace_id', workspaceId).eq('ref', ref).neq('id', salvoId).limit(1)
  return Array.isArray(data) && data.length > 0
}

async function escribir(
  supabase: Cliente,
  workspaceId: string,
  staffId: string | null,
  o: ObjetivoFoto,
  campos: Omit<FilaCatalogo, 'id' | 'tipo' | 'clave' | 'nombre_clave' | 'nombre' | 'ciudad'>,
): Promise<Resultado> {
  const { data: previa, error: errorPrevia } = await supabase
    .from(TABLA_CATALOGO)
    .select(COLUMNAS)
    .eq('workspace_id', workspaceId)
    .eq('tipo', o.tipo)
    .eq('clave', o.clave)
    .maybeSingle()
  if (errorPrevia) return { ok: false, mensaje: sinTabla(errorPrevia) ? MENSAJE_SIN_TABLA : 'No se pudo leer el catálogo de fotos.' }
  const fila = {
    workspace_id: workspaceId,
    tipo: o.tipo,
    clave: o.clave,
    nombre_clave: nombreLlano(o.nombre),
    nombre: o.nombre,
    ciudad: o.ciudad,
    ...campos,
    updated_by: staffId,
    updated_at: new Date().toISOString(),
  }
  const consulta = previa
    ? supabase.from(TABLA_CATALOGO).update(fila).eq('id', (previa as FilaCatalogo).id).eq('workspace_id', workspaceId)
    : supabase.from(TABLA_CATALOGO).insert({ ...fila, created_by: staffId })
  const { data, error } = await consulta.select(COLUMNAS).maybeSingle()
  if (error || !data) {
    // El archivo nuevo ya se subió: si la fila no quedó, se borra.
    await borrarDeCatalogo(workspaceId, campos.ref)
    return { ok: false, mensaje: sinTabla(error) ? MENSAJE_SIN_TABLA : 'No se pudo guardar la foto en el catálogo.' }
  }
  const anterior = previa as FilaCatalogo | null
  if (anterior && anterior.ref !== campos.ref && !(await archivoEnUso(supabase, workspaceId, anterior.ref, anterior.id))) {
    await borrarDeCatalogo(workspaceId, anterior.ref)
  }
  return { ok: true, fila: data as FilaCatalogo }
}

/**
 * Sugiere una foto de Wikimedia Commons para un objetivo y la deja en el catálogo SIN revisar.
 * `descartar` = el archivo de Commons que tenía (la persona pidió «Otra foto»): no se vuelve a
 * proponer.
 */
export async function sugerirDesdeCommons(a: {
  supabase: Cliente
  workspaceId: string
  staffId: string | null
  objetivo: ObjetivoFoto
  descartadas?: string[]
  fetch?: typeof fetch
}): Promise<Resultado> {
  // Un hotel lleva la foto que sube la asesora, nunca una de Commons.
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
  if (!esDeWikimedia(elegida.descarga)) return { ok: false, mensaje: 'No se pudo bajar la foto de Wikimedia Commons.' }
  let bytes: Buffer
  try {
    const r = await f(elegida.descarga, { headers: { 'User-Agent': AGENTE_COMMONS }, signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return { ok: false, mensaje: 'No se pudo bajar la foto de Wikimedia Commons. Vuelve a intentarlo.' }
    bytes = Buffer.from(await r.arrayBuffer())
  } catch {
    return { ok: false, mensaje: 'No se pudo bajar la foto de Wikimedia Commons. Vuelve a intentarlo.' }
  }
  const lista = await prepararFoto(bytes)
  if (!lista) return { ok: false, mensaje: 'La foto de Wikimedia Commons no se pudo leer.' }
  let ref: string
  try {
    ref = await guardarEnCatalogo(a.workspaceId, a.objetivo.tipo, lista)
  } catch {
    return { ok: false, mensaje: 'No se pudo guardar la foto. Vuelve a intentarlo.' }
  }
  return escribir(a.supabase, a.workspaceId, a.staffId, a.objetivo, {
    ref,
    origen: 'wikimedia',
    fuente_url: elegida.pagina,
    titulo_fuente: elegida.titulo,
    autor: elegida.autor,
    licencia: elegida.licencia,
    foco_x: null,
    foco_y: null,
    proporcion: lista.ancho / lista.alto,
    revisada: false,
    descartadas,
  })
}

/** La foto que sube la asesora (ya en bytes). Queda revisada y sin crédito. */
export async function ponerFotoPropia(a: {
  supabase: Cliente
  workspaceId: string
  staffId: string | null
  objetivo: ObjetivoFoto
  bytes: Buffer
  descartadas?: string[]
}): Promise<Resultado> {
  const lista = await prepararFoto(a.bytes)
  if (!lista) return { ok: false, mensaje: 'Ese archivo no es una foto o pesa demasiado. Usa un JPG o un PNG.' }
  let ref: string
  try {
    ref = await guardarEnCatalogo(a.workspaceId, a.objetivo.tipo, lista)
  } catch {
    return { ok: false, mensaje: 'No se pudo guardar la foto. Vuelve a intentarlo.' }
  }
  return escribir(a.supabase, a.workspaceId, a.staffId, a.objetivo, {
    ref,
    origen: 'asesora',
    fuente_url: null,
    titulo_fuente: null,
    autor: null,
    licencia: null,
    foco_x: null,
    foco_y: null,
    proporcion: lista.ancho / lista.alto,
    revisada: true,
    descartadas: a.descartadas ?? [],
  })
}

/** «Esta está bien»: la sugerida queda revisada. */
export async function confirmarFoto(supabase: Cliente, workspaceId: string, staffId: string | null, o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): Promise<{ ok: boolean; mensaje?: string }> {
  const { data, error } = await supabase
    .from(TABLA_CATALOGO)
    .update({ revisada: true, updated_by: staffId, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('tipo', o.tipo)
    .eq('clave', o.clave)
    .select('id')
  if (error) return { ok: false, mensaje: sinTabla(error) ? MENSAJE_SIN_TABLA : 'No se pudo confirmar la foto.' }
  return Array.isArray(data) && data.length > 0 ? { ok: true } : { ok: false, mensaje: 'Esa foto ya no está en el catálogo. Recarga.' }
}

/** Quita la foto: el documento vuelve al degradado (o a la foto del banco, en una ciudad). */
export async function quitarFoto(supabase: Cliente, workspaceId: string, o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): Promise<{ ok: boolean; mensaje?: string }> {
  const { data, error } = await supabase
    .from(TABLA_CATALOGO)
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('tipo', o.tipo)
    .eq('clave', o.clave)
    .select('id, ref')
  if (error) return { ok: false, mensaje: sinTabla(error) ? MENSAJE_SIN_TABLA : 'No se pudo quitar la foto.' }
  for (const f of (data ?? []) as { id: string; ref: string }[]) {
    if (!(await archivoEnUso(supabase, workspaceId, f.ref, f.id))) await borrarDeCatalogo(workspaceId, f.ref)
  }
  return { ok: true }
}

/** La foto del catálogo como data URL, para el documento. `null` si no se pudo leer. */
export async function dataUrlDeFila(workspaceId: string, f: Pick<FilaCatalogo, 'ref'>): Promise<string | null> {
  const bytes = await bytesDeCatalogo(workspaceId, f.ref)
  return bytes ? `data:image/jpeg;base64,${bytes.toString('base64')}` : null
}
