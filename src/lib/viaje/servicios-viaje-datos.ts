/**
 * Servicios del viaje contra la base (F0): crear las filas desde la cotización aceptada, leer las
 * del negocio y soltar las de una aceptación que se corrige.
 *
 * No es `'use server'` a propósito: estas funciones reciben el cliente y el workspace de quien
 * llama (que ya pasó su guarda); exportadas desde un archivo de acciones serían endpoints sin
 * control (ver `lib/actions/modulos-server-only.test.ts`).
 *
 * Todo detrás de `lineas_negocio.config_extra.servicios_viaje.activo`: con el interruptor
 * apagado, aceptar una cotización hace lo de siempre y no se escribe ninguna fila (F0-7).
 */

import { contextoDeCotizacion, leerItinerarios } from '@/lib/cotizaciones/itinerarios-datos'
import { filasDeServicioDeTarifa, type FilaServicioNueva } from './servicios-desde-tarifa'
import { serviciosViajeActivo, type EstadoEscrito } from './estado-servicio'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export const MENSAJE_SERVICIOS_CON_PAGOS =
  'Esta cotización ya tiene pagos a proveedores registrados en sus servicios. No se puede corregir: duplícala para cambiarla.'

export type ResultadoGeneracion =
  | { ok: true; creadas: number; existentes: number; apagado?: false }
  | { ok: true; creadas: 0; existentes: 0; apagado: true }
  | { ok: false; error: string }

/** El interruptor de la línea del negocio. Si no se puede leer, apagado (lo de siempre). */
export async function serviciosActivosDelNegocio(db: Db, negocioId: string): Promise<boolean> {
  const { data, error } = await db
    .from('negocios')
    .select('linea_id, lineas_negocio(config_extra)')
    .eq('id', negocioId)
    .maybeSingle()
  if (error || !data) return false
  const linea = (data as { lineas_negocio?: unknown }).lineas_negocio
  const fila = Array.isArray(linea) ? linea[0] : linea
  return serviciosViajeActivo((fila as { config_extra?: unknown } | null)?.config_extra)
}

/**
 * Crea las filas de servicio de la cotización aceptada del negocio. Idempotente (F0-3): un ítem
 * ya convertido en fila no se vuelve a insertar, y si dos llamadas se cruzan, el índice único
 * `(negocio_id, item_id)` frena la segunda y aquí se cuenta como ya existente.
 *
 * Nunca lanza: quien la llama justo después de aceptar NO deshace la aceptación si esto falla
 * (F0-4); la fila se trae después con «Traer los servicios de la cotización aceptada».
 */
export async function generarServiciosDesdeTarifa(
  db: Db,
  args: { workspaceId: string; negocioId: string; cotizacionId: string; staffId?: string | null },
): Promise<ResultadoGeneracion> {
  try {
    if (!(await serviciosActivosDelNegocio(db, args.negocioId))) {
      return { ok: true, creadas: 0, existentes: 0, apagado: true }
    }

    const { data: cot, error: cotErr } = await db
      .from('cotizaciones')
      .select('*')
      .eq('id', args.cotizacionId)
      .eq('workspace_id', args.workspaceId)
      .maybeSingle()
    if (cotErr) return { ok: false, error: cotErr.message }
    const c = cot as { estado?: string | null; negocio_id?: string | null; tarifa_aceptada_id?: string | null } | null
    if (!c || c.negocio_id !== args.negocioId) return { ok: false, error: 'Cotización no encontrada en este negocio' }
    if (c.estado !== 'aceptada') return { ok: false, error: 'La cotización todavía no está aceptada' }

    const ctx = await contextoDeCotizacion(db, args.cotizacionId)
    if (!ctx) return { ok: false, error: 'Cotización no encontrada' }

    let seleccion: string[] | null = null
    let itinerarioId: string | null = null
    if (c.tarifa_aceptada_id) {
      const filas = await leerItinerarios(db, args.cotizacionId)
      const tarifa = filas?.find(f => f.id === c.tarifa_aceptada_id) ?? null
      if (!tarifa) return { ok: false, error: 'No se encontró la tarifa aceptada' }
      seleccion = tarifa.seleccion
      itinerarioId = tarifa.id
    }

    const tipoRanuraPorItem = await tiposDeRanura(db, args.cotizacionId)
    const nuevas = filasDeServicioDeTarifa({ items: ctx.items, seleccion, params: ctx.params, tipoRanuraPorItem })

    const { data: existentesRows, error: exErr } = await db
      .from('negocio_servicios')
      .select('item_id')
      .eq('negocio_id', args.negocioId)
      .not('item_id', 'is', null)
    if (exErr) return { ok: false, error: exErr.message }
    const yaEstan = new Set(((existentesRows ?? []) as Array<{ item_id: string }>).map(r => r.item_id))
    const faltan = nuevas.filter(f => !yaEstan.has(f.item_id))
    const existentes = nuevas.length - faltan.length
    if (faltan.length === 0) return { ok: true, creadas: 0, existentes }

    const filas = faltan.map(f => aFila(f, args, itinerarioId))
    const { error: insErr } = await db.from('negocio_servicios').insert(filas)
    if (!insErr) return { ok: true, creadas: filas.length, existentes }
    if (!esChoqueDeUnico(insErr)) return { ok: false, error: insErr.message }

    // Otra llamada insertó algunas entre la lectura y la escritura: una por una, y la que
    // choca ya existe. Es la ruta rara; la normal es un solo insert.
    let creadas = 0
    let chocaron = 0
    for (const fila of filas) {
      const { error } = await db.from('negocio_servicios').insert(fila)
      if (!error) creadas++
      else if (esChoqueDeUnico(error)) chocaron++
      else return { ok: false, error: error.message }
    }
    return { ok: true, creadas, existentes: existentes + chocaron }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function esChoqueDeUnico(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === '23505'
}

function aFila(
  f: FilaServicioNueva,
  args: { workspaceId: string; negocioId: string; cotizacionId: string; staffId?: string | null },
  itinerarioId: string | null,
) {
  return {
    workspace_id: args.workspaceId,
    negocio_id: args.negocioId,
    cotizacion_id: args.cotizacionId,
    itinerario_id: itinerarioId,
    item_id: f.item_id,
    tipo: f.tipo,
    nombre: f.nombre,
    proveedor_nombre: f.proveedor_nombre,
    fecha_servicio: f.fecha_servicio,
    costo_cotizado: f.costo_cotizado,
    orden: f.orden,
    origen: 'cotizacion',
    estado: 'por_reservar',
    created_by: args.staffId ?? null,
  }
}

/** El tipo de la ranura de cada ítem (`items.ranura_id` → `cotizacion_ranuras.tipo`). */
async function tiposDeRanura(db: Db, cotizacionId: string): Promise<Record<string, string | null>> {
  const [itemsRes, ranurasRes] = await Promise.all([
    db.from('items').select('id, ranura_id').eq('cotizacion_id', cotizacionId),
    db.from('cotizacion_ranuras').select('id, tipo').eq('cotizacion_id', cotizacionId),
  ])
  // Sin la columna o sin la tabla, el tipo sale del grupo: no se frena por esto.
  if (itemsRes.error || ranurasRes.error) return {}
  const tipoPorRanura = new Map(
    ((ranurasRes.data ?? []) as Array<{ id: string; tipo: string | null }>).map(r => [r.id, r.tipo]),
  )
  const salida: Record<string, string | null> = {}
  for (const it of (itemsRes.data ?? []) as Array<{ id: string; ranura_id: string | null }>) {
    salida[it.id] = it.ranura_id ? tipoPorRanura.get(it.ranura_id) ?? null : null
  }
  return salida
}

// ── Lectura para el bloque ───────────────────────────────────────────────────

export interface ServicioDelNegocio {
  id: string
  tipo: string
  nombre: string
  proveedor_nombre: string | null
  localizador: string | null
  estado: EstadoEscrito
  fecha_servicio: string | null
  fecha_limite_pago: string | null
  costo_cotizado: number
  valor_por_pagar: number | null
  voucher_ref: string | null
  confirmacion_ref: string | null
  orden: number
  origen: 'cotizacion' | 'manual'
  gastos: Array<{ monto: number; soporte_url: string | null; medio_pago: string | null; titular_medio: string | null }>
  aprobaciones: Array<{ estado: 'solicitada' | 'aprobada' | 'rechazada' | 'caducada' }>
}

/** Las filas del negocio en el orden del viaje, con lo pagado y las aprobaciones de cada una. */
export async function leerServiciosDelNegocio(
  db: Db,
  args: { workspaceId: string; negocioId: string },
): Promise<ServicioDelNegocio[] | null> {
  const { data, error } = await db
    .from('negocio_servicios')
    .select('id, tipo, nombre, proveedor_nombre, localizador, estado, fecha_servicio, fecha_limite_pago, costo_cotizado, valor_por_pagar, voucher_ref, confirmacion_ref, orden, origen')
    .eq('workspace_id', args.workspaceId)
    .eq('negocio_id', args.negocioId)
    .order('orden', { ascending: true })
  if (error) {
    console.error('[servicios-viaje] no se pudieron leer:', error.message)
    return null
  }
  const filas = (data ?? []) as Array<Omit<ServicioDelNegocio, 'gastos' | 'aprobaciones'>>
  if (filas.length === 0) return []
  const ids = filas.map(f => f.id)
  const [gastosRes, aprobRes] = await Promise.all([
    db.from('gastos').select('servicio_id, monto, soporte_url, medio_pago, titular_medio').in('servicio_id', ids),
    db.from('aprobaciones_excepcion').select('entidad_id, estado').eq('entidad_tipo', 'servicio').in('entidad_id', ids),
  ])
  const gastos = (gastosRes.data ?? []) as Array<ServicioDelNegocio['gastos'][number] & { servicio_id: string }>
  const aprob = (aprobRes.data ?? []) as Array<{ entidad_id: string; estado: ServicioDelNegocio['aprobaciones'][number]['estado'] }>
  return filas.map(f => ({
    ...f,
    costo_cotizado: Number(f.costo_cotizado) || 0,
    valor_por_pagar: f.valor_por_pagar === null ? null : Number(f.valor_por_pagar),
    gastos: gastos.filter(g => g.servicio_id === f.id).map(g => ({
      monto: Number(g.monto) || 0,
      soporte_url: g.soporte_url,
      medio_pago: g.medio_pago,
      titular_medio: g.titular_medio,
    })),
    aprobaciones: aprob.filter(a => a.entidad_id === f.id).map(a => ({ estado: a.estado })),
  }))
}

// ── Corregir una aceptación ──────────────────────────────────────────────────

/**
 * Antes de soltar una aceptación (`corregirCotizacionAceptada`): borra las filas de servicio
 * nacidas de la cotización que no tienen pagos y se niega, sin tocar nada, si alguna los tiene (F0-5). Ya salió plata a
 * un proveedor: la salida es duplicar la cotización, igual que con los cobros confirmados.
 *
 * Se mira siempre, no solo con el interruptor encendido: una línea que lo apagó después puede
 * tener filas con pagos, y esos no se pueden dejar colgando de una cotización que cambia.
 */
export async function soltarServiciosDeAceptacion(
  db: Db,
  args: { workspaceId: string; negocioId: string },
): Promise<{ ok: true; borradas: number } | { ok: false; error: string }> {
  // Solo las que nacieron de la cotización: una fila agregada a mano no depende de ella.
  const { data, error } = await db
    .from('negocio_servicios')
    .select('id')
    .eq('workspace_id', args.workspaceId)
    .eq('negocio_id', args.negocioId)
    .eq('origen', 'cotizacion')
  if (error) {
    // Sin la tabla (migración sin aplicar) no hay nada que soltar.
    if (error.code === '42P01' || error.code === 'PGRST205') return { ok: true, borradas: 0 }
    return { ok: false, error: 'No se pudieron leer los servicios del viaje' }
  }
  const ids = ((data ?? []) as Array<{ id: string }>).map(r => r.id)
  if (ids.length === 0) return { ok: true, borradas: 0 }

  const { data: pagos, error: pagosErr } = await db
    .from('gastos')
    .select('id')
    .in('servicio_id', ids)
    .limit(1)
  // Si los pagos no se pudieron leer, NO se asume que no hay: la duda frena.
  if (pagosErr) return { ok: false, error: 'No se pudieron leer los pagos a proveedores' }
  if ((pagos ?? []).length > 0) return { ok: false, error: MENSAJE_SERVICIOS_CON_PAGOS }

  const { error: delErr } = await db
    .from('negocio_servicios')
    .delete()
    .eq('workspace_id', args.workspaceId)
    .in('id', ids)
  if (delErr) return { ok: false, error: delErr.message }
  return { ok: true, borradas: ids.length }
}
