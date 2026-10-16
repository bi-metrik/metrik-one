import 'server-only'

/**
 * Los perfiles de hotel y de tour del espacio (`fotos_perfiles`, `fotos_perfiles_alias`, migración
 * `20261017090000`): leerlos, crearlos la primera vez que un hotel o un tour entra a una
 * cotización, y guardar la respuesta a «¿Es el mismo hotel que …?».
 *
 * Un perfil es su llave (`clave`): la misma de sus fotos en `fotos_catalogo`. Un hotel con fotos de
 * antes de los perfiles (sin fila en `fotos_perfiles`) cuenta como perfil igual; su fila se crea la
 * próxima vez que alguien con permiso abre una cotización que lo nombra. Así no hizo falta una
 * migración que escribiera datos.
 *
 * Recibe el cliente de la sesión (RLS por workspace) y el workspace YA revisado por la acción.
 */
import { leerTodasLasFotos, ordenar, sinTabla, MENSAJE_SIN_TABLA, type FilaCatalogo } from './catalogo'
import { esTipoPerfil, type ObjetivoFoto, type TipoPerfil } from './clave'
import { reconocer, type NombreConocido } from './perfiles'

const TABLA_PERFILES = 'fotos_perfiles'
const TABLA_ALIAS = 'fotos_perfiles_alias'
const TOPE = 3000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

export interface PerfilFila {
  id: string
  tipo: TipoPerfil
  clave: string
  nombre: string
  ciudad: string | null
}

export interface AliasFila {
  id: string
  perfil_id: string
  tipo: TipoPerfil
  clave: string
  nombre: string
  ciudad: string | null
}

/** Lo que el espacio conoce: perfiles, alias y todas sus fotos. */
export interface Conocidos {
  perfiles: PerfilFila[]
  alias: AliasFila[]
  fotos: FilaCatalogo[]
}

export async function leerConocidos(supabase: Cliente, workspaceId: string): Promise<{ ok: true; conocidos: Conocidos } | { ok: false; mensaje: string }> {
  const [p, a, f] = await Promise.all([
    supabase.from(TABLA_PERFILES).select('id, tipo, clave, nombre, ciudad').eq('workspace_id', workspaceId).limit(TOPE),
    supabase.from(TABLA_ALIAS).select('id, perfil_id, tipo, clave, nombre, ciudad').eq('workspace_id', workspaceId).limit(TOPE),
    leerTodasLasFotos(supabase, workspaceId),
  ])
  for (const r of [p, a]) {
    if (r.error) return { ok: false, mensaje: sinTabla(r.error) ? MENSAJE_SIN_TABLA : 'No se pudieron leer los hoteles y tours.' }
  }
  if (!f.ok) return { ok: false, mensaje: f.mensaje }
  return { ok: true, conocidos: { perfiles: (p.data ?? []) as PerfilFila[], alias: (a.data ?? []) as AliasFila[], fotos: f.filas } }
}

/** El nombre y la ciudad de cada perfil (de su fila o, si es de antes, de sus fotos). */
function datosDePerfiles(c: Conocidos): Map<string, { tipo: TipoPerfil; clave: string; nombre: string; ciudad: string | null; id: string | null }> {
  const m = new Map<string, { tipo: TipoPerfil; clave: string; nombre: string; ciudad: string | null; id: string | null }>()
  for (const f of ordenar(c.fotos)) {
    if (esTipoPerfil(f.tipo) && !m.has(`${f.tipo}:${f.clave}`)) m.set(`${f.tipo}:${f.clave}`, { tipo: f.tipo, clave: f.clave, nombre: f.nombre, ciudad: f.ciudad, id: null })
  }
  for (const p of c.perfiles) m.set(`${p.tipo}:${p.clave}`, { tipo: p.tipo, clave: p.clave, nombre: p.nombre, ciudad: p.ciudad, id: p.id })
  return m
}

/** Todos los nombres que el espacio reconoce, con la llave del perfil al que pertenecen. */
function nombresConocidos(c: Conocidos): NombreConocido[] {
  const perfiles = datosDePerfiles(c)
  const porId = new Map(c.perfiles.map((p) => [p.id, p]))
  const deAlias: NombreConocido[] = []
  for (const a of c.alias) {
    const p = porId.get(a.perfil_id)
    if (p) deAlias.push({ tipo: a.tipo, clave: a.clave, clavePerfil: p.clave, nombre: a.nombre, ciudad: a.ciudad })
  }
  return [...[...perfiles.values()].map((p) => ({ tipo: p.tipo, clave: p.clave, clavePerfil: p.clave, nombre: p.nombre, ciudad: p.ciudad })), ...deAlias]
}

export interface Resuelto {
  /** Lo que nombra la cotización. */
  pedido: ObjetivoFoto
  /** El perfil donde viven sus fotos (`null` mientras la persona no conteste la duda). */
  perfil: ObjetivoFoto | null
  duda: { clave: string; nombre: string; ciudad: string | null } | null
}

/** Crea la fila del perfil (si ya estaba, la devuelve). `null` si no se pudo. */
async function asegurarPerfil(supabase: Cliente, workspaceId: string, staffId: string | null, p: ObjetivoFoto & { tipo: TipoPerfil }, c: Conocidos): Promise<PerfilFila | null> {
  const ya = c.perfiles.find((x) => x.tipo === p.tipo && x.clave === p.clave)
  if (ya) return ya
  const { data, error } = await supabase
    .from(TABLA_PERFILES)
    .insert({ workspace_id: workspaceId, tipo: p.tipo, clave: p.clave, nombre: p.nombre, ciudad: p.ciudad, created_by: staffId })
    .select('id, tipo, clave, nombre, ciudad')
    .maybeSingle()
  if (error || !data) {
    // Otra pestaña lo creó al mismo tiempo: se lee.
    if (error?.code === '23505') {
      const { data: otra } = await supabase.from(TABLA_PERFILES).select('id, tipo, clave, nombre, ciudad').eq('workspace_id', workspaceId).eq('tipo', p.tipo).eq('clave', p.clave).maybeSingle()
      if (otra) c.perfiles.push(otra as PerfilFila)
      return (otra as PerfilFila | null) ?? null
    }
    return null
  }
  c.perfiles.push(data as PerfilFila)
  return data as PerfilFila
}

async function guardarAlias(supabase: Cliente, workspaceId: string, staffId: string | null, pedido: ObjetivoFoto & { tipo: TipoPerfil }, perfil: PerfilFila, c: Conocidos): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLA_ALIAS)
    .insert({ workspace_id: workspaceId, perfil_id: perfil.id, tipo: pedido.tipo, clave: pedido.clave, nombre: pedido.nombre, ciudad: pedido.ciudad, created_by: staffId })
    .select('id, perfil_id, tipo, clave, nombre, ciudad')
    .maybeSingle()
  if (error || !data) return error?.code === '23505'
  c.alias.push(data as AliasFila)
  return true
}

/**
 * Qué perfil es cada hotel o tour que nombra la cotización (las ciudades no tienen perfil: su llave
 * es la de sus fotos). Con `escribir` (un rol que puede cambiar fotos):
 *  · un nombre nuevo crea su perfil;
 *  · uno que coincide sin dudas guarda su alias;
 *  · un hotel con fotos de antes, sin fila de perfil, la recibe.
 * Una duda no escribe nada: espera la respuesta (`contestarDuda`).
 */
export async function resolverPedidos(
  supabase: Cliente,
  workspaceId: string,
  staffId: string | null,
  objetivos: ObjetivoFoto[],
  c: Conocidos,
  opts: { escribir: boolean },
): Promise<Resuelto[]> {
  const salida: Resuelto[] = []
  for (const o of objetivos) {
    if (!esTipoPerfil(o.tipo)) {
      salida.push({ pedido: o, perfil: o, duda: null })
      continue
    }
    const pedido = o as ObjetivoFoto & { tipo: TipoPerfil }
    const r = reconocer(pedido, nombresConocidos(c))
    if (r.tipo === 'duda') {
      salida.push({ pedido: o, perfil: null, duda: { clave: r.clavePerfil, nombre: r.nombre, ciudad: r.ciudad } })
      continue
    }
    if (r.tipo === 'nuevo') {
      if (opts.escribir) await asegurarPerfil(supabase, workspaceId, staffId, pedido, c)
      salida.push({ pedido: o, perfil: o, duda: null })
      continue
    }
    const datos = datosDePerfiles(c).get(`${o.tipo}:${r.clavePerfil}`)
    const perfil: ObjetivoFoto = datos ? { tipo: o.tipo, clave: datos.clave, nombre: datos.nombre, ciudad: datos.ciudad } : o
    if (opts.escribir) {
      const fila = await asegurarPerfil(supabase, workspaceId, staffId, perfil as ObjetivoFoto & { tipo: TipoPerfil }, c)
      if (r.tipo === 'seguro' && fila) await guardarAlias(supabase, workspaceId, staffId, pedido, fila, c)
    }
    salida.push({ pedido: o, perfil, duda: null })
  }
  return salida
}

/**
 * La respuesta a «¿Es el mismo hotel que …?»: `mismo` guarda el nombre de la cotización como alias
 * del perfil conocido (`clavePerfil`); si no, el nombre queda con su perfil propio. Si mientras
 * tanto ya se había resuelto (otra pestaña), devuelve lo que quedó. Devuelve el perfil.
 */
export async function contestarDuda(
  supabase: Cliente,
  workspaceId: string,
  staffId: string | null,
  pedido: ObjetivoFoto,
  clavePerfil: string,
  mismo: boolean,
): Promise<{ ok: true; perfil: ObjetivoFoto } | { ok: false; mensaje: string }> {
  if (!esTipoPerfil(pedido.tipo)) return { ok: false, mensaje: 'Solo los hoteles y los tours tienen perfil.' }
  const leidos = await leerConocidos(supabase, workspaceId)
  if (!leidos.ok) return { ok: false, mensaje: leidos.mensaje }
  const c = leidos.conocidos
  const p = pedido as ObjetivoFoto & { tipo: TipoPerfil }
  const ya = nombresConocidos(c).find((n) => n.tipo === p.tipo && n.clave === p.clave)
  if (ya) {
    const d = datosDePerfiles(c).get(`${p.tipo}:${ya.clavePerfil}`)
    return { ok: true, perfil: d ? { tipo: p.tipo, clave: d.clave, nombre: d.nombre, ciudad: d.ciudad } : p }
  }
  if (!mismo) {
    const fila = await asegurarPerfil(supabase, workspaceId, staffId, p, c)
    return fila ? { ok: true, perfil: p } : { ok: false, mensaje: 'No se pudo guardar. Vuelve a intentarlo.' }
  }
  const d = datosDePerfiles(c).get(`${p.tipo}:${clavePerfil}`)
  if (!d) return { ok: false, mensaje: 'Ese hotel ya no está en la biblioteca. Recarga.' }
  const destino: ObjetivoFoto & { tipo: TipoPerfil } = { tipo: d.tipo, clave: d.clave, nombre: d.nombre, ciudad: d.ciudad }
  const fila = await asegurarPerfil(supabase, workspaceId, staffId, destino, c)
  if (!fila || !(await guardarAlias(supabase, workspaceId, staffId, p, fila, c))) return { ok: false, mensaje: 'No se pudo guardar. Vuelve a intentarlo.' }
  return { ok: true, perfil: destino }
}

/** «No es el mismo»: el nombre deja de ser alias. Devuelve la llave del perfil del que se separó. */
export async function separarAlias(supabase: Cliente, workspaceId: string, aliasId: string): Promise<{ ok: true; tipo: TipoPerfil; clavePerfil: string } | { ok: false; mensaje: string }> {
  if (typeof aliasId !== 'string' || !aliasId) return { ok: false, mensaje: 'Ese nombre ya no está. Recarga.' }
  const { data: a } = await supabase.from(TABLA_ALIAS).select('id, perfil_id, tipo').eq('workspace_id', workspaceId).eq('id', aliasId).maybeSingle()
  if (!a) return { ok: false, mensaje: 'Ese nombre ya no está. Recarga.' }
  const { data: p } = await supabase.from(TABLA_PERFILES).select('clave').eq('workspace_id', workspaceId).eq('id', (a as AliasFila).perfil_id).maybeSingle()
  const { error } = await supabase.from(TABLA_ALIAS).delete().eq('workspace_id', workspaceId).eq('id', aliasId)
  if (error) return { ok: false, mensaje: 'No se pudo separar. Vuelve a intentarlo.' }
  return { ok: true, tipo: (a as AliasFila).tipo, clavePerfil: (p as { clave?: string } | null)?.clave ?? '' }
}

/** Los alias de cada perfil, por la llave del perfil. */
export function aliasPorPerfil(c: Conocidos): Map<string, AliasFila[]> {
  const porId = new Map(c.perfiles.map((p) => [p.id, p]))
  const m = new Map<string, AliasFila[]>()
  for (const a of c.alias) {
    const p = porId.get(a.perfil_id)
    if (p) m.set(`${p.tipo}:${p.clave}`, [...(m.get(`${p.tipo}:${p.clave}`) ?? []), a])
  }
  return m
}

/** Cada perfil (con fila o de antes) con sus datos, para la pantalla. */
export function listaDePerfiles(c: Conocidos) {
  return [...datosDePerfiles(c).values()]
}
