import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { traerTodo } from '@/lib/supabase/paginar'
import { calcularIndicadores, type Indicadores } from './indicadores'
import { costoVigente, gananciaPorVenta } from './reglas'
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
  costoF: number | null
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
    db.from('ferreteria_productos').select('id, sku, nombre, marca').eq('workspace_id', ws),
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
  const productos = new Map(((prodsR.data ?? []) as Pick<ProductoFila, 'id' | 'sku' | 'nombre' | 'marca'>[]).map((p) => [p.id, p]))
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
    return {
      id: p.id,
      codigo: p.codigo,
      sku: prod?.sku ?? '',
      producto: prod?.nombre ?? '',
      marca: prod?.marca ?? null,
      precio: p.precio,
      costoF: costo?.costo_f ?? null,
      ganancia: p.precio != null && costo ? gananciaPorVenta(p.precio, costo.costo_f) : null,
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

export interface Detalle {
  publicacion: PublicacionFila
  producto: ProductoFila
  costos: CostoFila[]
  eventos: EventoFila[]
  mediciones: MedicionFila[]
  conversaciones: (ConversacionFila & { id: string; created_at: string })[]
  ventas: VentaFila[]
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
    db.from('ferreteria_ventas').select('*').eq('workspace_id', ws).eq('publicacion_id', p.id).order('fecha_primer_pago', { ascending: false }),
  ])
  lanzar('producto', prodR.error)
  lanzar('costos', costosR.error)
  lanzar('eventos', eventosR.error)
  lanzar('mediciones', medsR.error)
  lanzar('conversaciones', convsR.error)
  lanzar('ventas', ventasR.error)

  return {
    publicacion: p,
    producto: prodR.data as ProductoFila,
    costos: ((costosR.data ?? []) as CostoFila[]).map((c) => ({ ...c, costo_f: Number(c.costo_f), costo_d: num(c.costo_d) })),
    eventos: (eventosR.data ?? []) as EventoFila[],
    mediciones: (medsR.data ?? []) as MedicionFila[],
    conversaciones: (convsR.data ?? []) as Detalle['conversaciones'],
    ventas: ((ventasR.data ?? []) as VentaFila[]).map((v) => ({ ...v, precio_final: Number(v.precio_final), costo_dia: Number(v.costo_dia), ganancia: Number(v.ganancia) })),
  }
}
