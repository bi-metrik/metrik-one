import 'server-only'

/**
 * Lee «Mis pendientes» y el tablero de margen (F6-8, F6-9) con el cliente de SESIÓN (RLS por
 * workspace). Solo líneas de viaje (`plan_pagos.activo` o `servicios_viaje.activo`): sin ninguna,
 * la pestaña no existe. Todo en tandas (`.in()` con cientos de uuid rompe PostgREST) y en paralelo:
 * abre en ≤ 2 s con 50 negocios abiertos (Vera F6-9).
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { configPlanPagos, normalizarCuotas } from './plan-pagos'
import { aprobadoresDeLinea, serviciosViajeActivo } from './estado-servicio'
import { leerCierreGuardado } from './cierre-viaje'
import { negociosDePruebaOcultos } from '@/lib/negocios/negocios-de-prueba'
import {
  loProximo,
  pendientesDe,
  tableroDeMargen,
  type AprobacionPendiente,
  type CierreTablero,
  type Pendiente,
  type Persona,
  type ServicioPendiente,
  type Tablero,
  type ViajePendiente,
} from './mis-pendientes'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const TANDA = 150
async function porTandas<T>(ids: string[], leer: (t: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  const tandas: string[][] = []
  for (let i = 0; i < ids.length; i += TANDA) tandas.push(ids.slice(i, i + TANDA))
  for (const r of await Promise.all(tandas.map(leer))) out.push(...r)
  return out
}
const filas = <T,>(r: { data: T[] | null }) => (r.data ?? []) as T[]
const fecha = (v: unknown): string | null => (typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(v.trim())?.[1] ?? null : null)

export type MisPendientes =
  | { activo: false }
  | { activo: true; hoy: string; persona: Persona; pendientes: Pendiente[]; proximo: { texto: string; fecha: string } | null; tablero: Tablero | null }

/** ¿El espacio tiene líneas de viaje? (para mostrar la pestaña sin cargar todo). */
export async function hayLineasDeViaje(): Promise<boolean> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!workspaceId) return false
  const { data } = await (supabase as Db).from('lineas_negocio').select('config_extra').eq('workspace_id', workspaceId)
  return ((data ?? []) as Array<{ config_extra: unknown }>).some(l => configPlanPagos(l.config_extra).activo || serviciosViajeActivo(l.config_extra))
}

export async function cargarMisPendientes(): Promise<MisPendientes> {
  const { supabase, workspaceId, staffId, role, areas } = await getWorkspace()
  if (!workspaceId) return { activo: false }
  const db = supabase as Db
  const lineas = filas<{ id: string; config_extra: unknown }>(await db.from('lineas_negocio').select('id, config_extra').eq('workspace_id', workspaceId))
    .filter(l => configPlanPagos(l.config_extra).activo || serviciosViajeActivo(l.config_extra))
  if (lineas.length === 0) return { activo: false }
  const lineaIds = lineas.map(l => l.id)
  const esDireccion = role === 'owner' || role === 'admin' || (!!staffId && lineas.some(l => aprobadoresDeLinea(l.config_extra).includes(staffId)))
  const persona: Persona = { staffId: staffId ?? null, esDireccion, areas: (areas ?? []) as string[] }
  const hoy = todayBogotaISO()

  const [negocios, etapas] = await Promise.all([
    porTandas(lineaIds, async t => filas<{ id: string; nombre: string; codigo: string | null; linea_id: string | null; contacto_id: string | null; etapa_actual_id: string | null; precio_aprobado: number | null; metadata: Record<string, unknown> | null }>(
      await db.from('negocios').select('id, nombre, codigo, linea_id, contacto_id, etapa_actual_id, precio_aprobado, metadata').eq('workspace_id', workspaceId).in('linea_id', t).eq('estado', 'abierto'),
    )),
    porTandas(lineaIds, async t => filas<{ id: string; numero: number; config_extra: { gates?: unknown } | null }>(
      await db.from('etapas_negocio').select('id, numero, config_extra').in('linea_id', t),
    )),
  ])
  const ids = negocios.map(n => n.id)
  const contactoIds = [...new Set(negocios.map(n => n.contacto_id).filter((x): x is string => !!x))]

  const [contactos, responsables, planes, cobros, servicios, aprob, bloques] = await Promise.all([
    porTandas(contactoIds, async t => filas<{ id: string; nombre: string | null }>(await db.from('contactos').select('id, nombre').in('id', t))),
    porTandas(ids, async t => filas<{ negocio_id: string; staff_id: string; rol: string | null }>(await db.from('negocio_responsables').select('negocio_id, staff_id, rol').in('negocio_id', t))),
    porTandas(ids, async t => filas<{ id: string; negocio_id: string }>(await db.from('negocio_planes_pago').select('id, negocio_id').in('negocio_id', t).eq('estado', 'acordado'))),
    porTandas(ids, async t => filas<{ negocio_id: string; monto: number | null; fecha: string | null; retencion_iva: number | null; anulado_at: string | null }>(
      await db.from('cobros').select('negocio_id, monto, fecha, retencion_iva, anulado_at').in('negocio_id', t),
    )),
    porTandas(ids, async t => filas<ServicioPendiente & { negocio_id: string }>(
      await db.from('negocio_servicios').select('id, negocio_id, nombre, proveedor_nombre, estado, costo_cotizado, valor_por_pagar, confirmacion_ref, fecha_limite_pago').in('negocio_id', t),
    )),
    porTandas(ids, async t => filas<AprobacionPendiente & { negocio_id: string; solicitada_por: string | null }>(
      await db.from('aprobaciones_excepcion').select('id, negocio_id, tipo, entidad_tipo, entidad_id, estado, motivo, detalle, solicitada_por, decidida_at').in('negocio_id', t).in('estado', ['solicitada', 'rechazada']),
    )),
    porTandas(ids, async t => filas<{ negocio_id: string; fecha_salida: unknown; fecha_regreso: unknown }>(
      await db.from('negocio_bloques').select('negocio_id, fecha_salida:data->fecha_salida, fecha_regreso:data->fecha_regreso').in('negocio_id', t),
    )),
  ])
  const servicioIds = servicios.map(s => s.id)
  const [cuotas, gastos, nombresStaff] = await Promise.all([
    porTandas(planes.map(p => p.id), async t => filas<{ plan_id: string; numero: number; monto: number; fecha_vencimiento: string }>(
      await db.from('negocio_plan_cuotas').select('plan_id, numero, monto, fecha_vencimiento').in('plan_id', t),
    )),
    porTandas(servicioIds, async t => filas<{ servicio_id: string; monto: number; soporte_url: string | null; medio_pago: string | null; titular_medio: string | null }>(
      await db.from('gastos').select('servicio_id, monto, soporte_url, medio_pago, titular_medio').in('servicio_id', t),
    )),
    porTandas([...new Set(aprob.map(a => a.solicitada_por).filter((x): x is string => !!x))], async t => filas<{ id: string; full_name: string | null }>(
      await db.from('staff').select('id, full_name').in('id', t),
    )),
  ])
  const nombreStaff = new Map(nombresStaff.map(s => [s.id, (s.full_name ?? '').trim().split(/\s+/)[0] || null]))
  const etapaDe = new Map(etapas.map(e => [e.id, e]))
  const contactoDe = new Map(contactos.map(c => [c.id, (c.nombre ?? '').trim()]))
  const planDe = new Map(planes.map(p => [p.negocio_id, p.id]))

  const viajes: ViajePendiente[] = negocios.map(n => {
    const e = n.etapa_actual_id ? etapaDe.get(n.etapa_actual_id) : undefined
    const gates = (Array.isArray(e?.config_extra?.gates) ? (e?.config_extra?.gates as unknown[]) : []).filter((g): g is string => typeof g === 'string')
    const resp = responsables.filter(r => r.negocio_id === n.id)
    const b = bloques.filter(x => x.negocio_id === n.id)
    const plan = planDe.get(n.id)
    const svs = servicios.filter(s => s.negocio_id === n.id)
    const aps = aprob.filter(a => a.negocio_id === n.id)
    return {
      id: n.id,
      nombre: n.codigo ? `${n.codigo} — ${n.nombre}` : n.nombre,
      cliente: (n.contacto_id ? contactoDe.get(n.contacto_id) : '') || n.nombre,
      etapaNumero: e?.numero ?? null,
      etapaGates: gates,
      esPrueba: (n.metadata as { es_prueba?: unknown } | null)?.es_prueba === true,
      salida: b.map(x => fecha(x.fecha_salida)).find(Boolean) ?? null,
      regreso: b.map(x => fecha(x.fecha_regreso)).find(Boolean) ?? null,
      precioAprobado: Number(n.precio_aprobado ?? 0),
      metadata: n.metadata,
      aprobadoresStaffIds: aprobadoresDeLinea(lineas.find(l => l.id === n.linea_id)?.config_extra),
      comercialStaffId: resp.find(r => r.rol === 'comercial')?.staff_id ?? null,
      operacionesStaffId: resp.find(r => r.rol === 'operaciones')?.staff_id ?? null,
      cuotas: plan
        ? normalizarCuotas(cuotas.filter(c => c.plan_id === plan).map(c => ({ numero: c.numero, monto: Number(c.monto), fecha: String(c.fecha_vencimiento).slice(0, 10), concepto: null })))
        : [],
      pagos: cobros.filter(c => c.negocio_id === n.id).map(c => ({ monto: c.monto, fecha: c.fecha, retencion_iva: c.retencion_iva, anulado_at: c.anulado_at })),
      servicios: svs.map(s => ({
        ...s,
        costo_cotizado: Number(s.costo_cotizado) || 0,
        valor_por_pagar: s.valor_por_pagar === null || s.valor_por_pagar === undefined ? null : Number(s.valor_por_pagar),
        gastos: gastos.filter(g => g.servicio_id === s.id).map(g => ({ ...g, monto: Number(g.monto) || 0 })),
        aprobaciones: aps.filter(a => a.entidad_id === s.id),
      })),
      aprobaciones: aps.map(a => ({ ...a, solicitada_por_nombre: a.solicitada_por ? nombreStaff.get(a.solicitada_por) ?? null : null })),
    }
  })

  const tablero = esDireccion ? await cargarTablero(db, workspaceId, lineaIds, staffId ?? null) : null
  return { activo: true, hoy, persona, pendientes: pendientesDe(viajes, persona, hoy), proximo: loProximo(viajes, hoy), tablero }
}

async function cargarTablero(db: Db, workspaceId: string, lineaIds: string[], staffId: string | null): Promise<Tablero> {
  const cerrados = await porTandas(lineaIds, async t => filas<{ id: string; nombre: string; codigo: string | null; metadata: Record<string, unknown> | null }>(
    await db.from('negocios').select('id, nombre, codigo, metadata').eq('workspace_id', workspaceId).in('linea_id', t).not('metadata->cierre_viaje->confirmado', 'is', null),
  ))
  const ids = cerrados.map(c => c.id)
  const [servicios, gastos] = await Promise.all([
    porTandas(ids, async t => filas<{ id: string; negocio_id: string; nombre: string; proveedor_nombre: string | null; estado: string; costo_cotizado: number }>(
      await db.from('negocio_servicios').select('id, negocio_id, nombre, proveedor_nombre, estado, costo_cotizado').in('negocio_id', t),
    )),
    porTandas(ids, async t => filas<{ negocio_id: string; servicio_id: string | null; monto: number; titular_medio: string | null; categoria: string | null }>(
      await db.from('gastos').select('negocio_id, servicio_id, monto, titular_medio, categoria').in('negocio_id', t),
    )),
  ])
  const cierres: CierreTablero[] = []
  for (const n of cerrados) {
    const conf = leerCierreGuardado(n.metadata).confirmado
    if (!conf) continue
    const g = gastos.filter(x => x.negocio_id === n.id)
    cierres.push({
      negocioId: n.id,
      nombre: n.codigo ? `${n.codigo} — ${n.nombre}` : n.nombre,
      esPrueba: (n.metadata as { es_prueba?: unknown } | null)?.es_prueba === true,
      mes: String(conf.at).slice(0, 7),
      margenReal: Number(conf.margen_real) || 0,
      ingresoNeto: Number(conf.ingreso_neto) || 0,
      margenCotizado: Number(conf.margen_cotizado) || 0,
      servicios: servicios.filter(s => s.negocio_id === n.id && s.estado !== 'cancelado').map(s => ({
        proveedor: s.proveedor_nombre?.trim() || s.nombre,
        cotizado: Number(s.costo_cotizado) || 0,
        real: g.filter(x => x.servicio_id === s.id).reduce((a, x) => a + (Number(x.monto) || 0), 0),
      })),
      gastosProveedor: g.filter(x => x.categoria === 'proveedor_viaje' && x.servicio_id).map(x => ({ monto: Number(x.monto) || 0, titular: x.titular_medio })),
    })
  }
  // El cierre de prueba (F8-1) solo suma para quien lleva o aprueba ese viaje (la dirección de prueba).
  const ocultos = cierres.some(c => c.esPrueba) ? await negociosDePruebaOcultos(db, workspaceId, staffId) : new Set<string>()
  return tableroDeMargen(cierres, new Set(cierres.filter(c => c.esPrueba && !ocultos.has(c.negocioId)).map(c => c.negocioId)))
}
