/**
 * «El cliente confirmó» contra la base (F2): lo que la hoja necesita leer, los planes con sus
 * versiones, la aprobación del plan fuera de la regla y la prerreserva vencida.
 *
 * No es `'use server'` a propósito: estas funciones reciben el cliente y el workspace de quien
 * llama (que ya pasó su guarda); exportadas desde un archivo de acciones serían endpoints sin
 * control (`lib/actions/modulos-server-only.test.ts`).
 *
 * Todo detrás de `lineas_negocio.config_extra.plan_pagos.activo`: apagado, nada se lee ni se
 * escribe y el negocio se ve como hoy.
 */

import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { preciosDeLasTarifas } from '@/lib/fiscal/iva-cotizacion-datos'
import { TARIFA_UNICA, totalSinTarifas } from './total-confirmacion'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { configPlanPagos, huellaPlan, normalizarCuotas, type CuotaPlan, type ReglaPlan } from './plan-pagos'
import {
  esAnticipoConSoporte,
  GATES_CONFIRMACION,
  gatesConfirmacionPendientes,
  leerPrerreserva,
  MOTIVO_PRERRESERVA_VENCIDA,
  prerreservaVencida,
  type EstadoConfirmacion,
  type Prerreserva,
  type TitularFacturacion,
} from './confirmacion'
import { aprobadoresDeLinea } from './estado-servicio'
import { rastroDeFechasCorregidas } from './servicios-viaje-datos'
import type { Composicion } from '@/lib/cotizaciones/tarifa-pasajero'

// El esquema nuevo (planes, cuotas, aprobaciones, cuenta_recaudo) no está en los tipos generados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// ── Tipos de la vista (los usa la pantalla con `import type`) ────────────────

export interface TarifaConfirmable {
  /**
   * `null` = la tarifa única implícita de una cotización sin tarifas: su precio es el total de la
   * cotización (`totalSinTarifas`) y se confirma con `itinerarioId: null`.
   */
  itinerarioId: string | null
  nombre: string
  esRecomendada: boolean
  precio: number | null
  motivo: string | null
}

export interface PlanGuardado {
  id: string
  version: number
  estado: 'propuesta' | 'acordado' | 'reemplazado' | 'anulado'
  origen: 'sugerido' | 'ajustado'
  total: number
  dentro_de_regla: boolean
  aprobacion_id: string | null
  motivo: string | null
  acordado_at: string | null
  created_at: string
  cuotas: CuotaPlan[]
}

export interface AprobacionPlan {
  id: string
  estado: 'solicitada' | 'aprobada' | 'rechazada' | 'caducada'
  huella: string
  motivo: string | null
  solicitada_por_nombre: string | null
  decidida_por_nombre: string | null
  decidida_at: string | null
  detalle: Record<string, unknown>
}

export interface MensajeConfirmacionGuardado {
  texto: string
  preparado_at: string
  wa_url: string
  enviado_at: string | null
  enviado_por: string | null
  enviado_por_nombre: string | null
  correo: { estado: 'enviado' | 'omitido' | 'fallido'; destino: string | null; motivo: string | null } | null
}

/** Lo que queda en `negocios.metadata.confirmacion_cliente`. */
export interface ConfirmacionGuardada {
  registrada_at: string
  registrada_por: string | null
  registrada_por_nombre: string | null
  fecha: string
  cotizacion_id: string
  itinerario_id: string | null
  tarifa_nombre: string | null
  total: number
  plan_id: string
  pantallazo: Record<string, unknown> | null
  mensaje: MensajeConfirmacionGuardado
}

export interface VistaConfirmacion {
  negocioId: string
  workspaceId: string
  /** El nombre del viajero (contacto del negocio). */
  cliente: { nombre: string; correo: string | null; telefono: string | null; contactoId: string | null }
  viaje: { destino: string | null; fechaSalida: string | null; fechaRegreso: string | null; composicion: Composicion | null }
  regla: ReglaPlan
  /** La cotización con la que se confirma: la aceptada, o la última que salió. */
  cotizacion: { id: string; consecutivo: string | null; estado: string; tarifaAceptadaId: string | null } | null
  tarifas: TarifaConfirmable[]
  errorTarifas: string | null
  /** Último plan (propuesta o acordado), con su historial de versiones. */
  plan: PlanGuardado | null
  versiones: Array<Pick<PlanGuardado, 'id' | 'version' | 'estado' | 'origen' | 'motivo' | 'created_at'>>
  aprobacion: AprobacionPlan | null
  confirmacion: ConfirmacionGuardada | null
  titular: TitularFacturacion | null
  prerreserva: Prerreserva | null
  estado: EstadoConfirmacion
  /** Gates de la etapa de confirmación de la línea (los que la etapa declara). */
  gates: string[]
  gateMensajes: Record<string, string>
  etapaConfirmacion: { id: string; nombre: string; numero: number } | null
  etapaActual: { id: string; nombre: string; numero: number; orden: number } | null
  /**
   * El negocio sigue abierto (H10-2, QA del 2026-10-29). Perdido, desistido o cancelado, la hoja
   * «El cliente confirmó» no se ofrece: la acción ya lo rechaza en el servidor (`contextoViaje`).
   */
  negocioAbierto: boolean
  /** ¿La etapa actual es la de confirmación o una anterior? (decide si se muestra la hoja). */
  antesDeConfirmacion: boolean
  enConfirmacion: boolean
  terminosBase: string | null
  /** La Solicitud registra una visa en trámite (`condicion-visa.ts`): el mensaje lleva la condición. */
  visaEnTramite: boolean
  agencia: string
  comercial: string | null
  hayPago: boolean
  /** `config_extra.aprobaciones.staff_ids` de la línea (la dirección, D8). */
  aprobadores: string[]
  /** La prerreserva venció sin anticipo y todavía no se aplicó (la ficha la aplica al abrir). */
  prerreservaVencida: boolean
}

// ── Lecturas ─────────────────────────────────────────────────────────────────

interface NegocioLeido {
  id: string
  workspace_id: string
  nombre: string | null
  codigo: string | null
  estado: string | null
  metadata: Record<string, unknown> | null
  precio_aprobado: number | null
  contacto_id: string | null
  linea_id: string | null
  etapa_actual_id: string | null
}

export async function leerNegocioConLinea(db: Db, workspaceId: string, negocioId: string): Promise<{ negocio: NegocioLeido; configLinea: Record<string, unknown> } | null> {
  const { data, error } = await db
    .from('negocios')
    .select('id, workspace_id, nombre, codigo, estado, metadata, precio_aprobado, contacto_id, linea_id, etapa_actual_id, lineas_negocio(config_extra)')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error || !data) return null
  const linea = (data as { lineas_negocio?: unknown }).lineas_negocio
  const fila = (Array.isArray(linea) ? linea[0] : linea) as { config_extra?: Record<string, unknown> } | null
  return { negocio: data as NegocioLeido, configLinea: fila?.config_extra ?? {} }
}

/** El interruptor del plan de pagos para un negocio. Si no se puede leer, apagado. */
export async function planPagosActivoDelNegocio(db: Db, workspaceId: string, negocioId: string): Promise<boolean> {
  const r = await leerNegocioConLinea(db, workspaceId, negocioId)
  return !!r && configPlanPagos(r.configLinea).activo
}

function aPlan(fila: Record<string, unknown>, cuotas: Array<Record<string, unknown>>): PlanGuardado {
  return {
    id: String(fila.id),
    version: Number(fila.version),
    estado: fila.estado as PlanGuardado['estado'],
    origen: (fila.origen as PlanGuardado['origen']) ?? 'sugerido',
    total: Number(fila.total),
    dentro_de_regla: fila.dentro_de_regla === true,
    aprobacion_id: (fila.aprobacion_id as string | null) ?? null,
    motivo: (fila.motivo as string | null) ?? null,
    acordado_at: (fila.acordado_at as string | null) ?? null,
    created_at: String(fila.created_at ?? ''),
    cuotas: normalizarCuotas(
      cuotas
        .filter((c) => c.plan_id === fila.id)
        .map((c) => ({
          numero: Number(c.numero),
          monto: Number(c.monto),
          fecha: String(c.fecha_vencimiento).slice(0, 10),
          concepto: (c.concepto as string | null) ?? null,
        })),
    ),
  }
}

/** Los planes del negocio, del más nuevo al más viejo, con sus cuotas. */
export async function leerPlanes(db: Db, negocioId: string): Promise<PlanGuardado[]> {
  const { data: planes, error } = await db
    .from('negocio_planes_pago')
    .select('id, version, estado, origen, total, dentro_de_regla, aprobacion_id, motivo, acordado_at, created_at')
    .eq('negocio_id', negocioId)
    .order('version', { ascending: false })
  if (error) throw new Error(`No se pudo leer el plan de pagos: ${error.message}`)
  const filas = (planes ?? []) as Array<Record<string, unknown>>
  if (filas.length === 0) return []
  const { data: cuotas, error: errC } = await db
    .from('negocio_plan_cuotas')
    .select('plan_id, numero, monto, fecha_vencimiento, concepto')
    .in('plan_id', filas.map((f) => f.id))
  if (errC) throw new Error(`No se pudieron leer las cuotas: ${errC.message}`)
  return filas.map((f) => aPlan(f, (cuotas ?? []) as Array<Record<string, unknown>>))
}

/** El plan acordado vigente del negocio (uno por negocio, índice único). */
export async function planAcordado(db: Db, negocioId: string): Promise<PlanGuardado | null> {
  return (await leerPlanes(db, negocioId)).find((p) => p.estado === 'acordado') ?? null
}

/** La aprobación de plan fuera de la regla más reciente del negocio. */
export async function ultimaAprobacionPlan(db: Db, negocioId: string): Promise<AprobacionPlan | null> {
  const { data, error } = await db
    .from('aprobaciones_excepcion')
    .select('id, estado, huella, motivo, detalle, solicitada_por, decidida_por, decidida_at, solicitada_at')
    .eq('negocio_id', negocioId)
    .eq('tipo', 'plan_fuera_de_regla')
    .order('solicitada_at', { ascending: false })
    .limit(1)
  if (error) return null
  const a = ((data ?? []) as Array<Record<string, unknown>>)[0]
  if (!a) return null
  const ids = [a.solicitada_por, a.decidida_por].filter((x): x is string => typeof x === 'string')
  const nombres = new Map<string, string>()
  if (ids.length > 0) {
    const { data: st } = await db.from('staff').select('id, full_name').in('id', ids)
    for (const s of (st ?? []) as Array<{ id: string; full_name: string | null }>) nombres.set(s.id, s.full_name ?? '')
  }
  return {
    id: String(a.id),
    estado: a.estado as AprobacionPlan['estado'],
    huella: String(a.huella),
    motivo: (a.motivo as string | null) ?? null,
    detalle: (a.detalle as Record<string, unknown>) ?? {},
    solicitada_por_nombre: typeof a.solicitada_por === 'string' ? nombres.get(a.solicitada_por) ?? null : null,
    decidida_por_nombre: typeof a.decidida_por === 'string' ? nombres.get(a.decidida_por) ?? null : null,
    decidida_at: (a.decidida_at as string | null) ?? null,
  }
}

/** ¿Hay una aprobación vigente (aprobada) para exactamente estas cuotas? (F2-3: la huella manda). */
export async function aprobacionVigenteParaHuella(db: Db, negocioId: string, huella: string): Promise<string | null> {
  const { data } = await db
    .from('aprobaciones_excepcion')
    .select('id, huella')
    .eq('negocio_id', negocioId)
    .eq('tipo', 'plan_fuera_de_regla')
    .eq('estado', 'aprobada')
  const fila = ((data ?? []) as Array<{ id: string; huella: string }>).find((a) => a.huella === huella)
  return fila?.id ?? null
}

interface CobroLeido { monto: number | null; fecha: string | null; soporte: unknown; cuenta_recaudo?: string | null; anulado_at?: string | null }

export async function cobrosDelNegocio(db: Db, workspaceId: string, negocioId: string): Promise<CobroLeido[]> {
  const { data, error } = await db
    .from('cobros')
    .select('*')
    .eq('negocio_id', negocioId)
    .eq('workspace_id', workspaceId)
  if (error) throw new Error(`No se pudieron leer los pagos: ${error.message}`)
  return ((data ?? []) as CobroLeido[]).filter((c) => !c.anulado_at)
}

/**
 * ¿El plan acordado está vigente? Dentro de la regla, sí; fuera, solo con una aprobación `aprobada`
 * de ESAS cuotas (la huella manda, F2-3). Una sola regla para el gate `plan_pagos_acordado` y el
 * panel: el panel miraba solo la última aprobación y podía decir «sin aprobar» con una vigente
 * (barrido 2026-10-22).
 */
export async function planVigenteDe(db: Db, negocioId: string, acordado: PlanGuardado | null): Promise<boolean> {
  if (!acordado) return false
  if (acordado.dentro_de_regla) return true
  return !!(await aprobacionVigenteParaHuella(db, negocioId, huellaPlan(acordado.cuotas, acordado.total)))
}

/** El estado de los tres gates de la etapa Confirmación, leído de la base. */
export async function estadoConfirmacion(
  db: Db,
  args: { workspaceId: string; negocioId: string; metadata: Record<string, unknown> | null },
): Promise<EstadoConfirmacion> {
  const confirmado = !!(args.metadata?.confirmacion_cliente as Record<string, unknown> | undefined)?.registrada_at
  const planVigente = await planVigenteDe(db, args.negocioId, await planAcordado(db, args.negocioId))
  const cobros = await cobrosDelNegocio(db, args.workspaceId, args.negocioId)
  return { confirmado, planVigente, anticipoConSoporte: cobros.some(esAnticipoConSoporte) }
}

interface EtapaLinea { id: string; nombre: string; numero: number; orden: number; config_extra: Record<string, unknown> | null }

async function etapasDeLinea(db: Db, lineaId: string): Promise<EtapaLinea[]> {
  const { data } = await db
    .from('etapas_negocio')
    .select('id, nombre, numero, orden, config_extra, is_active')
    .eq('linea_id', lineaId)
    .order('orden', { ascending: true })
  return ((data ?? []) as Array<EtapaLinea & { is_active?: boolean }>).filter((e) => e.is_active !== false)
}

function gatesDe(e: EtapaLinea | undefined): string[] {
  const g = (e?.config_extra as { gates?: unknown } | null)?.gates
  return Array.isArray(g) ? g.filter((x): x is string => typeof x === 'string') : []
}

/** La etapa de la línea que declara el gate `confirmacion_registrada`: ahí queda el negocio al confirmar. */
export function etapaDeConfirmacion<T extends EtapaLinea>(etapas: readonly T[]): T | null {
  return etapas.find((e) => gatesDe(e).includes('confirmacion_registrada')) ?? null
}

/** La etapa donde vive la cotización (la de menor orden con un bloque de cotización). */
export async function etapaDeCotizacion(db: Db, workspaceId: string, lineaId: string): Promise<EtapaLinea | null> {
  const etapas = await etapasDeLinea(db, lineaId)
  if (etapas.length === 0) return null
  const { data } = await db
    .from('bloque_configs')
    .select('etapa_id, bloque_definitions!inner(tipo)')
    .eq('workspace_id', workspaceId)
    .in('etapa_id', etapas.map((e) => e.id))
    .eq('bloque_definitions.tipo', 'cotizacion')
  const conCotizacion = new Set(((data ?? []) as Array<{ etapa_id: string }>).map((b) => b.etapa_id))
  return etapas.find((e) => conCotizacion.has(e.id)) ?? null
}

/** Lee todo lo que la hoja y el panel necesitan. `null` con el interruptor apagado. */
export async function leerVistaConfirmacion(db: Db, workspaceId: string, negocioId: string): Promise<VistaConfirmacion | null> {
  const base = await leerNegocioConLinea(db, workspaceId, negocioId)
  if (!base) return null
  const cfg = configPlanPagos(base.configLinea)
  if (!cfg.activo) return null
  const { negocio, configLinea } = base

  const [contactoRes, cotsRes, viajeRes, planes, aprobacion, etapas, wsRes, respRes] = await Promise.all([
    negocio.contacto_id
      ? db.from('contactos').select('id, nombre, email, telefono').eq('id', negocio.contacto_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('cotizaciones').select('*').eq('negocio_id', negocioId).order('created_at', { ascending: false }),
    leerViajeDelNegocio(db, negocioId),
    leerPlanes(db, negocioId),
    ultimaAprobacionPlan(db, negocioId),
    negocio.linea_id ? etapasDeLinea(db, negocio.linea_id) : Promise.resolve([] as EtapaLinea[]),
    db.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    db.from('negocio_responsables').select('staff_id, staff!negocio_responsables_staff_id_fkey(full_name)').eq('negocio_id', negocioId),
  ])

  const contacto = (contactoRes.data ?? null) as { id: string; nombre: string; email: string | null; telefono: string | null } | null
  const cots = ((cotsRes.data ?? []) as Array<Record<string, unknown>>).filter((c) => c.estado !== 'vencida')
  const cot =
    cots.find((c) => c.estado === 'aceptada') ??
    cots.find((c) => c.estado === 'enviada') ??
    cots.find((c) => c.estado === 'borrador') ??
    null

  let tarifas: TarifaConfirmable[] = []
  let errorTarifas: string | null = null
  if (cot) {
    const precios = await preciosDeLasTarifas(db, { workspaceId, cotizacionId: String(cot.id) })
    if (precios.ok && precios.tarifas.length === 0) {
      // Sin tarifas (una sola opción por componente): una tarifa única con el total de la
      // cotización, la misma cifra que fija la aprobación. Sin total, la lista queda vacía.
      const unica = await totalSinTarifas(db, { workspaceId, cotizacionId: String(cot.id) })
      if (unica.ok) tarifas = [{ itinerarioId: null, nombre: TARIFA_UNICA, esRecomendada: false, precio: unica.total, motivo: null }]
      else if (!unica.sinTotal) errorTarifas = unica.error
    } else if (precios.ok) {
      tarifas = precios.tarifas.map((t) => ({ itinerarioId: t.itinerarioId, nombre: t.nombre ?? 'Tarifa', esRecomendada: t.esRecomendada, precio: t.precio, motivo: t.motivo }))
    } else {
      errorTarifas = precios.error
    }
  }

  const metadata = negocio.metadata ?? {}
  const confirmacion = (metadata.confirmacion_cliente ?? null) as ConfirmacionGuardada | null
  const titular = (metadata.titular_facturacion ?? null) as TitularFacturacion | null
  const prerreserva = leerPrerreserva(metadata.prerreserva)
  const cobros = await cobrosDelNegocio(db, workspaceId, negocioId)
  const hayPago = cobros.some((c) => !!c.fecha && Number(c.monto ?? 0) > 0)

  const plan = planes.find((p) => p.estado === 'acordado') ?? planes.find((p) => p.estado === 'propuesta') ?? null
  const planVigente = await planVigenteDe(db, negocioId, planes.find((p) => p.estado === 'acordado') ?? null)

  const etapaConf = etapaDeConfirmacion(etapas)
  const etapaActual = etapas.find((e) => e.id === negocio.etapa_actual_id) ?? null
  const responsables = (respRes.data ?? []) as Array<{ staff: { full_name: string | null } | null }>

  return {
    negocioId,
    workspaceId,
    cliente: {
      nombre: contacto?.nombre?.trim() || negocio.nombre?.trim() || 'el cliente',
      correo: contacto?.email ?? null,
      telefono: contacto?.telefono ?? null,
      contactoId: contacto?.id ?? null,
    },
    viaje: {
      destino: viajeRes.viaje.destino,
      fechaSalida: viajeRes.viaje.fechas.inicio,
      fechaRegreso: viajeRes.viaje.fechas.fin,
      composicion: viajeRes.viaje.composicion,
    },
    regla: cfg.regla,
    cotizacion: cot
      ? { id: String(cot.id), consecutivo: (cot.consecutivo as string | null) ?? null, estado: String(cot.estado), tarifaAceptadaId: (cot.tarifa_aceptada_id as string | null) ?? null }
      : null,
    tarifas,
    errorTarifas,
    plan,
    versiones: planes.map((p) => ({ id: p.id, version: p.version, estado: p.estado, origen: p.origen, motivo: p.motivo, created_at: p.created_at })),
    aprobacion,
    confirmacion,
    titular,
    prerreserva,
    estado: { confirmado: !!confirmacion?.registrada_at, planVigente, anticipoConSoporte: cobros.some(esAnticipoConSoporte) },
    gates: gatesDe(etapaConf ?? undefined),
    gateMensajes: ((etapaConf?.config_extra as { gate_messages?: Record<string, string> } | null)?.gate_messages ?? {}) as Record<string, string>,
    etapaConfirmacion: etapaConf ? { id: etapaConf.id, nombre: etapaConf.nombre, numero: etapaConf.numero } : null,
    etapaActual: etapaActual ? { id: etapaActual.id, nombre: etapaActual.nombre, numero: etapaActual.numero, orden: etapaActual.orden } : null,
    // La MISMA regla que `contextoViaje` usa para negar las acciones.
    negocioAbierto: !negocio.estado || negocio.estado === 'abierto',
    antesDeConfirmacion: !!etapaConf && !!etapaActual && etapaActual.orden < etapaConf.orden,
    enConfirmacion: !!etapaConf && etapaActual?.id === etapaConf.id,
    terminosBase: typeof configLinea.terminos_base === 'string' ? configLinea.terminos_base : null,
    visaEnTramite: viajeRes.visaEnTramite ?? false,
    agencia: ((wsRes.data as { name?: string } | null)?.name ?? '').trim() || 'la agencia',
    comercial: responsables.map((r) => r.staff?.full_name?.trim()).find(Boolean) ?? null,
    hayPago,
    aprobadores: aprobadoresDeLinea(configLinea),
    prerreservaVencida: prerreservaVencida(prerreserva, Date.now(), hayPago),
  }
}

// ── Escrituras ───────────────────────────────────────────────────────────────

/**
 * Guarda una versión nueva del plan. Con `acordar`, la anterior acordada pasa a `reemplazado`
 * ANTES de insertar (el índice único admite un solo acordado por negocio). Las propuestas
 * anteriores quedan `reemplazado`: la historia de versiones se lee de ahí.
 */
export async function guardarVersionPlan(
  db: Db,
  args: {
    workspaceId: string
    negocioId: string
    cotizacionId: string | null
    cuotas: CuotaPlan[]
    total: number
    fechaReferencia: string | null
    regla: ReglaPlan
    dentroDeRegla: boolean
    origen: 'sugerido' | 'ajustado'
    motivo: string | null
    staffId: string | null
    acordar: boolean
    aprobacionId: string | null
  },
): Promise<{ ok: true; planId: string; version: number } | { ok: false; error: string }> {
  const planes = await leerPlanes(db, args.negocioId)
  const version = (planes[0]?.version ?? 0) + 1
  const vivas = planes.filter((p) => p.estado === 'propuesta' || (args.acordar && p.estado === 'acordado'))
  if (vivas.length > 0) {
    const { error } = await db
      .from('negocio_planes_pago')
      .update({ estado: 'reemplazado' })
      .in('id', vivas.map((p) => p.id))
    if (error) return { ok: false, error: `No se pudo guardar el plan: ${error.message}` }
  }
  const ahora = new Date().toISOString()
  const { data, error } = await db
    .from('negocio_planes_pago')
    .insert({
      workspace_id: args.workspaceId,
      negocio_id: args.negocioId,
      cotizacion_id: args.cotizacionId,
      version,
      estado: args.acordar ? 'acordado' : 'propuesta',
      origen: args.origen,
      total: Math.round(args.total),
      fecha_referencia: args.fechaReferencia,
      regla: args.regla,
      dentro_de_regla: args.dentroDeRegla,
      aprobacion_id: args.aprobacionId,
      motivo: args.motivo,
      acordado_at: args.acordar ? ahora : null,
      acordado_por: args.acordar ? args.staffId : null,
      created_by: args.staffId,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: `No se pudo guardar el plan: ${error?.message ?? 'sin respuesta'}` }
  const planId = (data as { id: string }).id
  const { error: errC } = await db.from('negocio_plan_cuotas').insert(
    normalizarCuotas(args.cuotas).map((c) => ({
      workspace_id: args.workspaceId,
      plan_id: planId,
      numero: c.numero,
      monto: c.monto,
      fecha_vencimiento: c.fecha,
      concepto: c.concepto,
    })),
  )
  if (errC) {
    // Sin cuotas el plan no sirve: se retira la versión para no dejar un plan vacío acordado.
    await db.from('negocio_planes_pago').delete().eq('id', planId)
    return { ok: false, error: `No se pudieron guardar las cuotas: ${errC.message}` }
  }
  return { ok: true, planId, version }
}

/** Avisa a los aprobadores de la línea (notificación en la app con enlace al negocio). */
export async function avisarAprobadores(
  svc: Db,
  args: { workspaceId: string; configLinea: unknown; negocioId: string; entidadId: string; contenido: string; tipo: 'aprobacion_pendiente' | 'aprobacion_decidida'; destinatariosStaff?: string[]; entidadTipo?: 'plan_pago' | 'servicio' },
): Promise<void> {
  const staffIds = args.destinatariosStaff ?? aprobadoresDeLinea(args.configLinea)
  let perfiles: string[] = []
  if (staffIds.length > 0) {
    const { data } = await svc.from('staff').select('profile_id').eq('workspace_id', args.workspaceId).in('id', staffIds)
    perfiles = ((data ?? []) as Array<{ profile_id: string | null }>).map((s) => s.profile_id ?? '').filter(Boolean)
  }
  if (perfiles.length === 0 && !args.destinatariosStaff) {
    // Sin aprobadores declarados, la dirección es el dueño del espacio.
    const { data } = await svc.from('profiles').select('id').eq('workspace_id', args.workspaceId).eq('role', 'owner')
    perfiles = ((data ?? []) as Array<{ id: string }>).map((p) => p.id)
  }
  if (perfiles.length === 0) return
  const { error } = await svc.from('notificaciones').insert(
    [...new Set(perfiles)].map((p) => ({
      workspace_id: args.workspaceId,
      destinatario_id: p,
      tipo: args.tipo,
      estado: 'pendiente',
      contenido: args.contenido.slice(0, 500),
      entidad_tipo: args.entidadTipo ?? 'plan_pago',
      entidad_id: args.entidadId,
      deep_link: `/negocios/${args.negocioId}`,
      metadata: { negocio_id: args.negocioId },
    })),
  )
  if (error) console.error('[confirmacion] no se pudo avisar a los aprobadores:', error.message)
}

/**
 * Prerreserva vencida sin anticipo (Vera C9). Lo hace el cron o la apertura del negocio; corre con
 * el cliente de servicio, acotado al workspace del negocio. Idempotente: una prerreserva que ya no
 * está `vigente` no hace nada.
 *
 *   1. El negocio vuelve a la etapa de la cotización, con motivo «prerreserva vencida».
 *   2. El plan acordado pasa a `anulado`.
 *   3. Los servicios sin pagos se borran; los que tienen pagos quedan «No va» con su soporte.
 *   4. La cotización aceptada queda `vencida` y se duplica con `origen_version = 'prerreserva_vencida'`.
 *   5. Se cuenta como reproceso (marca en el negocio y en la actividad).
 */
export async function aplicarPrerreservaVencida(
  svc: Db,
  args: { workspaceId: string; negocioId: string; ahoraMs: number; duplicar: (cotizacionId: string) => Promise<{ ok: true; id: string } | { ok: false; error: string }> },
): Promise<{ aplicada: boolean; error?: string }> {
  const base = await leerNegocioConLinea(svc, args.workspaceId, args.negocioId)
  if (!base || !configPlanPagos(base.configLinea).activo) return { aplicada: false }
  const { negocio } = base
  if (negocio.estado && negocio.estado !== 'abierto') return { aplicada: false }
  const metadata = negocio.metadata ?? {}
  const pre = leerPrerreserva(metadata.prerreserva)
  const cobros = await cobrosDelNegocio(svc, args.workspaceId, args.negocioId)
  const hayPago = cobros.some((c) => !!c.fecha && Number(c.monto ?? 0) > 0)
  if (!prerreservaVencida(pre, args.ahoraMs, hayPago)) return { aplicada: false }

  // Reclamo: solo una corrida pasa la prerreserva de `vigente` a `vencida`.
  const ahoraIso = new Date(args.ahoraMs).toISOString()
  const metaNueva = {
    ...metadata,
    prerreserva: { ...(pre as Prerreserva), estado: 'vencida', vencida_at: ahoraIso },
    reproceso_viaje: {
      motivo: MOTIVO_PRERRESERVA_VENCIDA,
      at: ahoraIso,
      ciclo: Number((metadata.reproceso_viaje as { ciclo?: number } | undefined)?.ciclo ?? 0) + 1,
    },
  }
  const { data: reclamado, error: errReclamo } = await svc
    .from('negocios')
    .update({ metadata: metaNueva })
    .eq('id', args.negocioId)
    .eq('workspace_id', args.workspaceId)
    .eq('metadata->prerreserva->>estado', 'vigente')
    .select('id')
  if (errReclamo) return { aplicada: false, error: errReclamo.message }
  if (!reclamado || reclamado.length === 0) return { aplicada: false }

  // 2. Plan anulado.
  await svc
    .from('negocio_planes_pago')
    .update({ estado: 'anulado', anulado_at: ahoraIso, anulado_motivo: MOTIVO_PRERRESERVA_VENCIDA })
    .eq('negocio_id', args.negocioId)
    .in('estado', ['acordado', 'propuesta'])

  // 3. Servicios: sin pagos se borran; con pagos, «No va».
  // Las fechas corregidas a mano de las que se borran se PIERDEN a propósito (la versión nueva
  // tiene ítems con id nuevo y se vuelve a armar): quedan dichas en la Actividad (`rastro`).
  const { data: servicios } = await svc
    .from('negocio_servicios')
    .select('id, nombre, fecha_servicio, fecha_fin, fechas_corregidas_at')
    .eq('negocio_id', args.negocioId)
  const filasServicio = (servicios ?? []) as Array<{ id: string; nombre: string; fecha_servicio: string | null; fecha_fin: string | null; fechas_corregidas_at: string | null }>
  const ids = filasServicio.map((s) => s.id)
  let rastroFechas: string | null = null
  if (ids.length > 0) {
    const { data: gastos } = await svc.from('gastos').select('servicio_id').in('servicio_id', ids)
    const conPago = new Set(((gastos ?? []) as Array<{ servicio_id: string }>).map((g) => g.servicio_id))
    const borrar = ids.filter((id) => !conPago.has(id))
    rastroFechas = rastroDeFechasCorregidas(filasServicio.filter((s) => !conPago.has(s.id)))
    if (borrar.length > 0) await svc.from('negocio_servicios').delete().in('id', borrar)
    const noVa = ids.filter((id) => conPago.has(id))
    if (noVa.length > 0) await svc.from('negocio_servicios').update({ estado: 'cancelado' }).in('id', noVa)
  }

  // 4. Cotización: la aceptada vence y se duplica como versión nueva.
  const { data: cots } = await svc.from('cotizaciones').select('id, consecutivo').eq('negocio_id', args.negocioId).eq('estado', 'aceptada')
  const aceptada = ((cots ?? []) as Array<{ id: string; consecutivo: string | null }>)[0] ?? null
  if (aceptada) {
    await svc.from('cotizaciones').update({ estado: 'vencida', updated_at: ahoraIso }).eq('id', aceptada.id)
    const dup = await args.duplicar(aceptada.id)
    if (dup.ok) {
      const { error: errOrigen } = await svc.from('cotizaciones').update({ origen_version: 'prerreserva_vencida' }).eq('id', dup.id)
      if (errOrigen) console.error('[prerreserva] no se pudo marcar el origen de la versión:', errOrigen.message)
    } else {
      console.error('[prerreserva] no se pudo duplicar la cotización:', dup.error)
    }
    // Los bloques de cotización vuelven a pendiente (espejo de la aceptación).
    const { data: bloques } = await svc
      .from('negocio_bloques')
      .select('id, bloque_configs!inner(bloque_definitions!inner(tipo))')
      .eq('negocio_id', args.negocioId)
    const cotBloques = ((bloques ?? []) as Array<{ id: string; bloque_configs?: { bloque_definitions?: { tipo?: string } } }>)
      .filter((b) => b.bloque_configs?.bloque_definitions?.tipo === 'cotizacion')
      .map((b) => b.id)
    if (cotBloques.length > 0) {
      await svc.from('negocio_bloques').update({ estado: 'pendiente', completado_at: null }).in('id', cotBloques)
    }
  }

  // 1. De vuelta a la etapa de la cotización, sin precio aprobado (ya no hay acuerdo vigente).
  const etapa = negocio.linea_id ? await etapaDeCotizacion(svc, args.workspaceId, negocio.linea_id) : null
  await svc
    .from('negocios')
    .update({
      precio_aprobado: null,
      updated_at: ahoraIso,
      ...(etapa ? { etapa_actual_id: etapa.id } : {}),
    })
    .eq('id', args.negocioId)
    .eq('workspace_id', args.workspaceId)

  // 5. Rastro: cuenta como reproceso.
  await registrarActividad(svc, {
    workspace_id: args.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: args.negocioId,
    tipo: 'sistema',
    autor_id: null,
    contenido: `Reproceso: venció la prerreserva sin anticipo. El negocio volvió a ${etapa?.nombre ?? 'Cotización'} y la cotización se armó de nuevo${aceptada?.consecutivo ? ` (venía de ${aceptada.consecutivo})` : ''}.`.slice(0, 280),
  }, 'aplicarPrerreservaVencida')
  if (rastroFechas) {
    await registrarActividad(svc, {
      workspace_id: args.workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: args.negocioId,
      tipo: 'sistema',
      autor_id: null,
      contenido: rastroFechas,
    }, 'aplicarPrerreservaVencida')
  }
  return { aplicada: true }
}

/** Las prerreservas vigentes y ya vencidas de las líneas encendidas (para el cron). */
export async function prerreservasVencidas(svc: Db, ahoraMs: number): Promise<Array<{ workspaceId: string; negocioId: string }>> {
  const { data: lineas } = await svc
    .from('lineas_negocio')
    .select('id')
    .filter('config_extra->plan_pagos->>activo', 'eq', 'true')
  const lineaIds = ((lineas ?? []) as Array<{ id: string }>).map((l) => l.id)
  if (lineaIds.length === 0) return []
  const { data } = await svc
    .from('negocios')
    .select('id, workspace_id, metadata')
    .in('linea_id', lineaIds)
    .eq('estado', 'abierto')
    .eq('metadata->prerreserva->>estado', 'vigente')
  return ((data ?? []) as Array<{ id: string; workspace_id: string; metadata: Record<string, unknown> | null }>)
    .filter((n) => {
      const p = leerPrerreserva(n.metadata?.prerreserva)
      return !!p && Date.parse(p.vence_at) <= ahoraMs
    })
    .map((n) => ({ workspaceId: n.workspace_id, negocioId: n.id }))
}

/**
 * Gates de la etapa Confirmación (Max §5): `confirmacion_registrada`, `plan_pagos_acordado` y
 * `anticipo_con_soporte`. Opt-in por `etapas_negocio.config_extra.gates`: una etapa sin estos ids
 * no consulta nada (SOENA, AFI y Termotech no cambian). Devuelve lo que falta, en palabras.
 */
export async function evaluarGatesConfirmacion(
  db: Db,
  args: { workspaceId: string; negocioId: string; gates: readonly string[]; mensajes: Record<string, string> },
): Promise<string[]> {
  if (!args.gates.some((g) => (GATES_CONFIRMACION as readonly string[]).includes(g))) return []
  const { data } = await db.from('negocios').select('metadata').eq('id', args.negocioId).eq('workspace_id', args.workspaceId).maybeSingle()
  const estado = await estadoConfirmacion(db, {
    workspaceId: args.workspaceId,
    negocioId: args.negocioId,
    metadata: ((data as { metadata?: Record<string, unknown> } | null)?.metadata ?? null),
  })
  return gatesConfirmacionPendientes(args.gates, estado, args.mensajes)
}
