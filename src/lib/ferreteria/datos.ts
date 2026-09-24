import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { traerTodo } from '@/lib/supabase/paginar'
import { calcularIndicadores, type Indicadores } from './indicadores'
import { liquidacionMensual, porCobrar, type MesLiquidacion } from './liquidacion'
import { costoVigente, gananciaPorVenta, margenPorVenta, PASOS_VENTA, type PasoVenta } from './reglas'
import type {
  ConversacionFila,
  CostoFila,
  EventoFila,
  MedicionFila,
  ProductoFila,
  PublicacionFila,
  VentaFila,
} from './tipos'

/**
 * Lecturas de la pantalla Ferretería. Van con el cliente de la SESIÓN (RLS por workspace, grant
 * de solo lectura) y además se acotan por `workspace_id` a mano. Las mediciones crecen ~60 filas
 * por día: se leen con `traerTodo`, que o trae todo o lanza (el techo de 1.000 filas de
 * PostgREST no avisa).
 */

type Db = SupabaseClient

function lanzar(ctx: string, e: { message: string } | null) {
  if (e) throw new Error(`[ferreteria] ${ctx}: ${e.message}`)
}

const num = (v: unknown): number | null => (v == null ? null : Number(v))

export interface FilaTablero {
  id: string
  codigo: string
  sku: string
  producto: string
  marca: string | null
  precio: number | null
  ganancia: number | null
  /** Ganancia por venta / precio (fracción). `null` sin precio o sin costo. */
  margen: number | null
  costoF: number | null
  /** Primera foto del producto (miniatura de la fila). */
  foto: string | null
  estado: PublicacionFila['estado']
  linea: PublicacionFila['linea']
  link: string | null
  clics: number | null
  conversaciones: number
  diasDesdeUltimoClic: number | null
  pendiente_en_canal: boolean
  pendiente_desde: string | null
  intentos_fallidos: number
  ultimo_error_canal: string | null
}

export interface Tablero {
  filas: FilaTablero[]
  indicadores: Indicadores
  marcas: string[]
}

export async function leerTablero(db: Db, ws: string, hoy: string): Promise<Tablero> {
  const [pubsR, prodsR, costosR, convs, ventasR, meds] = await Promise.all([
    db.from('ferreteria_publicaciones').select('*').eq('workspace_id', ws).order('codigo'),
    db.from('ferreteria_productos').select('id, sku, nombre, marca, fotos').eq('workspace_id', ws),
    db.from('ferreteria_costos').select('producto_id, fecha_lista, costo_f, costo_d').eq('workspace_id', ws),
    traerTodo<{ publicacion_id: string; resultado: string }>(
      (desde, hasta) =>
        db.from('ferreteria_conversaciones').select('publicacion_id, resultado').eq('workspace_id', ws).order('id').range(desde, hasta),
      { etiqueta: 'ferreteria_conversaciones' },
    ),
    db.from('ferreteria_ventas').select('publicacion_id, ganancia').eq('workspace_id', ws),
    traerTodo<{ publicacion_id: string; fecha: string; clics_acumulados: number }>(
      (desde, hasta) =>
        db
          .from('ferreteria_mediciones')
          .select('publicacion_id, fecha, clics_acumulados')
          .eq('workspace_id', ws)
          .order('id')
          .range(desde, hasta),
      { etiqueta: 'ferreteria_mediciones' },
    ),
  ])
  lanzar('publicaciones', pubsR.error)
  lanzar('productos', prodsR.error)
  lanzar('costos', costosR.error)
  lanzar('ventas', ventasR.error)

  const pubs = ((pubsR.data ?? []) as PublicacionFila[]).map((p) => ({ ...p, precio: num(p.precio) }))
  const productos = new Map(((prodsR.data ?? []) as Pick<ProductoFila, 'id' | 'sku' | 'nombre' | 'marca' | 'fotos'>[]).map((p) => [p.id, p]))
  const costosPorProducto = new Map<string, { fecha_lista: string; costo_f: number; costo_d: number | null }[]>()
  for (const c of (costosR.data ?? []) as CostoFila[]) {
    const l = costosPorProducto.get(c.producto_id) ?? []
    l.push({ fecha_lista: c.fecha_lista, costo_f: Number(c.costo_f), costo_d: num(c.costo_d) })
    costosPorProducto.set(c.producto_id, l)
  }
  const ventas = ((ventasR.data ?? []) as { publicacion_id: string; ganancia: number }[]).map((v) => ({ ...v, ganancia: Number(v.ganancia) }))

  const indicadores = calcularIndicadores(
    pubs.map((p) => ({ id: p.id, codigo: p.codigo, precio: p.precio, linea: p.linea, estado: p.estado })),
    meds.map((m) => ({ ...m, clics_acumulados: Number(m.clics_acumulados) })),
    convs,
    ventas,
    hoy,
  )

  const filas: FilaTablero[] = pubs.map((p) => {
    const prod = productos.get(p.producto_id)
    const costo = costoVigente(costosPorProducto.get(p.producto_id) ?? [])
    const m = indicadores.porPublicacion[p.id]
    const ganancia = p.precio != null && costo ? gananciaPorVenta(p.precio, costo.costo_f) : null
    const fotos = Array.isArray(prod?.fotos) ? prod.fotos : []
    return {
      id: p.id,
      codigo: p.codigo,
      sku: prod?.sku ?? '',
      producto: prod?.nombre ?? '',
      marca: prod?.marca ?? null,
      precio: p.precio,
      costoF: costo?.costo_f ?? null,
      ganancia,
      margen: margenPorVenta(ganancia, p.precio),
      foto: typeof fotos[0] === 'string' ? fotos[0] : null,
      estado: p.estado,
      linea: p.linea,
      link: p.link,
      clics: m.clics,
      conversaciones: m.conversaciones,
      diasDesdeUltimoClic: m.diasDesdeUltimoClic,
      pendiente_en_canal: p.pendiente_en_canal,
      pendiente_desde: p.pendiente_desde,
      intentos_fallidos: p.intentos_fallidos,
      ultimo_error_canal: p.ultimo_error_canal,
    }
  })

  const marcas = [...new Set(filas.map((f) => f.marca).filter((m): m is string => !!m))].sort()
  return { filas, indicadores, marcas }
}

/** Una venta con el estado REAL de su negocio en ONE (para ver si quedó atrasado). */
export type VentaDetalle = VentaFila & {
  id: string
  negocio: { id: string; codigo: string | null; paso: PasoVenta | null; abierto: boolean } | null
}

export interface Detalle {
  publicacion: PublicacionFila
  producto: ProductoFila
  costos: CostoFila[]
  eventos: EventoFila[]
  mediciones: MedicionFila[]
  conversaciones: (ConversacionFila & { id: string; created_at: string })[]
  ventas: VentaDetalle[]
}

/**
 * El negocio de cada venta: código, si sigue abierto y en qué paso está. Dos lecturas planas
 * (negocios y sus etapas) en vez de un embed por FK, cuyo nombre no es estable.
 */
async function negociosDeVentas(db: Db, ws: string, ids: string[]): Promise<Map<string, NonNullable<VentaDetalle['negocio']>>> {
  const out = new Map<string, NonNullable<VentaDetalle['negocio']>>()
  if (ids.length === 0) return out
  const { data: negs, error } = await db
    .from('negocios')
    .select('id, codigo, estado, etapa_actual_id')
    .eq('workspace_id', ws)
    .in('id', ids)
  lanzar('negocios de las ventas', error)
  const filas = (negs ?? []) as { id: string; codigo: string | null; estado: string | null; etapa_actual_id: string | null }[]
  const etapaIds = [...new Set(filas.map((n) => n.etapa_actual_id).filter((x): x is string => !!x))]
  const pasos = new Map<string, PasoVenta>()
  if (etapaIds.length > 0) {
    const { data: etapas, error: errE } = await db.from('etapas_negocio').select('id, config_extra').in('id', etapaIds)
    lanzar('etapas de las ventas', errE)
    for (const e of (etapas ?? []) as { id: string; config_extra: Record<string, unknown> | null }[]) {
      const paso = e.config_extra?.ferreteria_paso
      if (typeof paso === 'string' && (PASOS_VENTA as readonly string[]).includes(paso)) pasos.set(e.id, paso as PasoVenta)
    }
  }
  for (const n of filas) {
    out.set(n.id, {
      id: n.id,
      codigo: n.codigo,
      paso: n.etapa_actual_id ? (pasos.get(n.etapa_actual_id) ?? null) : null,
      abierto: n.estado === 'abierto',
    })
  }
  return out
}

export interface Liquidacion {
  /** Por mes del PAGO. Las ventas sin pagar no están aquí. */
  meses: MesLiquidacion[]
  /** Contra entrega aún sin pagar: fuera de toda liquidación. */
  porCobrar: { ventas: number; valor: number }
}

/**
 * Todas las ventas del espacio, para la liquidación mensual. Crecen sin techo: `traerTodo`.
 */
export async function leerLiquidacion(db: Db, ws: string, hoy: string): Promise<Liquidacion> {
  const ventas = await traerTodo<{ fecha_primer_pago: string | null; precio_final: number; costo_dia: number; ganancia: number }>(
    (desde, hasta) =>
      db
        .from('ferreteria_ventas')
        .select('fecha_primer_pago, precio_final, costo_dia, ganancia')
        .eq('workspace_id', ws)
        .order('id')
        .range(desde, hasta),
    { etiqueta: 'ferreteria_ventas (liquidación)' },
  )
  const filas = ventas.map((v) => ({ ...v, precio_final: Number(v.precio_final), costo_dia: Number(v.costo_dia), ganancia: Number(v.ganancia) }))
  return { meses: liquidacionMensual(filas, hoy), porCobrar: porCobrar(filas) }
}

export async function leerDetalle(db: Db, ws: string, codigo: string): Promise<Detalle | null> {
  const { data: pub, error } = await db
    .from('ferreteria_publicaciones')
    .select('*')
    .eq('workspace_id', ws)
    .eq('codigo', codigo)
    .maybeSingle()
  lanzar('publicación', error)
  if (!pub) return null
  const p = { ...(pub as PublicacionFila), precio: num((pub as PublicacionFila).precio) }

  const [prodR, costosR, eventosR, medsR, convsR, ventasR] = await Promise.all([
    db.from('ferreteria_productos').select('*').eq('workspace_id', ws).eq('id', p.producto_id).single(),
    db.from('ferreteria_costos').select('*').eq('workspace_id', ws).eq('producto_id', p.producto_id).order('fecha_lista', { ascending: false }),
    db.from('ferreteria_eventos').select('*').eq('workspace_id', ws).eq('publicacion_id', p.id).order('created_at', { ascending: false }).limit(500),
    db.from('ferreteria_mediciones').select('*').eq('workspace_id', ws).eq('publicacion_id', p.id).order('fecha', { ascending: false }).limit(400),
    db.from('ferreteria_conversaciones').select('*').eq('workspace_id', ws).eq('publicacion_id', p.id).order('fecha', { ascending: false }).limit(500),
    db.from('ferreteria_ventas').select('*').eq('workspace_id', ws).eq('publicacion_id', p.id).order('fecha_venta', { ascending: false }),
  ])
  lanzar('producto', prodR.error)
  lanzar('costos', costosR.error)
  lanzar('eventos', eventosR.error)
  lanzar('mediciones', medsR.error)
  lanzar('conversaciones', convsR.error)
  lanzar('ventas', ventasR.error)

  const ventasCrudas = ((ventasR.data ?? []) as (VentaFila & { id: string })[]).map((v) => ({
    ...v,
    precio_final: Number(v.precio_final),
    costo_dia: Number(v.costo_dia),
    ganancia: Number(v.ganancia),
  }))
  const negocios = await negociosDeVentas(db, ws, ventasCrudas.map((v) => v.negocio_id).filter((x): x is string => !!x))

  return {
    publicacion: p,
    producto: prodR.data as ProductoFila,
    costos: ((costosR.data ?? []) as CostoFila[]).map((c) => ({ ...c, costo_f: Number(c.costo_f), costo_d: num(c.costo_d) })),
    eventos: (eventosR.data ?? []) as EventoFila[],
    mediciones: (medsR.data ?? []) as MedicionFila[],
    conversaciones: (convsR.data ?? []) as Detalle['conversaciones'],
    ventas: ventasCrudas.map((v) => ({ ...v, negocio: v.negocio_id ? (negocios.get(v.negocio_id) ?? null) : null })),
  }
}
