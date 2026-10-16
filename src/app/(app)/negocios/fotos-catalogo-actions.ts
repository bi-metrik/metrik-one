'use server'

/**
 * «Fotos de la propuesta» (PR 4): el catálogo de fotos del workspace visto desde una cotización.
 *
 * La cotización solo dice QUÉ fotos hacen falta (sus ciudades, hoteles y actividades); la foto es
 * del workspace y se reusa en las demás. Lo que se decide AQUÍ y no en el navegador:
 *  · que el workspace tenga la propuesta nueva (motor `html`) y que el rol escriba;
 *  · que la cotización sea del workspace (RLS) y que lo pedido (tipo + llave) sea de ella: el
 *    nombre y la ciudad salen de sus líneas, nunca del navegador.
 * Cambiar una foto no toca ninguna cotización: el PDF ya enviado no cambia.
 */
import { getWorkspace } from '@/lib/actions/get-workspace'
import { bytesDeDataUrl } from '@/lib/cotizaciones/imagen-captura'
import { confirmarFoto, creditoDeFila, filaDe, fotosDe, leerCatalogo, MENSAJE_HOTEL_SIN_COMMONS, MENSAJE_SIN_TABLA, ponerFotoPropia, quitarFoto, sugerirDesdeCommons, TABLA_CATALOGO } from '@/lib/fotos/catalogo'
import { enlaceDeCatalogo } from '@/lib/fotos/catalogo-almacen'
import { fotoImprimible, seSugiereDeCommons, usaFotosDeSitioOficial, type ObjetivoFoto, type OrigenFoto, type TipoFoto } from '@/lib/fotos/clave'
import { objetivosDeItems } from '@/lib/fotos/objetivos'
import { fotosDeCiudad } from '@/lib/pdf/fotos-ciudad'
import { PLANTILLA_POR_DEFECTO, usaMotorHtml } from '@/lib/pdf/plantillas-cotizacion'

const ROLES_SIN_ESCRITURA = new Set(['read_only', 'contador'])
/** Cuántas sugerencias se buscan por toque: Commons pide no martillar su API. */
const TOPE_SUGERENCIAS = 12

export interface FotoDelPanel {
  tipo: TipoFoto
  clave: string
  nombre: string
  ciudad: string | null
  /** La ciudad ya tiene foto en el banco de ONE: no hace falta una del catálogo. */
  enBanco: boolean
  /** Se le busca foto SOLA en Commons («Otra», «Buscar»). Un hotel no: lo elige una persona. */
  sugerible: boolean
  /** Cuántas fotos tiene en la biblioteca (hasta 3). */
  total: number
  foto: {
    /** La principal, para cambiarla desde el selector. */
    id: string
    /** Sale en la propuesta. Una automática para un hotel queda en la biblioteca pero no se imprime. */
    seImprime: boolean
    url: string | null
    origen: OrigenFoto
    credito: string | null
    fuente: string | null
    revisada: boolean
  } | null
}

export type PanelFotos =
  | { ok: true; fotos: FotoDelPanel[]; editable: boolean; sitioOficial: boolean; aviso?: string }
  | { ok: false; error: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

async function contexto(cotizacionId: string, escribir: boolean) {
  const { supabase, workspaceId, staffId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: String(error ?? 'No autenticado') }
  if (escribir && role && ROLES_SIN_ESCRITURA.has(role)) return { error: 'Tu rol puede ver las fotos pero no cambiarlas.' }
  const db = supabase as Cliente
  const { data: ws } = await db.from('workspaces').select('cotizacion_template_slug, config_extra').eq('id', workspaceId).maybeSingle()
  const fila = ws as { cotizacion_template_slug?: string | null; config_extra?: unknown } | null
  if (!usaMotorHtml(fila?.cotizacion_template_slug ?? PLANTILLA_POR_DEFECTO, fila?.config_extra)) {
    return { error: 'Las fotos de la propuesta son de la propuesta nueva, que este espacio no tiene encendida.' }
  }
  const { data: cot } = await db.from('cotizaciones').select('id').eq('id', cotizacionId).eq('workspace_id', workspaceId).maybeSingle()
  if (!cot) return { error: 'Cotización no encontrada' }
  const { data: items } = await db.from('items').select('id, nombre, grupo, tarifa_pax, descripcion').eq('cotizacion_id', cotizacionId)
  const objetivos = objetivosDeItems((items ?? []) as { nombre: string | null; grupo: string | null; tarifa_pax?: unknown }[])
  return { db, workspaceId, staffId: (staffId as string | null) ?? null, role: role as string | null, objetivos, sitioOficial: usaFotosDeSitioOficial(fila?.config_extra) }
}

type Contexto = Exclude<Awaited<ReturnType<typeof contexto>>, { error: string }>

function enBanco(o: ObjetivoFoto): boolean {
  return o.tipo === 'ciudad' && fotosDeCiudad(o.nombre).length > 0
}

async function panel(ctx: Contexto, aviso?: string): Promise<PanelFotos> {
  // Saber si la tabla existe: sin la migración, el panel lo dice en vez de fallar en silencio.
  const { error: sinMigracion } = await ctx.db.from(TABLA_CATALOGO).select('id').limit(1)
  if (sinMigracion) return { ok: false, error: MENSAJE_SIN_TABLA }
  const filas = await leerCatalogo(ctx.db, ctx.workspaceId, { objetivos: ctx.objetivos })
  const fotos = await Promise.all(
    ctx.objetivos.map(async (o): Promise<FotoDelPanel> => {
      const f = filaDe(filas, o)
      return {
        tipo: o.tipo,
        clave: o.clave,
        nombre: o.nombre,
        ciudad: o.ciudad,
        enBanco: enBanco(o),
        sugerible: seSugiereDeCommons(o.tipo),
        total: fotosDe(filas, o).length,
        foto: f
          ? {
              id: f.id,
              seImprime: fotoImprimible(o.tipo, f.origen, f.revisada, { sitioOficial: ctx.sitioOficial }),
              url: await enlaceDeCatalogo(ctx.workspaceId, f.ref),
              origen: f.origen,
              credito: creditoDeFila(f),
              fuente: f.fuente_url,
              revisada: f.revisada,
            }
          : null,
      }
    }),
  )
  const editable = !(ctx.role && ROLES_SIN_ESCRITURA.has(ctx.role))
  return { ok: true, fotos, editable, sitioOficial: ctx.sitioOficial, ...(aviso ? { aviso } : {}) }
}

function objetivoPedido(ctx: Contexto, tipo: TipoFoto, clave: string): ObjetivoFoto | null {
  return ctx.objetivos.find((o) => o.tipo === tipo && o.clave === clave) ?? null
}

/** Las fotos que necesita la propuesta de esta cotización, con la que tiene cada una. */
export async function fotosDeLaPropuesta(cotizacionId: string): Promise<PanelFotos> {
  const ctx = await contexto(cotizacionId, false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  return panel(ctx)
}

/**
 * Busca en Wikimedia Commons una foto para cada ciudad y actividad que no la tenga. Las ciudades
 * del banco de ONE no se buscan, y los hoteles NUNCA (su foto la sube la asesora). Quedan sin
 * revisar: la asesora las ve y las cambia.
 */
export async function sugerirFotosQueFaltan(cotizacionId: string): Promise<PanelFotos> {
  const ctx = await contexto(cotizacionId, true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const { error: sinMigracion } = await ctx.db.from(TABLA_CATALOGO).select('id').limit(1)
  if (sinMigracion) return { ok: false, error: MENSAJE_SIN_TABLA }
  const filas = await leerCatalogo(ctx.db, ctx.workspaceId, { objetivos: ctx.objetivos })
  // Los hoteles no: su foto la sube la asesora.
  const faltan = ctx.objetivos.filter((o) => seSugiereDeCommons(o.tipo) && !filaDe(filas, o) && !enBanco(o)).slice(0, TOPE_SUGERENCIAS)
  let sinFoto = 0
  // Una por una: Commons pide no lanzar búsquedas en paralelo.
  for (const o of faltan) {
    const r = await sugerirDesdeCommons({ supabase: ctx.db, workspaceId: ctx.workspaceId, staffId: ctx.staffId, objetivo: o })
    if (!r.ok) sinFoto += 1
  }
  const aviso = sinFoto > 0
    ? `${sinFoto} ${sinFoto === 1 ? 'no tiene' : 'no tienen'} foto con licencia libre en Wikimedia Commons: sube la tuya o quedan con el degradado.`
    : undefined
  return panel(ctx, aviso)
}

/** «Otra foto»: descarta la de Commons que tiene y busca la siguiente. */
export async function otraFotoDeCommons(cotizacionId: string, tipo: TipoFoto, clave: string): Promise<PanelFotos> {
  const ctx = await contexto(cotizacionId, true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const o = objetivoPedido(ctx, tipo, clave)
  if (!o) return { ok: false, error: 'Esa foto no es de esta cotización. Recarga.' }
  if (!seSugiereDeCommons(o.tipo)) return { ok: false, error: MENSAJE_HOTEL_SIN_COMMONS }
  const filas = await leerCatalogo(ctx.db, ctx.workspaceId, { objetivos: [o] })
  const actual = filaDe(filas, o)
  const descartadas = [...(actual?.descartadas ?? []), ...(actual?.titulo_fuente ? [actual.titulo_fuente] : [])]
  const r = await sugerirDesdeCommons({ supabase: ctx.db, workspaceId: ctx.workspaceId, staffId: ctx.staffId, objetivo: o, descartadas })
  return panel(ctx, r.ok ? undefined : r.mensaje)
}

/** La foto propia de la asesora (JPEG ya comprimido en el navegador). */
export async function subirFotoPropia(cotizacionId: string, tipo: TipoFoto, clave: string, dataUrl: string): Promise<PanelFotos> {
  const ctx = await contexto(cotizacionId, true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const o = objetivoPedido(ctx, tipo, clave)
  if (!o) return { ok: false, error: 'Esa foto no es de esta cotización. Recarga.' }
  const partes = typeof dataUrl === 'string' ? bytesDeDataUrl(dataUrl) : null
  if (!partes || !/^image\/(jpeg|png|webp)$/.test(partes.mime)) return { ok: false, error: 'Ese archivo no es una foto. Usa un JPG o un PNG.' }
  const filas = await leerCatalogo(ctx.db, ctx.workspaceId, { objetivos: [o] })
  const actual = filaDe(filas, o)
  const r = await ponerFotoPropia({
    supabase: ctx.db, workspaceId: ctx.workspaceId, staffId: ctx.staffId, objetivo: o, bytes: partes.buffer,
    descartadas: [...(actual?.descartadas ?? []), ...(actual?.titulo_fuente ? [actual.titulo_fuente] : [])],
  })
  if (!r.ok) return { ok: false, error: r.mensaje }
  return panel(ctx)
}

/** «Esta está bien»: la sugerida queda revisada. */
export async function confirmarFotoDelCatalogo(cotizacionId: string, tipo: TipoFoto, clave: string): Promise<PanelFotos> {
  const ctx = await contexto(cotizacionId, true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  if (!objetivoPedido(ctx, tipo, clave)) return { ok: false, error: 'Esa foto no es de esta cotización. Recarga.' }
  if (!seSugiereDeCommons(tipo)) return { ok: false, error: MENSAJE_HOTEL_SIN_COMMONS }
  const r = await confirmarFoto(ctx.db, ctx.workspaceId, ctx.staffId, { tipo, clave })
  if (!r.ok) return { ok: false, error: r.mensaje ?? 'No se pudo confirmar la foto.' }
  return panel(ctx)
}

/** Quita la foto del catálogo: la propuesta vuelve al degradado (o al banco, en una ciudad). */
export async function quitarFotoDelCatalogo(cotizacionId: string, tipo: TipoFoto, clave: string): Promise<PanelFotos> {
  const ctx = await contexto(cotizacionId, true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  if (!objetivoPedido(ctx, tipo, clave)) return { ok: false, error: 'Esa foto no es de esta cotización. Recarga.' }
  const r = await quitarFoto(ctx.db, ctx.workspaceId, { tipo, clave })
  if (!r.ok) return { ok: false, error: r.mensaje ?? 'No se pudo quitar la foto.' }
  return panel(ctx)
}
