import 'server-only'

/**
 * La biblioteca de fotos del workspace (`fotos_catalogo`): leer, guardar la foto que sube o pega
 * una persona, marcar la principal, reordenar y quitar. La búsqueda automática (Wikimedia Commons,
 * la página oficial y el clasificador) se quitó el 2026-10-16 (Mauricio): la biblioteca la arma la
 * agencia.
 *
 * Hasta TRES fotos por elemento (ciudad, hotel o actividad), una principal (migración
 * `20261016153000`): la base lo hace cumplir con el puesto (`posicion` 1 a 3, único por elemento)
 * y con un índice único parcial sobre `principal`; aquí se respeta antes de subir nada. El orden lo
 * pone la asesora (`orden`, migración `20261017090000`).
 *
 * Recibe el cliente de Supabase de la sesión (RLS por workspace) y el workspace YA revisado por
 * la acción. Los archivos van por `catalogo-almacen.ts`.
 *
 * Sin la migración la tabla (o la vista) no existe: leer devuelve un catálogo vacío y escribir
 * devuelve el motivo, nunca un error sin explicar.
 */
import type { AutorizacionFoto } from './autorizacion'
import type { CategoriaFoto } from './categoria'
import { borrarDeCatalogo, bytesDeCatalogo, guardarEnCatalogo, prepararFoto, type FotoPreparada } from './catalogo-almacen'
import { creditoDeFoto, MAX_FOTOS_POR_ELEMENTO, nombreLlano, type ObjetivoFoto, type OrigenFoto, type TipoFoto } from './clave'

export const TABLA_CATALOGO = 'fotos_catalogo'
/** Las fotos por la llave que se pide (la del perfil o la de un alias): `20261017090000`. */
const VISTA_POR_CLAVE = 'fotos_catalogo_por_clave'
export const MENSAJE_SIN_TABLA = 'La biblioteca de fotos todavía no está disponible: falta aplicar la migración de la base.'
export const MENSAJE_TOPE = `Ya tiene ${MAX_FOTOS_POR_ELEMENTO} fotos: quita una para poner otra.`

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
  /** Puesto 1 a 3 dentro del elemento (el lugar en la base, no el orden). */
  posicion: number
  /** El orden que puso la asesora (1 a 3); `null` en las de antes. */
  orden?: number | null
  imagen_url: string | null
  /** Hotel: fachada, habitación, zonas comunes u otra. `null` sin categoría. */
  categoria: CategoriaFoto | null
  /** Leída por la vista: la llave por la que se preguntó (la propia o la de un alias). */
  clave_pedida?: string
}

export const COLUMNAS =
  'id, tipo, clave, nombre_clave, nombre, ciudad, ref, origen, fuente_url, titulo_fuente, autor, licencia, foco_x, foco_y, proporcion, revisada, descartadas, principal, posicion, orden, imagen_url, categoria'

/** El crédito que imprime el documento para esta foto (`null` = propia). Ver `creditoDeFoto`. */
export function creditoDeFila(f: Pick<FilaCatalogo, 'nombre' | 'autor' | 'licencia' | 'origen'>): string | null {
  return creditoDeFoto(f)
}

/** ¿Este error es «la tabla, la vista o la columna no existe» (migración sin aplicar)? */
export function sinTabla(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /fotos_catalogo|fotos_perfiles/.test(error.message ?? '')
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

// ── Lectura ───────────────────────────────────────────────────────────────────

/** Principal primero; luego el orden de la asesora; luego el puesto. */
export function ordenar<F extends Pick<FilaCatalogo, 'principal' | 'posicion' | 'orden'>>(filas: F[]): F[] {
  const orden = (f: F) => f.orden ?? f.posicion ?? 1
  return [...filas].sort((a, b) => Number(b.principal !== false) - Number(a.principal !== false) || orden(a) - orden(b) || (a.posicion ?? 1) - (b.posicion ?? 1))
}

/**
 * Las fotos de las llaves que pide una cotización, por la vista: la llave puede ser la del perfil
 * o la de un alias («Hotel Catalonia Puerta del Sol Madrid» → las fotos de «Catalonia Puerta del
 * Sol»). Cada fila dice por qué llave salió (`clave_pedida`). UNA sola ida a la base.
 */
export async function leerCatalogo(supabase: Cliente, workspaceId: string, claves: readonly string[]): Promise<FilaCatalogo[]> {
  const pedidas = [...new Set(claves.filter(Boolean))]
  if (pedidas.length === 0) return []
  try {
    const { data, error } = await supabase.from(VISTA_POR_CLAVE).select(`${COLUMNAS}, clave_pedida`).eq('workspace_id', workspaceId).in('clave_pedida', pedidas)
    if (error) {
      if (!sinTabla(error)) console.warn('[fotos-catalogo] no se pudo leer:', error.message)
      return []
    }
    const vistos = new Set<string>()
    return ((data ?? []) as FilaCatalogo[]).filter((f) => {
      const k = `${f.id}|${f.clave_pedida}`
      return vistos.has(k) ? false : (vistos.add(k), true)
    })
  } catch (e) {
    console.warn('[fotos-catalogo] no se pudo leer:', e instanceof Error ? e.message : e)
    return []
  }
}

/** Todas las fotos de una llave pedida (la principal primero). */
export function fotosDe(filas: FilaCatalogo[], o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): FilaCatalogo[] {
  return ordenar(filas.filter((f) => f.tipo === o.tipo && (f.clave_pedida ?? f.clave) === o.clave))
}

/** La foto principal de una llave, si la hay. */
export function filaDe(filas: FilaCatalogo[], o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): FilaCatalogo | null {
  return fotosDe(filas, o)[0] ?? null
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
  return [...porClave.values()].map((fs) => {
    const o = ordenar(fs)
    return { tipo: o[0].tipo, clave: o[0].clave, nombre: o[0].nombre, ciudad: o[0].ciudad, fotos: o }
  })
}

/** Tope de filas que lee la biblioteca de una vez (cientos de elementos por agencia). */
const TOPE_BIBLIOTECA = 3000

/** Todas las fotos del workspace (la pantalla «Hoteles y tours»). */
export async function leerTodasLasFotos(supabase: Cliente, workspaceId: string): Promise<{ ok: true; filas: FilaCatalogo[] } | { ok: false; mensaje: string }> {
  const { data, error } = await supabase.from(TABLA_CATALOGO).select(COLUMNAS).eq('workspace_id', workspaceId).limit(TOPE_BIBLIOTECA)
  if (error) return { ok: false, mensaje: sinTabla(error) ? MENSAJE_SIN_TABLA : 'No se pudo leer la biblioteca de fotos.' }
  return { ok: true, filas: (data ?? []) as FilaCatalogo[] }
}

/** Las fotos de un elemento por su llave PROPIA (la del perfil), la principal primero. */
export async function fotosDelElemento(supabase: Cliente, workspaceId: string, o: Pick<ObjetivoFoto, 'tipo' | 'clave'>) {
  const { data, error } = await supabase.from(TABLA_CATALOGO).select(COLUMNAS).eq('workspace_id', workspaceId).eq('tipo', o.tipo).eq('clave', o.clave)
  if (error) return { error: sinTabla(error) ? MENSAJE_SIN_TABLA : 'No se pudo leer la biblioteca de fotos.' }
  return { filas: ordenar((data ?? []) as FilaCatalogo[]) }
}

// ── Escritura ─────────────────────────────────────────────────────────────────

type Resultado = { ok: true; fila: FilaCatalogo } | { ok: false; mensaje: string }

/** ¿Algún otro registro usa este archivo? (la misma foto puede ilustrar dos cosas). */
async function archivoEnUso(supabase: Cliente, workspaceId: string, ref: string, salvoId: string): Promise<boolean> {
  const { data } = await supabase.from(TABLA_CATALOGO).select('id').eq('workspace_id', workspaceId).eq('ref', ref).neq('id', salvoId).limit(1)
  return Array.isArray(data) && data.length > 0
}

/**
 * La foto que sube o pega una persona (ya en bytes), en el elemento de `objetivo` (la llave del
 * PERFIL: quien llama ya resolvió el alias). Queda revisada y sin crédito.
 *  · `reemplaza` = el id de una de sus fotos → esa cambia (conserva su puesto, su orden y si es
 *    principal);
 *  · sin `reemplaza` → se agrega en el primer puesto libre y al final del orden; la primera del
 *    elemento es la principal. Con tres, no entra (`MENSAJE_TOPE`) y no se sube nada.
 *
 * `autorizacion` es OBLIGATORIA (Emilio, 2026-10-16): quien llama ya revisó la casilla
 * (`revisarAutorizacion`) y pone el usuario de la sesión. Sin usuario no se guarda.
 */
export async function ponerFotoPropia(a: {
  supabase: Cliente
  workspaceId: string
  staffId: string | null
  objetivo: ObjetivoFoto
  bytes: Buffer
  reemplaza?: string | null
  categoria?: CategoriaFoto | null
  autorizacion: AutorizacionFoto
}): Promise<Resultado> {
  if (!a.autorizacion || typeof a.autorizacion.userId !== 'string' || !a.autorizacion.userId) {
    return { ok: false, mensaje: 'Falta registrar quién autoriza la foto. Vuelve a entrar e intenta de nuevo.' }
  }
  const lista = await prepararFoto(a.bytes)
  if (!lista) return { ok: false, mensaje: 'Ese archivo no es una foto o pesa demasiado. Usa un JPG o un PNG.' }
  return guardarFoto({ ...a, foto: lista })
}

async function guardarFoto(a: {
  supabase: Cliente
  workspaceId: string
  staffId: string | null
  objetivo: ObjetivoFoto
  foto: FotoPreparada
  reemplaza?: string | null
  categoria?: CategoriaFoto | null
  autorizacion: AutorizacionFoto
}): Promise<Resultado> {
  const leidas = await fotosDelElemento(a.supabase, a.workspaceId, a.objetivo)
  if ('error' in leidas) return { ok: false, mensaje: leidas.error as string }
  const actuales = leidas.filas
  const reemplaza = a.reemplaza ?? null
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
  const ahora = new Date().toISOString()
  if (!anterior) {
    // La nueva va al final: las de antes (sin orden) quedan numeradas como se ven, para que la
    // nueva no se les cuele por el puesto que ocupa en la base.
    for (const [i, f] of actuales.entries()) {
      if (f.orden !== i + 1) await a.supabase.from(TABLA_CATALOGO).update({ orden: i + 1 }).eq('workspace_id', a.workspaceId).eq('id', f.id)
    }
  }
  const fila = {
    workspace_id: a.workspaceId,
    tipo: a.objetivo.tipo,
    clave: a.objetivo.clave,
    nombre_clave: nombreLlano(a.objetivo.nombre),
    nombre: a.objetivo.nombre,
    ciudad: a.objetivo.ciudad,
    ref,
    origen: 'asesora' as const,
    fuente_url: null,
    titulo_fuente: null,
    autor: null,
    licencia: null,
    imagen_url: null,
    // Sin categoría nueva, conserva la de la que reemplaza.
    categoria: a.objetivo.tipo === 'hotel' ? (a.categoria !== undefined ? a.categoria : anterior?.categoria ?? null) : null,
    autorizada_por: a.autorizacion.userId,
    autorizada_at: ahora,
    procedencia: a.autorizacion.procedencia ?? null,
    revisada: true,
    descartadas: anterior?.descartadas ?? [],
    foco_x: null,
    foco_y: null,
    proporcion: a.foto.ancho / a.foto.alto,
    updated_by: a.staffId,
    updated_at: ahora,
  }
  const consulta = anterior
    ? a.supabase.from(TABLA_CATALOGO).update(fila).eq('id', anterior.id).eq('workspace_id', a.workspaceId)
    : a.supabase
        .from(TABLA_CATALOGO)
        .insert({ ...fila, posicion: libre, orden: actuales.length + 1, principal: actuales.length === 0, created_by: a.staffId })
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

/** La fila de un id del workspace. */
export async function filaPorId(supabase: Cliente, workspaceId: string, id: string): Promise<FilaCatalogo | null> {
  if (typeof id !== 'string' || !id) return null
  const { data } = await supabase.from(TABLA_CATALOGO).select(COLUMNAS).eq('workspace_id', workspaceId).eq('id', id).maybeSingle()
  return (data as FilaCatalogo | null) ?? null
}

/**
 * Deja las fotos de un elemento en el orden de `ids` (todas las del elemento, cada una una vez): la
 * primera queda principal. La principal se cambia en dos pasos (la base no admite dos principales
 * ni un instante): primero se desmarca la actual, luego se marca la nueva.
 */
export async function reordenarFotos(supabase: Cliente, workspaceId: string, staffId: string | null, ids: string[]): Promise<{ ok: boolean; mensaje?: string }> {
  const primera = await filaPorId(supabase, workspaceId, ids[0])
  if (!primera) return { ok: false, mensaje: 'Esa foto ya no está en la biblioteca. Recarga.' }
  const leidas = await fotosDelElemento(supabase, workspaceId, primera)
  if ('error' in leidas) return { ok: false, mensaje: leidas.error as string }
  const actuales = leidas.filas
  const mismas = ids.length === actuales.length && new Set(ids).size === ids.length && actuales.every((f) => ids.includes(f.id))
  if (!mismas) return { ok: false, mensaje: 'Las fotos cambiaron mientras tanto. Recarga.' }
  const ahora = new Date().toISOString()
  if (!primera.principal) {
    const quitar = await supabase
      .from(TABLA_CATALOGO)
      .update({ principal: false, updated_by: staffId, updated_at: ahora })
      .eq('workspace_id', workspaceId)
      .eq('tipo', primera.tipo)
      .eq('clave', primera.clave)
      .eq('principal', true)
      .select('id')
    if (quitar.error) return { ok: false, mensaje: sinTabla(quitar.error) ? MENSAJE_SIN_TABLA : 'No se pudo cambiar la principal.' }
  }
  for (const [i, id] of ids.entries()) {
    const { error } = await supabase
      .from(TABLA_CATALOGO)
      .update({ orden: i + 1, ...(i === 0 ? { principal: true } : {}), updated_by: staffId, updated_at: ahora })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select('id')
    if (error) return { ok: false, mensaje: sinTabla(error) ? MENSAJE_SIN_TABLA : 'No se pudo cambiar el orden.' }
  }
  return { ok: true }
}

/** Quita una foto. Si era la principal y quedan otras, la siguiente en el orden pasa a serlo. */
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

/** La foto del catálogo como data URL, para el documento. `null` si no se pudo leer. */
export async function dataUrlDeFila(workspaceId: string, f: Pick<FilaCatalogo, 'ref'>): Promise<string | null> {
  const bytes = await bytesDeCatalogo(workspaceId, f.ref)
  return bytes ? `data:image/jpeg;base64,${bytes.toString('base64')}` : null
}
