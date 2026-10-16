'use server'

/**
 * La biblioteca de fotos del workspace (decisión de Mauricio del 2026-10-16): ver, buscar,
 * precargar y cambiar las fotos de hoteles, tours/planes y ciudades, fuera de la cotización. Se
 * reusan en todas las propuestas.
 *
 * Lo que se decide AQUÍ y no en el navegador:
 *  · que la plantilla del workspace tenga propuesta html y que el rol escriba;
 *  · la llave de cada elemento (sale del tipo, el nombre y la ciudad, `objetivoDelPedido`);
 *  · que la foto de Commons tenga licencia imprimible (se vuelve a pedir a Commons al elegirla);
 *  · que la página oficial esté encendida en el workspace y que la imagen esté en esa página;
 *  · el tope de 3 por elemento y la única principal (también los hace cumplir la base);
 *  · que una foto subida o pegada traiga la casilla «Tengo autorización» (y quién la marcó, que lo
 *    pone el servidor con el usuario de la sesión);
 *  · que nada venga de una agencia en línea (Booking, Expedia, Despegar…): nunca son fuente.
 * Las 12 opciones del selector NO se guardan: solo la que se elige.
 */
import { getWorkspace } from '@/lib/actions/get-workspace'
import { esDeAgenciaDeViajes, MENSAJE_AGENCIA, urlEsDeAgencia } from '@/lib/fotos/agencias'
import { revisarAutorizacion } from '@/lib/fotos/autorizacion'
import { bytesDeDataUrl } from '@/lib/cotizaciones/imagen-captura'
import { esCategoria, type CategoriaFoto } from '@/lib/fotos/categoria'
import {
  anotarCategoria,
  COLUMNAS,
  elegirDeCommons,
  elegirDeSitioOficial,
  elementosDe,
  leerBiblioteca,
  leerCatalogo,
  marcarPrincipal,
  ponerFotoPropia,
  quitarFotoPorId,
  TABLA_CATALOGO,
  type FilaCatalogo,
} from '@/lib/fotos/catalogo'
import { bytesDeCatalogo, enlacesDeCatalogo } from '@/lib/fotos/catalogo-almacen'
import { sinRepetir, usaFotosDeSitioOficial, type ObjetivoFoto } from '@/lib/fotos/clave'
import { clasificar, opcionesDeHotelEnCommons, opcionesDeHotelEnSitio } from '@/lib/fotos/opciones-hotel'
import { datosDesdeWikidata, opcionesDeSitioOficial, paginaOficialDesdeWikidata } from '@/lib/fotos/sitio-oficial'
import { dominio, objetivoDelPedido, vistaDeElemento, type EleccionFoto, type ElementoVista, type OpcionFoto } from '@/lib/fotos/vista'
import { opcionesDeCommons } from '@/lib/fotos/wikimedia'
import { tienePropuestaHtml } from '@/lib/pdf/motor-html'

const ROLES_SIN_ESCRITURA = new Set(['read_only', 'contador'])
const MENSAJE_SIN_SITIO = 'Las fotos de la página oficial no están encendidas en este espacio.'

export type BibliotecaFotos =
  | { ok: true; elementos: ElementoVista[]; editable: boolean; sitioOficial: boolean }
  | { ok: false; error: string }

export type ResultadoElemento = { ok: true; elemento: ElementoVista | null } | { ok: false; error: string }

export type OpcionesDeFoto =
  | { ok: true; opciones: OpcionFoto[]; siguiente: string | null; pagina?: string }
  | { ok: false; error: string }

export type PaginaSugerida = { ok: true; url: string | null; desde: 'biblioteca' | 'wikidata' | null } | { ok: false; error: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

async function contexto(escribir: boolean) {
  const { supabase, workspaceId, staffId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: String(error ?? 'No autenticado') }
  if (escribir && role && ROLES_SIN_ESCRITURA.has(role)) return { error: 'Tu rol puede ver las fotos pero no cambiarlas.' }
  const db = supabase as Cliente
  const { data: ws } = await db.from('workspaces').select('cotizacion_template_slug, config_extra').eq('id', workspaceId).maybeSingle()
  const fila = ws as { cotizacion_template_slug?: string | null; config_extra?: unknown } | null
  if (!tienePropuestaHtml(fila?.cotizacion_template_slug)) return { error: 'La biblioteca de fotos es de la propuesta de viaje, que este espacio no tiene.' }
  return {
    db,
    workspaceId,
    staffId: (staffId as string | null) ?? null,
    userId: (userId as string | null | undefined) ?? null,
    editable: !(role && ROLES_SIN_ESCRITURA.has(role as string)),
    sitioOficial: usaFotosDeSitioOficial(fila?.config_extra),
  }
}

type Contexto = Exclude<Awaited<ReturnType<typeof contexto>>, { error: string }>

async function vistas(ctx: Contexto, filas: FilaCatalogo[]): Promise<ElementoVista[]> {
  const urls = await enlacesDeCatalogo(ctx.workspaceId, filas.map((f) => f.ref))
  return elementosDe(filas).map((e) => vistaDeElemento(e, urls, { sitioOficial: ctx.sitioOficial }))
}

/** El elemento como queda después de un cambio (`null` si ya no tiene fotos). */
async function elementoActual(ctx: Contexto, o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): Promise<ResultadoElemento> {
  const { data, error } = await ctx.db
    .from(TABLA_CATALOGO)
    .select(COLUMNAS)
    .eq('workspace_id', ctx.workspaceId)
    .eq('tipo', o.tipo)
    .eq('clave', o.clave)
  if (error) return { ok: false, error: 'No se pudo leer la biblioteca de fotos.' }
  const [elemento] = await vistas(ctx, (data ?? []) as FilaCatalogo[])
  return { ok: true, elemento: elemento ?? null }
}

/** Toda la biblioteca del workspace (la pantalla filtra y busca en el navegador). */
export async function leerBibliotecaDeFotos(): Promise<BibliotecaFotos> {
  const ctx = await contexto(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const r = await leerBiblioteca(ctx.db, ctx.workspaceId)
  if (!r.ok) return { ok: false, error: r.mensaje }
  const urls = await enlacesDeCatalogo(ctx.workspaceId, r.elementos.flatMap((e) => e.fotos.map((f) => f.ref)))
  return {
    ok: true,
    elementos: r.elementos.map((e) => vistaDeElemento(e, urls, { sitioOficial: ctx.sitioOficial })),
    editable: ctx.editable,
    sitioOficial: ctx.sitioOficial,
  }
}

/** Cuántos elementos pide de una vez el editor de la cotización (sus tarjetas). */
const TOPE_PEDIDOS_TARJETAS = 80

export type FotosDeTarjetas =
  | { ok: true; elementos: ElementoVista[]; editable: boolean; sitioOficial: boolean }
  | { ok: false; error: string }

/**
 * Las fotos de la biblioteca para las tarjetas de una cotización (el recuadro de la foto del
 * hotel es la puerta a la biblioteca, Mauricio 2026-10-16): una sola lectura para todas las
 * tarjetas a la vista. La llave de cada una la calcula el servidor. Sin biblioteca en el espacio
 * (otra plantilla, o sin la migración) responde `ok: false` y la tarjeta queda como antes.
 */
export async function fotosParaTarjetas(pedidos: { tipo: string; nombre: string; ciudad: string | null }[]): Promise<FotosDeTarjetas> {
  const ctx = await contexto(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const objetivos = sinRepetir((Array.isArray(pedidos) ? pedidos.slice(0, TOPE_PEDIDOS_TARJETAS) : []).map(objetivoDelPedido))
  const { error: sinMigracion } = await ctx.db.from(TABLA_CATALOGO).select('id').limit(1)
  if (sinMigracion) return { ok: false, error: 'La biblioteca de fotos todavía no está disponible.' }
  const filas = objetivos.length > 0 ? await leerCatalogo(ctx.db, ctx.workspaceId, { objetivos }) : []
  const pedidas = new Set(objetivos.map((o) => `${o.tipo}:${o.clave}`))
  return {
    ok: true,
    elementos: await vistas(ctx, filas.filter((f) => pedidas.has(`${f.tipo}:${f.clave}`))),
    editable: ctx.editable,
    sitioOficial: ctx.sitioOficial,
  }
}

/**
 * 12 opciones para elegir de una fuente. `siguiente` es lo que devolvió la tanda anterior («Ver
 * más»). En la página oficial, `paginaUrl` es la que pegó o confirmó la persona.
 */
export async function opcionesDeFoto(
  pedido: { tipo: string; nombre: string; ciudad: string | null },
  fuente: 'wikimedia' | 'sitio_oficial',
  siguiente: string | null,
  paginaUrl?: string | null,
): Promise<OpcionesDeFoto> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const o = objetivoDelPedido(pedido)
  if (!o) return { ok: false, error: 'Falta el nombre de lo que quieres ilustrar.' }
  const desde = Math.max(0, Math.min(10_000, Number.parseInt(siguiente ?? '0', 10) || 0))
  if (fuente === 'wikimedia') {
    const r = await opcionesDeCommons(o, { pagina: desde })
    return {
      ok: true,
      opciones: r.candidatas.map((c) => ({
        id: c.titulo,
        fuente: 'wikimedia',
        miniatura: c.descarga,
        ancho: c.ancho,
        alto: c.alto,
        titulo: c.titulo,
        credito: `${c.autor} · ${c.licencia}`,
        pagina: c.pagina,
      })),
      siguiente: r.hayMas ? String(desde + 1) : null,
    }
  }
  if (fuente !== 'sitio_oficial') return { ok: false, error: 'Fuente desconocida.' }
  if (esDeAgenciaDeViajes(paginaUrl)) return { ok: false, error: MENSAJE_AGENCIA }
  if (!ctx.sitioOficial) return { ok: false, error: MENSAJE_SIN_SITIO }
  if (typeof paginaUrl !== 'string' || !paginaUrl.trim()) return { ok: false, error: 'Pega la dirección de la página oficial (https://…).' }
  const r = await opcionesDeSitioOficial(paginaUrl.trim(), { desde })
  if (!r.ok) return { ok: false, error: r.error }
  return {
    ok: true,
    pagina: r.pagina,
    opciones: r.candidatas.map((c) => ({
      id: c.imagen,
      fuente: 'sitio_oficial',
      miniatura: c.miniatura,
      ancho: c.ancho,
      alto: c.alto,
      titulo: c.imagen,
      credito: dominio(c.pagina),
      pagina: c.pagina,
      imagen: c.imagen,
    })),
    siguiente: r.siguiente === null ? null : String(r.siguiente),
  }
}

/**
 * La página oficial que ONE propone para un elemento: la que ya se usó en la biblioteca para ese
 * elemento, o la de Wikidata si hay UNA entidad con ese nombre en esa ciudad. La persona la ve y
 * la confirma antes de buscar fotos.
 */
export async function paginaOficialSugerida(pedido: { tipo: string; nombre: string; ciudad: string | null }): Promise<PaginaSugerida> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  if (!ctx.sitioOficial) return { ok: false, error: MENSAJE_SIN_SITIO }
  const o = objetivoDelPedido(pedido)
  if (!o) return { ok: false, error: 'Falta el nombre de lo que quieres ilustrar.' }
  const { data } = await ctx.db
    .from(TABLA_CATALOGO)
    .select('fuente_url')
    .eq('workspace_id', ctx.workspaceId)
    .eq('tipo', o.tipo)
    .eq('clave', o.clave)
    .eq('origen', 'sitio_oficial')
    .limit(1)
  const usada = (data as { fuente_url?: string | null }[] | null)?.[0]?.fuente_url
  if (usada && !urlEsDeAgencia(usada)) return { ok: true, url: usada, desde: 'biblioteca' }
  const w = await paginaOficialDesdeWikidata(o)
  const deWikidata = w && !urlEsDeAgencia(w.url) ? w : null
  return { ok: true, url: deWikidata?.url ?? null, desde: deWikidata ? 'wikidata' : null }
}

/** Guarda la opción elegida en el elemento: agrega (hasta 3) o reemplaza `reemplaza`. */
export async function elegirFoto(
  pedido: { tipo: string; nombre: string; ciudad: string | null },
  eleccion: EleccionFoto,
  reemplaza?: string | null,
  categoria?: string | null,
): Promise<ResultadoElemento> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const o = objetivoDelPedido(pedido)
  if (!o) return { ok: false, error: 'Falta el nombre de lo que quieres ilustrar.' }
  const base = { supabase: ctx.db, workspaceId: ctx.workspaceId, staffId: ctx.staffId, objetivo: o, reemplaza: reemplaza ?? null, ...categoriaDelPedido(o.tipo, categoria) }
  let r
  if (eleccion?.fuente === 'wikimedia' && typeof eleccion.titulo === 'string') {
    r = await elegirDeCommons({ ...base, titulo: eleccion.titulo })
  } else if (eleccion?.fuente === 'sitio_oficial' && typeof eleccion.pagina === 'string' && typeof eleccion.imagen === 'string') {
    if (esDeAgenciaDeViajes(eleccion.pagina) || urlEsDeAgencia(eleccion.imagen)) return { ok: false, error: MENSAJE_AGENCIA }
    if (!ctx.sitioOficial) return { ok: false, error: MENSAJE_SIN_SITIO }
    r = await elegirDeSitioOficial({ ...base, paginaUrl: eleccion.pagina, imagenUrl: eleccion.imagen })
  } else {
    return { ok: false, error: 'Esa opción no se puede elegir.' }
  }
  if (!r.ok) return { ok: false, error: r.mensaje }
  return elementoActual(ctx, o)
}

/**
 * «Subir la mía» (o pegar) en la biblioteca: agrega (hasta 3) o reemplaza `reemplaza`. Un hotel,
 * con la categoría de la pestaña. `autorizacion` = la casilla «Tengo autorización para usar esta
 * foto» (obligatoria) y, si la persona lo dijo, de dónde viene (Emilio, 2026-10-16).
 */
export async function subirFotoABiblioteca(
  pedido: { tipo: string; nombre: string; ciudad: string | null },
  dataUrl: string,
  reemplaza?: string | null,
  categoria?: string | null,
  autorizacion?: unknown,
): Promise<ResultadoElemento> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const o = objetivoDelPedido(pedido)
  if (!o) return { ok: false, error: 'Falta el nombre de lo que quieres ilustrar.' }
  const permiso = revisarAutorizacion(autorizacion)
  if (!permiso.ok) return { ok: false, error: permiso.error }
  if (!ctx.userId) return { ok: false, error: 'No se pudo saber quién sube la foto. Vuelve a entrar.' }
  const partes = typeof dataUrl === 'string' ? bytesDeDataUrl(dataUrl) : null
  if (!partes || !/^image\/(jpeg|png|webp)$/.test(partes.mime)) return { ok: false, error: 'Ese archivo no es una foto. Usa un JPG o un PNG.' }
  const r = await ponerFotoPropia({
    supabase: ctx.db, workspaceId: ctx.workspaceId, staffId: ctx.staffId, objetivo: o, bytes: partes.buffer,
    reemplaza: reemplaza ?? null, agregar: !reemplaza, ...categoriaDelPedido(o.tipo, categoria),
    autorizacion: { userId: ctx.userId, procedencia: permiso.procedencia },
  })
  if (!r.ok) return { ok: false, error: r.mensaje }
  return elementoActual(ctx, o)
}

/**
 * La categoría que manda el navegador (la pestaña), revisada: solo para un hotel y solo una de las
 * cuatro. Sin ella, `{}` (la foto entra como antes, sin reparto por categoría).
 */
function categoriaDelPedido(tipo: ObjetivoFoto['tipo'], categoria: unknown): { categoria?: CategoriaFoto } {
  return tipo === 'hotel' && esCategoria(categoria) ? { categoria } : {}
}

export type OpcionesDeHotel =
  | {
      ok: true
      opciones: OpcionFoto[]
      siguiente: string | null
      /** ¿El modelo alcanzó a mirar alguna? (sin él, todo queda «sin clasificar»). */
      clasificadas: boolean
      /** La página leída (sitio oficial). */
      pagina?: string
      /** Con el interruptor encendido: la página oficial que ONE propone para pegar. */
      paginaSugerida?: { url: string; desde: 'biblioteca' | 'wikidata' } | null
    }
  | { ok: false; error: string }

/**
 * Las opciones del selector de un HOTEL, ya clasificadas por pestaña (fachada, habitación, zonas
 * comunes). Sin `paginaUrl`: Commons (categoría exacta del hotel y títulos que lo nombran) y, con
 * el interruptor, la página oficial propuesta. Con `paginaUrl` (solo con el interruptor): la
 * galería de esa página, de a 12. Nada se guarda.
 */
export async function opcionesDeHotel(
  pedido: { tipo: string; nombre: string; ciudad: string | null },
  paginaUrl?: string | null,
  siguiente?: string | null,
): Promise<OpcionesDeHotel> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const o = objetivoDelPedido(pedido)
  if (!o || o.tipo !== 'hotel') return { ok: false, error: 'Falta el nombre del hotel.' }
  const apiKey = process.env.GEMINI_API_KEY
  if (typeof paginaUrl === 'string' && paginaUrl.trim()) {
    if (esDeAgenciaDeViajes(paginaUrl)) return { ok: false, error: MENSAJE_AGENCIA }
    if (!ctx.sitioOficial) return { ok: false, error: MENSAJE_SIN_SITIO }
    const desde = Math.max(0, Math.min(10_000, Number.parseInt(siguiente ?? '0', 10) || 0))
    const r = await opcionesDeHotelEnSitio(paginaUrl.trim(), o, { apiKey, desde })
    if (!r.ok) return { ok: false, error: r.error }
    return {
      ok: true,
      opciones: r.opciones,
      siguiente: r.siguiente === null ? null : String(r.siguiente),
      clasificadas: r.opciones.some((x) => x.categoria),
      pagina: r.pagina,
    }
  }
  const wd = await datosDesdeWikidata(o)
  const r = await opcionesDeHotelEnCommons(o, { apiKey, categoriaWikidata: wd.categoria })
  let paginaSugerida: { url: string; desde: 'biblioteca' | 'wikidata' } | null = null
  if (ctx.sitioOficial) {
    const { data } = await ctx.db
      .from(TABLA_CATALOGO)
      .select('fuente_url')
      .eq('workspace_id', ctx.workspaceId)
      .eq('tipo', o.tipo)
      .eq('clave', o.clave)
      .eq('origen', 'sitio_oficial')
      .limit(1)
    const usada = (data as { fuente_url?: string | null }[] | null)?.[0]?.fuente_url
    paginaSugerida =
      usada && !urlEsDeAgencia(usada)
        ? { url: usada, desde: 'biblioteca' }
        : wd.pagina && !urlEsDeAgencia(wd.pagina.url)
          ? { url: wd.pagina.url, desde: 'wikidata' }
          : null
  }
  return { ok: true, opciones: r.opciones, siguiente: null, clasificadas: r.clasificadas, paginaSugerida }
}

/**
 * Las fotos que ya tiene un hotel en la biblioteca, con su categoría. Las de antes de las
 * categorías se clasifican UNA vez con el modelo y la categoría queda en su fila (no se vuelve a
 * preguntar). `null` si el hotel no tiene fotos.
 */
export async function fotosDelHotel(pedido: { tipo: string; nombre: string; ciudad: string | null }): Promise<ResultadoElemento> {
  const ctx = await contexto(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const o = objetivoDelPedido(pedido)
  if (!o || o.tipo !== 'hotel') return { ok: false, error: 'Falta el nombre del hotel.' }
  const { data, error } = await ctx.db.from(TABLA_CATALOGO).select(COLUMNAS).eq('workspace_id', ctx.workspaceId).eq('tipo', 'hotel').eq('clave', o.clave)
  if (error) return { ok: false, error: 'No se pudo leer la biblioteca de fotos.' }
  const filas = (data ?? []) as FilaCatalogo[]
  const sin = ctx.editable ? filas.filter((f) => !f.categoria) : []
  if (sin.length > 0 && process.env.GEMINI_API_KEY) {
    const clases = await clasificar(
      sin.map((f) => ({
        clave: `fila:${f.id}:${f.ref}`,
        leer: async () => {
          const bytes = await bytesDeCatalogo(ctx.workspaceId, f.ref)
          return bytes ? { bytes, mime: 'image/jpeg' } : null
        },
      })),
      { apiKey: process.env.GEMINI_API_KEY, hotel: o.nombre, ciudad: o.ciudad },
    )
    await Promise.all(
      sin.map(async (f, i) => {
        const c = clases[i]
        if (c && c !== 'no_es_hotel' && (await anotarCategoria(ctx.db, ctx.workspaceId, f.id, c))) f.categoria = c
      }),
    )
  }
  const [elemento] = await vistas(ctx, filas)
  return { ok: true, elemento: elemento ?? null }
}

async function porId(ctx: Contexto, id: string): Promise<{ tipo: FilaCatalogo['tipo']; clave: string } | null> {
  if (typeof id !== 'string' || !id) return null
  const { data } = await ctx.db.from(TABLA_CATALOGO).select('tipo, clave').eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  return (data as { tipo: FilaCatalogo['tipo']; clave: string } | null) ?? null
}

/** Marca la foto como la principal de su elemento (la que sale primero en la propuesta). */
export async function marcarFotoPrincipal(id: string): Promise<ResultadoElemento> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const el = await porId(ctx, id)
  if (!el) return { ok: false, error: 'Esa foto ya no está en la biblioteca. Recarga.' }
  const r = await marcarPrincipal(ctx.db, ctx.workspaceId, ctx.staffId, id)
  if (!r.ok) return { ok: false, error: r.mensaje ?? 'No se pudo cambiar la principal.' }
  return elementoActual(ctx, el)
}

/** Quita una foto de la biblioteca (si era la principal, la siguiente pasa a serlo). */
export async function quitarFotoDeBiblioteca(id: string): Promise<ResultadoElemento> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const el = await porId(ctx, id)
  if (!el) return { ok: false, error: 'Esa foto ya no está en la biblioteca. Recarga.' }
  const r = await quitarFotoPorId(ctx.db, ctx.workspaceId, id)
  if (!r.ok) return { ok: false, error: r.mensaje ?? 'No se pudo quitar la foto.' }
  return elementoActual(ctx, el)
}
