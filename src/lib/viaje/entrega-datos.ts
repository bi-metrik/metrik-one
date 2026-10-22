import 'server-only'

/**
 * «Documentos y entrega» contra la base (F4). No es `'use server'`: recibe el cliente y el
 * workspace de quien llama, que ya pasó su guarda.
 *
 * Lee: el negocio y su línea (`entrega_viaje.activo`), los gates de la etapa actual, los
 * servicios (vouchers), el plan acordado y los pagos (cobro mínimo), las fechas y el tipo de
 * destino del bloque de la etapa 1, el contacto y sus documentos (C11), y lo que quedó del
 * paquete enviado en `negocios.metadata.paquete_viaje`.
 */

import { todayBogotaISO } from '@/lib/dates/bogota'
import { cobradoConfirmado } from '@/lib/cobros/saldo-negocio'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { configPlanPagos } from './plan-pagos'
import { cobrosDelNegocio, leerNegocioConLinea, planAcordado } from './confirmacion-datos'
import { leerServiciosDelNegocio, type ServicioDelNegocio } from './servicios-viaje-datos'
import {
  GATES_ENTREGA,
  GATE_COBRO_MINIMO,
  GATE_DOCUMENTOS,
  GATE_PAQUETE,
  GATE_VOUCHERS,
  asistenciasDelViaje,
  avisoVencimiento,
  cobroMinimo,
  configEntrega,
  esInternacional,
  faltaDocumentos,
  huellaVouchers,
  leerPaqueteEnviado,
  mensajeCobroMinimo,
  mensajeVouchers,
  pideVoucher,
  textoCuentaRegresiva,
  vouchersDelViaje,
  type AsistenciaDelViaje,
  type DocumentoViajero,
  type EstadoCobroMinimo,
  type PaqueteEnviado,
  type Vouchers,
} from './entrega'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface VistaEntrega {
  negocioId: string
  workspaceId: string
  hoy: string
  agencia: string
  cliente: { id: string | null; nombre: string; telefono: string | null; correo: string | null }
  fechaSalida: string | null
  fechaRegreso: string | null
  vouchers: Vouchers
  filas: Array<{ id: string; nombre: string; tieneVoucher: boolean }>
  cobro: EstadoCobroMinimo
  mensajeCobro: string | null
  cuentaRegresiva: string
  internacional: boolean | null
  documentos: Array<DocumentoViajero & { aviso: string | null }>
  faltaDocumento: string | null
  /** La asistencia médica que va en el viaje (Noor §11). Vacío si la cotización no la incluye. */
  asistencias: AsistenciaDelViaje[]
  paquete: PaqueteEnviado | null
  cambioVoucher: boolean
  /** Los gates de la etapa actual que son de esta etapa. */
  gates: string[]
  /**
   * Lo que no se pudo leer, por gate (`cobro_minimo` → «el plan de pagos»…). El panel se pinta igual
   * con lo que haya; el gate retiene (falla cerrado). Vacío o ausente = se leyó todo.
   */
  noSePudoLeer?: Partial<Record<(typeof GATES_ENTREGA)[number], string[]>>
}

export interface Base {
  negocio: { id: string; nombre: string | null; metadata: Record<string, unknown> | null; precio_aprobado: number | null; contacto_id: string | null; etapa_actual_id: string | null }
  configLinea: Record<string, unknown>
}

async function gatesDeEtapa(db: Db, etapaId: string | null): Promise<string[]> {
  if (!etapaId) return []
  const { data } = await db.from('etapas_negocio').select('config_extra').eq('id', etapaId).maybeSingle()
  const gates = ((data as { config_extra?: { gates?: unknown } } | null)?.config_extra?.gates ?? []) as unknown[]
  return gates.filter((g): g is string => typeof g === 'string')
}

async function destinoTipo(db: Db, negocioId: string): Promise<unknown> {
  const { data, error } = await db.from('negocio_bloques').select('destino_tipo:data->destino_tipo').eq('negocio_id', negocioId)
  if (error) throw new Error(`No se pudo leer el tipo de destino: ${error.message}`)
  return ((data ?? []) as Array<{ destino_tipo?: unknown }>).map(f => f.destino_tipo).find(v => typeof v === 'string' && v.trim()) ?? null
}

export async function documentosDelContacto(db: Db, workspaceId: string, contactoId: string | null): Promise<DocumentoViajero[]> {
  if (!contactoId) return []
  const { data, error } = await db
    .from('contacto_documentos')
    .select('id, tipo, numero, nombre_en_documento, pais, fecha_vencimiento, archivo_ref')
    .eq('workspace_id', workspaceId)
    .eq('contacto_id', contactoId)
    .eq('vigente', true)
    .order('created_at', { ascending: false })
  if (error) {
    // Sin la migración aplicada la tabla no existe: el bloque dice que no hay documentos.
    console.warn('[entrega] no se pudieron leer los documentos del contacto:', error.message)
    return []
  }
  return (data ?? []) as DocumentoViajero[]
}

/** Lo que el panel, el gate y el envío necesitan. `null` con el interruptor apagado. */
export async function leerVistaEntrega(db: Db, workspaceId: string, negocioId: string): Promise<VistaEntrega | null> {
  const base = (await leerNegocioConLinea(db, workspaceId, negocioId)) as Base | null
  if (!base) return null
  const cfg = configEntrega(base.configLinea)
  if (!cfg.activo) return null
  return armarVista(db, workspaceId, base)
}

async function armarVista(db: Db, workspaceId: string, base: Base): Promise<VistaEntrega> {
  const negocioId = base.negocio.id
  const hoy = todayBogotaISO()
  const regla = configPlanPagos(base.configLinea).regla
  // El panel se pinta con lo que haya; lo que no se pudo leer queda anotado para que el gate retenga.
  const fallas: NonNullable<VistaEntrega['noSePudoLeer']> = {}
  const anotar = (gate: (typeof GATES_ENTREGA)[number], que: string) => { (fallas[gate] ??= []).push(que) }
  const [gates, servicios, plan, cobros, { viaje }, tipoDestino, contactoRes, wsRes] = await Promise.all([
    gatesDeEtapa(db, base.negocio.etapa_actual_id),
    leerServiciosDelNegocio(db, { workspaceId, negocioId }),
    planAcordado(db, negocioId).catch(() => { anotar(GATE_COBRO_MINIMO, 'el plan de pagos'); return null }),
    cobrosDelNegocio(db, workspaceId, negocioId).catch(() => { anotar(GATE_COBRO_MINIMO, 'los pagos'); return [] }),
    leerViajeDelNegocio(db, negocioId),
    destinoTipo(db, negocioId).catch(() => { anotar(GATE_DOCUMENTOS, 'si el viaje es nacional o internacional'); return null }),
    base.negocio.contacto_id
      ? db.from('contactos').select('id, nombre, email, telefono').eq('id', base.negocio.contacto_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
  ])
  const contacto = (contactoRes.data ?? null) as { id: string; nombre: string | null; email: string | null; telefono: string | null } | null
  const nombre = (contacto?.nombre ?? '').trim()
  if (servicios === null) anotar(GATE_VOUCHERS, 'los servicios del viaje')
  const filas = (servicios ?? []) as ServicioDelNegocio[]
  const vouchers = vouchersDelViaje(filas)
  const cuotas = (plan?.cuotas ?? []).map(c => ({ monto: c.monto, fecha: c.fecha }))
  const total = Number(base.negocio.precio_aprobado ?? plan?.total ?? 0)
  const cobro = cobroMinimo({ total, pagado: cobradoConfirmado(cobros), cuotas, fechaSalida: viaje.fechas.inicio, hoy, regla })
  const internacional = esInternacional(tipoDestino)
  const docs = await documentosDelContacto(db, workspaceId, contacto?.id ?? null)
  const paquete = leerPaqueteEnviado(base.negocio.metadata)
  return {
    negocioId,
    workspaceId,
    hoy,
    agencia: (((wsRes as { data?: { name?: string } | null }).data?.name) ?? '').trim() || 'Tu agencia',
    cliente: { id: contacto?.id ?? null, nombre, telefono: contacto?.telefono ?? null, correo: contacto?.email ?? null },
    fechaSalida: viaje.fechas.inicio,
    fechaRegreso: viaje.fechas.fin,
    vouchers,
    filas: filas.filter(pideVoucher).map(f => ({ id: f.id, nombre: f.nombre, tieneVoucher: !!f.voucher_ref })),
    cobro,
    mensajeCobro: mensajeCobroMinimo(cobro, nombre.split(/\s+/)[0] ?? ''),
    cuentaRegresiva: textoCuentaRegresiva(cobro, cuotas),
    internacional,
    documentos: docs.map(d => ({ ...d, aviso: avisoVencimiento(d, viaje.fechas.fin, nombre) })),
    faltaDocumento: faltaDocumentos({ internacional, documentos: docs, fechaRegreso: viaje.fechas.fin, nombreContacto: nombre }),
    asistencias: asistenciasDelViaje(filas),
    paquete,
    cambioVoucher: !!paquete && paquete.huella_vouchers !== huellaVouchers(filas),
    gates: gates.filter(g => (GATES_ENTREGA as readonly string[]).includes(g)),
    ...(Object.keys(fallas).length > 0 ? { noSePudoLeer: fallas } : {}),
  }
}

export const TEXTO_FALTA_TIPO_DESTINO = 'Falta saber si el viaje es nacional o internacional (Condiciones del viaje).'

/**
 * Lo que falta para salir de «Documentos y entrega», en palabras (los literales de Noor). Opt-in
 * por `etapas_negocio.config_extra.gates`: una etapa sin estos gates no consulta nada. Con la línea
 * apagada no frena (como el gate de servicios).
 */
export async function evaluarGateEntrega(
  db: Db,
  args: { workspaceId: string; negocioId: string; gates: readonly string[] },
): Promise<string[]> {
  const propios = args.gates.filter(g => (GATES_ENTREGA as readonly string[]).includes(g))
  if (propios.length === 0) return []
  // Falla CERRADO (barrido 2026-10-22): sin poder leer el negocio, la duda frena.
  const base = (await leerNegocioConLinea(db, args.workspaceId, args.negocioId)) as Base | null
  if (!base) return ['No se pudo leer el negocio para revisar la entrega. Intenta de nuevo.']
  if (!configEntrega(base.configLinea).activo) return []
  const v = await armarVista(db, args.workspaceId, base)
  // El cobro mínimo no se pide si el paquete ya salió: su falta de lectura tampoco frena.
  const aRevisar = propios.filter(g => !(g === GATE_COBRO_MINIMO && v.paquete))
  const noLeido = [...new Set(aRevisar.flatMap(g => v.noSePudoLeer?.[g as (typeof GATES_ENTREGA)[number]] ?? []))]
  if (noLeido.length > 0) return [`No se pudo revisar ${noLeido.join(', ')}. Intenta de nuevo.`]
  const falta: string[] = []
  if (propios.includes(GATE_VOUCHERS)) {
    const m = mensajeVouchers(v.vouchers)
    if (m) falta.push(m)
  }
  // Sin el tipo de destino no se sabe si pide pasaporte: se pregunta, no se supone nacional.
  if (propios.includes(GATE_DOCUMENTOS) && v.internacional === null) falta.push(TEXTO_FALTA_TIPO_DESTINO)
  else if (propios.includes(GATE_DOCUMENTOS) && v.faltaDocumento) falta.push(v.faltaDocumento)
  // El paquete enviado ya pasó el cobro mínimo (o la dirección lo envió igual): no se pide dos veces.
  if (propios.includes(GATE_COBRO_MINIMO) && !v.paquete && v.mensajeCobro) falta.push(v.mensajeCobro)
  if (propios.includes(GATE_PAQUETE) && !v.paquete) falta.push('Falta enviar el paquete de viaje.')
  return falta
}
