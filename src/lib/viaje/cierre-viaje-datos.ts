import 'server-only'

/**
 * En viaje, Cierre económico y Postventa contra la base (F6). No es `'use server'`: recibe el
 * cliente y el workspace de quien llama, que ya pasó su guarda.
 */

import { esColumnaFaltante, monedaDelServicioConRespaldo } from './moneda-servicio'
import { cobradoConfirmado } from '@/lib/cobros/saldo-negocio'
import { mensajeSaldoCero } from '@/lib/cobros/saldo-cero'
import { leerSaldoCero } from '@/lib/cobros/saldo-cero-datos'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { ivaSobreIngresoPropio, leerConfigIvaCotizacion } from '@/lib/fiscal/iva-cotizacion'
import { ivaDeLaCotizacion } from '@/lib/fiscal/iva-cotizacion-datos'
import { cobrosDelNegocio, leerNegocioConLinea } from './confirmacion-datos'
import {
  GATE_MARGEN_CONFIRMADO,
  GATE_POSTVENTA,
  calcularCierre,
  configCierreViaje,
  configEtapasPorFecha,
  faltaParaCerrar,
  faltaPostventa,
  leerCierreGuardado,
  leerPostventa,
  textoEnViaje,
  type Cierre,
  type CierreGuardado,
  type GastoCierre,
  type Postventa,
  type ServicioCierre,
} from './cierre-viaje'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

interface Base {
  negocio: { id: string; nombre: string | null; metadata: Record<string, unknown> | null; precio_aprobado: number | null; contacto_id: string | null; etapa_actual_id: string | null; linea_id: string | null }
  configLinea: Record<string, unknown>
}

/** Los gastos del negocio (costo real): cada uno una vez (§7.2.2). */
export async function gastosDelNegocio(db: Db, workspaceId: string, negocioId: string): Promise<GastoCierre[]> {
  const leer = (columnas: string) => db
    .from('gastos')
    .select(columnas)
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
  const BASE = 'monto, servicio_id, categoria, descripcion, titular_medio'
  // QA G9 · la moneda y la TRM del pago; sin la migración, como antes (la TRM sale del texto).
  let { data, error } = await leer(`${BASE}, moneda, tasa_cambio`)
  if (esColumnaFaltante(error)) ({ data, error } = await leer(BASE))
  if (error) throw new Error(`No se pudieron leer los gastos: ${error.message}`)
  return ((data ?? []) as GastoCierre[]).map(g => ({ ...g, monto: Number(g.monto) || 0, servicio_id: g.servicio_id ?? null }))
}

async function serviciosDelCierre(db: Db, workspaceId: string, negocioId: string): Promise<ServicioCierre[]> {
  const leer = (columnas: string) => db
    .from('negocio_servicios')
    .select(columnas)
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .order('orden', { ascending: true })
  const BASE = 'id, nombre, proveedor_nombre, estado, costo_cotizado, valor_por_pagar, comision_esperada, comision_estado, orden, item_id'
  // QA G9 · la moneda en sus columnas; sin la migración, del ítem (#1364).
  let { data, error } = await leer(`${BASE}, moneda, costo_moneda, tasa_cotizada`)
  if (esColumnaFaltante(error)) ({ data, error } = await leer(BASE))
  if (error) throw new Error(`No se pudieron leer los servicios: ${error.message}`)
  const filas = (data ?? []) as Array<Omit<ServicioCierre, 'moneda'> & { item_id?: string | null; moneda?: unknown; costo_moneda?: unknown; tasa_cotizada?: unknown }>
  const itemDe = await itemsDeLosServicios(db, filas)
  return filas.map(s => ({
    ...s,
    // H6-3 · la moneda en que se cotizó, para separar la diferencia de cambio en la explicación.
    moneda: monedaDelServicioConRespaldo(s, s.item_id ? itemDe.get(s.item_id) : null, Number(s.costo_cotizado) || 0),
    costo_cotizado: Number(s.costo_cotizado) || 0,
    valor_por_pagar: s.valor_por_pagar === null || s.valor_por_pagar === undefined ? null : Number(s.valor_por_pagar),
    comision_esperada: s.comision_esperada === null || s.comision_esperada === undefined ? null : Number(s.comision_esperada),
    comision_estado: s.comision_estado ?? null,
  }))
}

/** `tarifa_pax` y `subtotal` de los ítems de los servicios. Si no se pueden leer, ninguno (todo en pesos). */
async function itemsDeLosServicios(db: Db, filas: ReadonlyArray<{ item_id?: string | null }>): Promise<Map<string, { tarifa_pax: unknown; subtotal: number | null }>> {
  const ids = [...new Set(filas.map(f => f.item_id).filter((x): x is string => !!x))]
  if (ids.length === 0) return new Map()
  try {
    const { data, error } = await db.from('items').select('id, tarifa_pax, subtotal').in('id', ids)
    if (error || !Array.isArray(data)) return new Map()
    return new Map((data as Array<{ id: string; tarifa_pax: unknown; subtotal: number | null }>).map(i => [i.id, { tarifa_pax: i.tarifa_pax, subtotal: i.subtotal }]))
  } catch {
    return new Map()
  }
}

/**
 * El IVA sobre el ingreso propio de la tarifa que el cliente compró (C8). Solo en el workspace que
 * cotiza así; si no, 0 (la línea no cobra IVA del ingreso propio).
 */
async function ivaDeLaVenta(db: Db, workspaceId: string, negocioId: string): Promise<number> {
  const { data: ws } = await db.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle()
  const config = leerConfigIvaCotizacion((ws as { config_extra?: unknown } | null)?.config_extra)
  if (!ivaSobreIngresoPropio(config)) return 0
  const { data: cots } = await db
    .from('cotizaciones')
    .select('id, tarifa_aceptada_id')
    .eq('negocio_id', negocioId)
    .eq('estado', 'aceptada')
    .order('created_at', { ascending: false })
    .limit(1)
  const cot = ((cots ?? []) as Array<{ id: string; tarifa_aceptada_id: string | null }>)[0]
  if (!cot) return 0
  const iva = await ivaDeLaCotizacion(db, { workspaceId, cotizacionId: cot.id, config })
  if (!iva) return 0
  const deLaTarifa = cot.tarifa_aceptada_id ? iva.porTarifa.get(cot.tarifa_aceptada_id) : null
  return Math.round((deLaTarifa ?? iva.vigente).iva)
}

export async function calcularCierreDelNegocio(db: Db, workspaceId: string, base: Base): Promise<Cierre> {
  const negocioId = base.negocio.id
  const [servicios, gastos, cobros, iva] = await Promise.all([
    serviciosDelCierre(db, workspaceId, negocioId),
    gastosDelNegocio(db, workspaceId, negocioId),
    cobrosDelNegocio(db, workspaceId, negocioId),
    ivaDeLaVenta(db, workspaceId, negocioId),
  ])
  return calcularCierre({
    precioAprobado: Number(base.negocio.precio_aprobado ?? 0),
    cobrado: cobradoConfirmado(cobros),
    iva,
    // El recargo del pago por link todavía no se registra aparte en el riel (Vera F2-7): 0.
    recargo: 0,
    servicios,
    gastos,
  })
}

async function etapaActual(db: Db, etapaId: string | null): Promise<{ numero: number | null; gates: string[] }> {
  if (!etapaId) return { numero: null, gates: [] }
  const { data } = await db.from('etapas_negocio').select('numero, config_extra').eq('id', etapaId).maybeSingle()
  const e = data as { numero?: number; config_extra?: { gates?: unknown } } | null
  const gates = (Array.isArray(e?.config_extra?.gates) ? e?.config_extra?.gates : []) as unknown[]
  return { numero: typeof e?.numero === 'number' ? e.numero : null, gates: gates.filter((g): g is string => typeof g === 'string') }
}

export type FaseFinal = 'en_viaje' | 'cierre' | 'postventa'

export interface VistaViajeFinal {
  negocioId: string
  workspaceId: string
  fase: FaseFinal
  hoy: string
  cliente: { nombre: string; telefono: string | null }
  textoEnViaje: string | null
  cierre: Cierre
  guardado: CierreGuardado
  faltaCierre: string[]
  postventa: Postventa
  faltaPostventa: string | null
  servicios: Array<{ id: string; nombre: string }>
  /**
   * El saldo que frena `saldo_cero`, con la MISMA cuenta y la misma base de precio del gate
   * (`lib/cobros/saldo-cero.ts`): «Saldo pendiente: $X». `null` si está cubierto. Solo en Cierre.
   */
  saldoPendiente: string | null
}

/** `null` con el interruptor apagado o fuera de las etapas 7-9 de la línea. */
export async function leerVistaViajeFinal(db: Db, workspaceId: string, negocioId: string): Promise<VistaViajeFinal | null> {
  const base = (await leerNegocioConLinea(db, workspaceId, negocioId)) as Base | null
  if (!base || !configCierreViaje(base.configLinea).activo) return null
  const etapa = await etapaActual(db, base.negocio.etapa_actual_id)
  const porFecha = configEtapasPorFecha(base.configLinea)
  const fase: FaseFinal | null = porFecha && etapa.numero === porFecha.entrar.etapa_numero
    ? 'en_viaje'
    : etapa.gates.includes(GATE_MARGEN_CONFIRMADO)
      ? 'cierre'
      : etapa.gates.includes(GATE_POSTVENTA)
        ? 'postventa'
        : null
  if (!fase) return null
  const hoy = todayBogotaISO()
  const [cierre, { viaje }, contactoRes, saldo] = await Promise.all([
    calcularCierreDelNegocio(db, workspaceId, base),
    leerViajeDelNegocio(db, negocioId),
    base.negocio.contacto_id
      ? db.from('contactos').select('nombre, telefono').eq('id', base.negocio.contacto_id).maybeSingle()
      : Promise.resolve({ data: null }),
    fase === 'cierre' ? leerSaldoCero(db, { workspaceId, negocioId }) : Promise.resolve(null),
  ])
  const contacto = (contactoRes.data ?? null) as { nombre?: string | null; telefono?: string | null } | null
  const nombre = (contacto?.nombre ?? '').trim()
  const saldoPendiente = !saldo ? null : saldo.ok ? mensajeSaldoCero(saldo.saldo) : saldo.error
  const guardado = leerCierreGuardado(base.negocio.metadata)
  const postventa = leerPostventa(base.negocio.metadata)
  return {
    negocioId,
    workspaceId,
    fase,
    hoy,
    cliente: { nombre, telefono: contacto?.telefono ?? null },
    textoEnViaje: textoEnViaje(viaje.fechas.inicio, viaje.fechas.fin, hoy),
    cierre,
    guardado,
    faltaCierre: faltaParaCerrar(cierre, guardado, nombre.split(/\s+/)[0] ?? ''),
    postventa,
    faltaPostventa: faltaPostventa(postventa),
    servicios: cierre.filas.map(f => ({ id: f.id, nombre: f.nombre })),
    saldoPendiente,
  }
}

/** Gate `margen_confirmado` (etapa de Cierre económico). Opt-in por etapa; apagado no frena. */
export async function evaluarGateCierre(db: Db, args: { workspaceId: string; negocioId: string; gates: readonly string[] }): Promise<string[]> {
  if (!args.gates.includes(GATE_MARGEN_CONFIRMADO)) return []
  const base = (await leerNegocioConLinea(db, args.workspaceId, args.negocioId)) as Base | null
  if (!base || !configCierreViaje(base.configLinea).activo) return []
  try {
    const cierre = await calcularCierreDelNegocio(db, args.workspaceId, base)
    const { data: c } = base.negocio.contacto_id
      ? await db.from('contactos').select('nombre').eq('id', base.negocio.contacto_id).maybeSingle()
      : { data: null }
    const nombre = ((c as { nombre?: string } | null)?.nombre ?? '').trim().split(/\s+/)[0] ?? ''
    return faltaParaCerrar(cierre, leerCierreGuardado(base.negocio.metadata), nombre)
  } catch (e) {
    // La duda frena: no se cierra un viaje sin saber cuánto dejó.
    return [`No se pudo calcular el cierre: ${e instanceof Error ? e.message : String(e)}`]
  }
}

/** Gate `postventa_completa` («Cerrar el negocio» de la etapa de Postventa). */
export async function evaluarGatePostventa(db: Db, args: { workspaceId: string; negocioId: string; gates: readonly string[] }): Promise<string | null> {
  if (!args.gates.includes(GATE_POSTVENTA)) return null
  const base = (await leerNegocioConLinea(db, args.workspaceId, args.negocioId)) as Base | null
  if (!base || !configCierreViaje(base.configLinea).activo) return null
  return faltaPostventa(leerPostventa(base.negocio.metadata))
}
