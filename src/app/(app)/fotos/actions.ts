'use server'

/**
 * «Hoteles y tours» (Mauricio, 2026-10-16): la biblioteca de fotos del espacio, armada por la
 * agencia. Cada hotel y cada tour tiene su perfil con hasta tres fotos; la propuesta las usa solas.
 * La búsqueda automática (Wikimedia Commons, la página oficial, el clasificador) se quitó.
 *
 * Lo que se decide AQUÍ y no en el navegador:
 *  · que la plantilla del workspace tenga propuesta de viaje y que el rol escriba;
 *  · la llave de cada hotel o tour (sale del tipo, el nombre y la ciudad, `objetivoDelPedido`) y a
 *    qué perfil pertenece (`resolverPedidos`: propia, alias o la duda que contesta la persona);
 *  · el tope de 3 por perfil y la única principal (también los hace cumplir la base);
 *  · que una foto subida o pegada traiga la casilla «Tengo autorización» (y quién la marcó, que lo
 *    pone el servidor con el usuario de la sesión).
 */
import { getWorkspace } from '@/lib/actions/get-workspace'
import { revisarAutorizacion } from '@/lib/fotos/autorizacion'
import { bytesDeDataUrl } from '@/lib/cotizaciones/imagen-captura'
import { esCategoria, type CategoriaFoto } from '@/lib/fotos/categoria'
import { elementosDe, filaPorId, fotosDelElemento, ordenar, ponerFotoPropia, quitarFotoPorId, reordenarFotos, type FilaCatalogo } from '@/lib/fotos/catalogo'
import { enlacesDeCatalogo } from '@/lib/fotos/catalogo-almacen'
import { esTipoPerfil, sinRepetir, type ObjetivoFoto, type TipoFoto } from '@/lib/fotos/clave'
import { aliasPorPerfil, contestarDuda, leerConocidos, listaDePerfiles, resolverPedidos, separarAlias, type Conocidos } from '@/lib/fotos/perfiles-db'
import { objetivoDelPedido, vistaDeElemento, type DudaVista, type ElementoVista } from '@/lib/fotos/vista'
import { tienePropuestaHtml } from '@/lib/pdf/motor-html'
import { proveedoresDeTarjetas } from '@/lib/proveedores/tarjeta-db'
import type { ProveedorDeTarjeta } from '@/lib/proveedores/vigencia'

const ROLES_SIN_ESCRITURA = new Set(['read_only', 'contador'])
const MENSAJE_SIN_ROL = 'Tu rol puede ver las fotos pero no cambiarlas.'

/** Lo que el navegador pide: qué hotel, tour o ciudad (la llave la pone el servidor). */
export interface PedidoFoto {
  tipo: TipoFoto
  nombre: string
  ciudad: string | null
}

export type HotelesYTours =
  | { ok: true; elementos: ElementoVista[]; editable: boolean }
  | { ok: false; error: string }

export type ResultadoElemento = { ok: true; elemento: ElementoVista | null } | { ok: false; error: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

async function contexto(escribir: boolean) {
  const { supabase, workspaceId, staffId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: String(error ?? 'No autenticado') }
  if (escribir && role && ROLES_SIN_ESCRITURA.has(role)) return { error: MENSAJE_SIN_ROL }
  const db = supabase as Cliente
  const { data: ws } = await db.from('workspaces').select('cotizacion_template_slug').eq('id', workspaceId).maybeSingle()
  if (!tienePropuestaHtml((ws as { cotizacion_template_slug?: string | null } | null)?.cotizacion_template_slug)) {
    return { error: 'Los hoteles y tours son de la propuesta de viaje, que este espacio no tiene.' }
  }
  return {
    db,
    workspaceId,
    staffId: (staffId as string | null) ?? null,
    userId: (userId as string | null | undefined) ?? null,
    editable: !(role && ROLES_SIN_ESCRITURA.has(role as string)),
  }
}

type Contexto = Exclude<Awaited<ReturnType<typeof contexto>>, { error: string }>

/** Los elementos (perfiles con sus fotos, y ciudades con fotos) como los ve el navegador. */
async function vistasDe(ctx: Contexto, c: Conocidos, soloClaves?: Set<string>): Promise<ElementoVista[]> {
  const fotosPorClave = new Map(elementosDe(c.fotos).map((e) => [`${e.tipo}:${e.clave}`, e]))
  const alias = aliasPorPerfil(c)
  const elementos = [
    ...listaDePerfiles(c).map((p) => ({ tipo: p.tipo as TipoFoto, clave: p.clave, nombre: p.nombre, ciudad: p.ciudad })),
    ...[...fotosPorClave.values()].filter((e) => e.tipo === 'ciudad'),
  ]
    .filter((e) => !soloClaves || soloClaves.has(`${e.tipo}:${e.clave}`))
    .map((e) => ({
      ...e,
      fotos: fotosPorClave.get(`${e.tipo}:${e.clave}`)?.fotos ?? [],
      alias: (alias.get(`${e.tipo}:${e.clave}`) ?? []).map((a) => ({ id: a.id, nombre: a.nombre, ciudad: a.ciudad })),
    }))
  const urls = await enlacesDeCatalogo(ctx.workspaceId, elementos.flatMap((e) => e.fotos.map((f) => f.ref)))
  return elementos.map((e) => vistaDeElemento(e, urls))
}

/** Un perfil como queda después de un cambio. `null` = no tiene perfil ni fotos. */
async function elementoActual(ctx: Contexto, o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): Promise<ResultadoElemento> {
  const leidos = await leerConocidos(ctx.db, ctx.workspaceId)
  if (!leidos.ok) return { ok: false, error: leidos.mensaje }
  const [e] = await vistasDe(ctx, leidos.conocidos, new Set([`${o.tipo}:${o.clave}`]))
  if (e) return { ok: true, elemento: e }
  // Una ciudad sin fotos, o un perfil que todavía no tiene fila: vacío.
  return { ok: true, elemento: null }
}

/** Un perfil con sus fotos, por su llave propia (la sección «Fotos» de la ficha del proveedor). */
export async function elementoDelPerfil(tipo: TipoFoto, clave: string): Promise<ResultadoElemento> {
  const ctx = await contexto(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  if (!esTipoPerfil(tipo) || typeof clave !== 'string' || !clave) return { ok: true, elemento: null }
  return elementoActual(ctx, { tipo, clave })
}

/** «Hoteles y tours»: todos los perfiles del espacio (y las ciudades que tienen fotos). */
export async function leerHotelesYTours(): Promise<HotelesYTours> {
  const ctx = await contexto(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const leidos = await leerConocidos(ctx.db, ctx.workspaceId)
  if (!leidos.ok) return { ok: false, error: leidos.mensaje }
  const orden: Record<TipoFoto, number> = { hotel: 0, actividad: 1, ciudad: 2 }
  const elementos = (await vistasDe(ctx, leidos.conocidos)).sort((a, b) => orden[a.tipo] - orden[b.tipo] || a.nombre.localeCompare(b.nombre, 'es'))
  return { ok: true, elementos, editable: ctx.editable }
}

/** Cuántos elementos pide de una vez el editor de la cotización (sus tarjetas). */
const TOPE_PEDIDOS_TARJETAS = 80

/** Lo que una tarjeta recibe: el perfil de su hotel o tour, o la pregunta. */
export interface FotoDeTarjeta {
  tipo: TipoFoto
  /** La llave de lo que pidió la tarjeta (con ella la ubica el navegador). */
  clave: string
  /** El perfil con sus fotos; `null` si todavía no tiene (o si hay duda). */
  elemento: ElementoVista | null
  /** «¿Es el mismo hotel que …?» (sin contestar). */
  duda: DudaVista | null
  /**
   * El proveedor (la ficha) con sus tarifarios y los de su mayorista, para el aviso de vigencia
   * (2026-10-18). `null` sin ficha todavía, con duda o sin la migración de proveedores.
   */
  proveedor: ProveedorDeTarjeta | null
}

export type FotosDeTarjetas = { ok: true; tarjetas: FotoDeTarjeta[]; editable: boolean } | { ok: false; error: string }

/**
 * Los perfiles de los hoteles y tours de una cotización, en una sola lectura para todas sus
 * tarjetas (las server actions de Next van en fila). La primera vez que un hotel o un tour aparece,
 * su perfil se crea aquí (si el rol escribe); si su nombre se parece a uno conocido, la tarjeta
 * pregunta. Sin propuesta de viaje en el espacio, o sin la migración, `ok: false`: la tarjeta queda
 * como antes.
 */
export async function fotosParaTarjetas(pedidos: PedidoFoto[]): Promise<FotosDeTarjetas> {
  const ctx = await contexto(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const objetivos = sinRepetir((Array.isArray(pedidos) ? pedidos.slice(0, TOPE_PEDIDOS_TARJETAS) : []).map(objetivoDelPedido))
  const leidos = await leerConocidos(ctx.db, ctx.workspaceId)
  if (!leidos.ok) return { ok: false, error: leidos.mensaje }
  const c = leidos.conocidos
  const resueltos = await resolverPedidos(ctx.db, ctx.workspaceId, ctx.staffId, objetivos, c, { escribir: ctx.editable })
  const claves = new Set(resueltos.flatMap((r) => [r.perfil, r.duda && { tipo: r.pedido.tipo, clave: r.duda.clave }]).filter((x): x is ObjetivoFoto => !!x).map((x) => `${x.tipo}:${x.clave}`))
  const perfiles = resueltos.flatMap((r) => (r.perfil && esTipoPerfil(r.perfil.tipo) ? [r.perfil] : []))
  const [vistas, proveedores] = await Promise.all([vistasDe(ctx, c, claves), proveedoresDeTarjetas(ctx.db, ctx.workspaceId, perfiles)])
  const porClave = new Map(vistas.map((e) => [`${e.tipo}:${e.clave}`, e]))
  return {
    ok: true,
    editable: ctx.editable,
    tarjetas: resueltos.map((r) => {
      const conocido = r.duda ? porClave.get(`${r.pedido.tipo}:${r.duda.clave}`) : null
      return {
        tipo: r.pedido.tipo,
        clave: r.pedido.clave,
        elemento: r.perfil ? porClave.get(`${r.perfil.tipo}:${r.perfil.clave}`) ?? null : null,
        duda: r.duda ? { ...r.duda, url: conocido?.fotos[0]?.url ?? null } : null,
        proveedor: r.perfil ? proveedores.get(`${r.perfil.tipo}:${r.perfil.clave}`) ?? null : null,
      }
    }),
  }
}

/** El perfil de lo que pide una tarjeta o la pantalla (resolviendo alias). Error si hay duda. */
async function perfilDelPedido(ctx: Contexto, pedido: unknown): Promise<{ perfil: ObjetivoFoto } | { error: string }> {
  const o = objetivoDelPedido(pedido)
  if (!o) return { error: 'Falta el nombre de lo que quieres ilustrar.' }
  if (!esTipoPerfil(o.tipo)) return { perfil: o }
  const leidos = await leerConocidos(ctx.db, ctx.workspaceId)
  if (!leidos.ok) return { error: leidos.mensaje }
  const [r] = await resolverPedidos(ctx.db, ctx.workspaceId, ctx.staffId, [o], leidos.conocidos, { escribir: true })
  if (!r?.perfil) return { error: `Primero dinos si es el mismo ${o.tipo === 'hotel' ? 'hotel' : 'tour'} que «${r?.duda?.nombre ?? ''}».` }
  return { perfil: r.perfil }
}

/**
 * La respuesta a «¿Es el mismo hotel que …?» desde la tarjeta: `mismo` lo une al perfil conocido
 * (`clavePerfil`) y la próxima vez se reconoce solo; si no, queda con su perfil propio.
 */
export async function contestarMismoPerfil(pedido: PedidoFoto, clavePerfil: string, mismo: boolean): Promise<ResultadoElemento> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const o = objetivoDelPedido(pedido)
  if (!o) return { ok: false, error: 'Falta el nombre de lo que quieres ilustrar.' }
  const r = await contestarDuda(ctx.db, ctx.workspaceId, ctx.staffId, o, typeof clavePerfil === 'string' ? clavePerfil : '', mismo === true)
  if (!r.ok) return { ok: false, error: r.mensaje }
  return elementoActual(ctx, r.perfil)
}

/**
 * «Agregar un hotel o un tour» desde la pantalla, antes de que llegue a una cotización. Si el
 * nombre se parece a uno conocido, devuelve la duda (la pantalla pregunta igual que la tarjeta).
 */
export async function crearPerfil(pedido: PedidoFoto): Promise<ResultadoElemento | { ok: true; elemento: null; duda: DudaVista }> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const o = objetivoDelPedido(pedido)
  if (!o || !esTipoPerfil(o.tipo)) return { ok: false, error: 'Escribe el nombre del hotel o del tour.' }
  const leidos = await leerConocidos(ctx.db, ctx.workspaceId)
  if (!leidos.ok) return { ok: false, error: leidos.mensaje }
  const [r] = await resolverPedidos(ctx.db, ctx.workspaceId, ctx.staffId, [o], leidos.conocidos, { escribir: true })
  if (r.duda) {
    const [conocido] = await vistasDe(ctx, leidos.conocidos, new Set([`${o.tipo}:${r.duda.clave}`]))
    return { ok: true, elemento: null, duda: { ...r.duda, url: conocido?.fotos[0]?.url ?? null } }
  }
  return elementoActual(ctx, r.perfil ?? o)
}

/**
 * Subir o pegar una foto en un perfil (la tarjeta o la pantalla): se agrega (hasta 3) o reemplaza
 * `reemplaza`. `autorizacion` = la casilla «Tengo autorización para usar esta foto» (obligatoria)
 * y, si la persona lo dijo, de dónde viene (Emilio, 2026-10-16). Un hotel, con su categoría si la
 * dijo.
 */
export async function subirFotoABiblioteca(
  pedido: PedidoFoto,
  dataUrl: string,
  reemplaza?: string | null,
  categoria?: string | null,
  autorizacion?: unknown,
): Promise<ResultadoElemento> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  // Antes de resolver el perfil (que puede escribir): la casilla y el archivo.
  const sub = revisarSubida(ctx, dataUrl, autorizacion)
  if ('error' in sub) return { ok: false, error: String(sub.error) }
  const p = await perfilDelPedido(ctx, pedido)
  if ('error' in p) return { ok: false, error: p.error }
  return subirAlPerfil(ctx, p, sub, reemplaza, categoria)
}

/**
 * Lo mismo desde la ficha del proveedor: el perfil va por su id (su llave no cambia aunque la ficha
 * cambie de nombre o de ciudad), así no se crea un alias ni se pregunta «¿es el mismo?».
 */
export async function subirFotoAlProveedor(
  perfilId: string,
  dataUrl: string,
  reemplaza?: string | null,
  categoria?: string | null,
  autorizacion?: unknown,
): Promise<ResultadoElemento> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const sub = revisarSubida(ctx, dataUrl, autorizacion)
  if ('error' in sub) return { ok: false, error: String(sub.error) }
  const { data } = typeof perfilId === 'string' && perfilId
    ? await ctx.db.from('fotos_perfiles').select('tipo, clave, nombre, ciudad').eq('workspace_id', ctx.workspaceId).eq('id', perfilId).maybeSingle()
    : { data: null }
  const fila = data as { tipo: string; clave: string; nombre: string; ciudad: string | null } | null
  if (!fila || !esTipoPerfil(fila.tipo)) return { ok: false, error: 'Este proveedor no tiene fotos.' }
  return subirAlPerfil(ctx, { perfil: { tipo: fila.tipo, clave: fila.clave, nombre: fila.nombre, ciudad: fila.ciudad } }, sub, reemplaza, categoria)
}

/** La casilla «Tengo autorización», quién sube y que el archivo sea una foto. */
function revisarSubida(ctx: Contexto, dataUrl: unknown, autorizacion: unknown) {
  const permiso = revisarAutorizacion(autorizacion)
  if (!permiso.ok) return { error: permiso.error }
  if (!ctx.userId) return { error: 'No se pudo saber quién sube la foto. Vuelve a entrar.' }
  const partes = typeof dataUrl === 'string' ? bytesDeDataUrl(dataUrl) : null
  if (!partes || !/^image\/(jpeg|png|webp)$/.test(partes.mime)) return { error: 'Ese archivo no es una foto. Usa un JPG o un PNG.' }
  return { userId: ctx.userId, procedencia: permiso.procedencia, buffer: partes.buffer }
}

async function subirAlPerfil(
  ctx: Contexto,
  p: { perfil: ObjetivoFoto },
  sub: Exclude<ReturnType<typeof revisarSubida>, { error: string }>,
  reemplaza: string | null | undefined,
  categoria: string | null | undefined,
): Promise<ResultadoElemento> {
  const r = await ponerFotoPropia({
    supabase: ctx.db,
    workspaceId: ctx.workspaceId,
    staffId: ctx.staffId,
    objetivo: p.perfil,
    bytes: sub.buffer,
    reemplaza: typeof reemplaza === 'string' && reemplaza ? reemplaza : null,
    ...categoriaDelPedido(p.perfil.tipo, categoria),
    autorizacion: { userId: sub.userId, procedencia: sub.procedencia },
  })
  if (!r.ok) return { ok: false, error: r.mensaje }
  return elementoActual(ctx, p.perfil)
}

/** La categoría que manda el navegador, revisada: solo para un hotel y solo una de las cuatro. */
function categoriaDelPedido(tipo: TipoFoto, categoria: unknown): { categoria?: CategoriaFoto } {
  return tipo === 'hotel' && esCategoria(categoria) ? { categoria } : {}
}

async function elementoDeFoto(ctx: Contexto, id: string): Promise<FilaCatalogo | null> {
  return filaPorId(ctx.db, ctx.workspaceId, id)
}

/**
 * Cambia el orden de una foto en su perfil: `antes` y `despues` la corren un puesto; `primera` la
 * deja principal. La primera del orden es la principal.
 */
export async function moverFoto(id: string, hacia: 'antes' | 'despues' | 'primera'): Promise<ResultadoElemento> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const f = await elementoDeFoto(ctx, id)
  if (!f) return { ok: false, error: 'Esa foto ya no está en la biblioteca. Recarga.' }
  const leidas = await fotosDelElemento(ctx.db, ctx.workspaceId, f)
  if ('error' in leidas) return { ok: false, error: leidas.error as string }
  const ids = ordenar(leidas.filas).map((x) => x.id)
  const i = ids.indexOf(id)
  const j = hacia === 'primera' ? 0 : hacia === 'antes' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= ids.length || i === j) return elementoActual(ctx, f)
  ids.splice(i, 1)
  ids.splice(j, 0, id)
  const r = await reordenarFotos(ctx.db, ctx.workspaceId, ctx.staffId, ids)
  if (!r.ok) return { ok: false, error: r.mensaje ?? 'No se pudo cambiar el orden.' }
  return elementoActual(ctx, f)
}

/** Quita una foto del perfil (si era la principal, la siguiente pasa a serlo). */
export async function quitarFotoDeBiblioteca(id: string): Promise<ResultadoElemento> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const f = await elementoDeFoto(ctx, id)
  if (!f) return { ok: false, error: 'Esa foto ya no está en la biblioteca. Recarga.' }
  const r = await quitarFotoPorId(ctx.db, ctx.workspaceId, id)
  if (!r.ok) return { ok: false, error: r.mensaje ?? 'No se pudo quitar la foto.' }
  return elementoActual(ctx, f)
}

/** «No es el mismo»: separa un nombre de su perfil (la próxima cotización que lo nombre pregunta). */
export async function separarNombreDelPerfil(aliasId: string): Promise<ResultadoElemento> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const r = await separarAlias(ctx.db, ctx.workspaceId, aliasId)
  if (!r.ok) return { ok: false, error: r.mensaje }
  return elementoActual(ctx, { tipo: r.tipo, clave: r.clavePerfil })
}
