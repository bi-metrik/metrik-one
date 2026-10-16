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
 *  · el tope de 3 por elemento y la única principal (también los hace cumplir la base).
 * Las 12 opciones del selector NO se guardan: solo la que se elige.
 */
import { getWorkspace } from '@/lib/actions/get-workspace'
import { bytesDeDataUrl } from '@/lib/cotizaciones/imagen-captura'
import {
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
import { enlacesDeCatalogo } from '@/lib/fotos/catalogo-almacen'
import { sinRepetir, usaFotosDeSitioOficial, type ObjetivoFoto } from '@/lib/fotos/clave'
import { opcionesDeSitioOficial, paginaOficialDesdeWikidata } from '@/lib/fotos/sitio-oficial'
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
  const { supabase, workspaceId, staffId, role, error } = await getWorkspace()
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
    .select('id, tipo, clave, nombre_clave, nombre, ciudad, ref, origen, fuente_url, titulo_fuente, autor, licencia, foco_x, foco_y, proporcion, revisada, descartadas, principal, posicion, imagen_url')
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
  if (usada) return { ok: true, url: usada, desde: 'biblioteca' }
  const w = await paginaOficialDesdeWikidata(o)
  return { ok: true, url: w?.url ?? null, desde: w ? 'wikidata' : null }
}

/** Guarda la opción elegida en el elemento: agrega (hasta 3) o reemplaza `reemplaza`. */
export async function elegirFoto(
  pedido: { tipo: string; nombre: string; ciudad: string | null },
  eleccion: EleccionFoto,
  reemplaza?: string | null,
): Promise<ResultadoElemento> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const o = objetivoDelPedido(pedido)
  if (!o) return { ok: false, error: 'Falta el nombre de lo que quieres ilustrar.' }
  const base = { supabase: ctx.db, workspaceId: ctx.workspaceId, staffId: ctx.staffId, objetivo: o, reemplaza: reemplaza ?? null }
  let r
  if (eleccion?.fuente === 'wikimedia' && typeof eleccion.titulo === 'string') {
    r = await elegirDeCommons({ ...base, titulo: eleccion.titulo })
  } else if (eleccion?.fuente === 'sitio_oficial' && typeof eleccion.pagina === 'string' && typeof eleccion.imagen === 'string') {
    if (!ctx.sitioOficial) return { ok: false, error: MENSAJE_SIN_SITIO }
    r = await elegirDeSitioOficial({ ...base, paginaUrl: eleccion.pagina, imagenUrl: eleccion.imagen })
  } else {
    return { ok: false, error: 'Esa opción no se puede elegir.' }
  }
  if (!r.ok) return { ok: false, error: r.mensaje }
  return elementoActual(ctx, o)
}

/** «Subir la mía» en la biblioteca: agrega (hasta 3) o reemplaza `reemplaza`. */
export async function subirFotoABiblioteca(
  pedido: { tipo: string; nombre: string; ciudad: string | null },
  dataUrl: string,
  reemplaza?: string | null,
): Promise<ResultadoElemento> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const o = objetivoDelPedido(pedido)
  if (!o) return { ok: false, error: 'Falta el nombre de lo que quieres ilustrar.' }
  const partes = typeof dataUrl === 'string' ? bytesDeDataUrl(dataUrl) : null
  if (!partes || !/^image\/(jpeg|png|webp)$/.test(partes.mime)) return { ok: false, error: 'Ese archivo no es una foto. Usa un JPG o un PNG.' }
  const r = await ponerFotoPropia({
    supabase: ctx.db, workspaceId: ctx.workspaceId, staffId: ctx.staffId, objetivo: o, bytes: partes.buffer,
    reemplaza: reemplaza ?? null, agregar: !reemplaza,
  })
  if (!r.ok) return { ok: false, error: r.mensaje }
  return elementoActual(ctx, o)
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
