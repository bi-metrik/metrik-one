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

import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { PDFDocument } from 'pdf-lib'
import { createServiceClient } from '@/lib/supabase/server'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { cobradoConfirmado } from '@/lib/cobros/saldo-negocio'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { leerDocumentoCliente, textoParaElViaje } from '@/lib/cotizaciones/documento-cliente'
import { parsearReferenciaOne } from '@/lib/almacenamiento/referencia'
import PaqueteViajePDF from '@/lib/pdf/paquete-viaje-pdf'
import { configPlanPagos } from './plan-pagos'
import { cobrosDelNegocio, leerNegocioConLinea, planAcordado } from './confirmacion-datos'
import { leerServiciosDelNegocio, type ServicioDelNegocio } from './servicios-viaje-datos'
import {
  GATES_ENTREGA,
  GATE_COBRO_MINIMO,
  GATE_DOCUMENTOS,
  GATE_PAQUETE,
  GATE_VOUCHERS,
  avisoVencimiento,
  cobroMinimo,
  configEntrega,
  esInternacional,
  faltaDocumentos,
  fechaConAnio,
  huellaVouchers,
  itinerarioDesdeServicios,
  leerPaqueteEnviado,
  mensajeCobroMinimo,
  mensajeVouchers,
  pideVoucher,
  textoCuentaRegresiva,
  vouchersDelViaje,
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
  paquete: PaqueteEnviado | null
  cambioVoucher: boolean
  /** Los gates de la etapa actual que son de esta etapa. */
  gates: string[]
}

interface Base {
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
  const { data } = await db.from('negocio_bloques').select('destino_tipo:data->destino_tipo').eq('negocio_id', negocioId)
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
  const [gates, servicios, plan, cobros, { viaje }, tipoDestino, contactoRes, wsRes] = await Promise.all([
    gatesDeEtapa(db, base.negocio.etapa_actual_id),
    leerServiciosDelNegocio(db, { workspaceId, negocioId }),
    planAcordado(db, negocioId).catch(() => null),
    cobrosDelNegocio(db, workspaceId, negocioId).catch(() => []),
    leerViajeDelNegocio(db, negocioId),
    destinoTipo(db, negocioId),
    base.negocio.contacto_id
      ? db.from('contactos').select('id, nombre, email, telefono').eq('id', base.negocio.contacto_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
  ])
  const contacto = (contactoRes.data ?? null) as { id: string; nombre: string | null; email: string | null; telefono: string | null } | null
  const nombre = (contacto?.nombre ?? '').trim()
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
    paquete,
    cambioVoucher: !!paquete && paquete.huella_vouchers !== huellaVouchers(filas),
    gates: gates.filter(g => (GATES_ENTREGA as readonly string[]).includes(g)),
  }
}

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
  const base = (await leerNegocioConLinea(db, args.workspaceId, args.negocioId)) as Base | null
  if (!base || !configEntrega(base.configLinea).activo) return []
  const v = await armarVista(db, args.workspaceId, base)
  const falta: string[] = []
  if (propios.includes(GATE_VOUCHERS)) {
    const m = mensajeVouchers(v.vouchers)
    if (m) falta.push(m)
  }
  if (propios.includes(GATE_DOCUMENTOS) && v.faltaDocumento) falta.push(v.faltaDocumento)
  // El paquete enviado ya pasó el cobro mínimo (o la dirección lo envió igual): no se pide dos veces.
  if (propios.includes(GATE_COBRO_MINIMO) && !v.paquete && v.mensajeCobro) falta.push(v.mensajeCobro)
  if (propios.includes(GATE_PAQUETE) && !v.paquete) falta.push('Falta enviar el paquete de viaje.')
  return falta
}

// ── El paquete en PDF ────────────────────────────────────────────────────────

const MAX_VOUCHER = 15 * 1024 * 1024

async function bytesDeReferencia(ref: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const r = parsearReferenciaOne(ref)
  if (!r) return null
  const { data, error } = await (createServiceClient() as Db).storage.from(r.bucket).download(r.path)
  if (error || !data) return null
  const blob = data as Blob
  if (blob.size > MAX_VOUCHER) return null
  const lower = r.path.toLowerCase()
  const mime = blob.type || (lower.endsWith('.pdf') ? 'application/pdf' : lower.endsWith('.png') ? 'image/png' : 'image/jpeg')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime }
}

/** Pega un voucher al final: un PDF entra con sus hojas; una foto, como una hoja A4. */
async function anexar(doc: PDFDocument, v: { bytes: Uint8Array; mime: string }): Promise<boolean> {
  try {
    if (v.mime === 'application/pdf') {
      const src = await PDFDocument.load(v.bytes, { ignoreEncryption: true })
      const paginas = await doc.copyPages(src, src.getPageIndices())
      paginas.forEach(p => doc.addPage(p))
      return true
    }
    const img = v.mime === 'image/png' ? await doc.embedPng(v.bytes) : await doc.embedJpg(v.bytes)
    const pagina = doc.addPage([595.28, 841.89])
    const escala = Math.min(515 / img.width, 760 / img.height, 1)
    const w = img.width * escala
    const h = img.height * escala
    pagina.drawImage(img, { x: (595.28 - w) / 2, y: (841.89 - h) / 2, width: w, height: h })
    return true
  } catch (e) {
    console.warn('[entrega] un voucher no se pudo anexar:', e instanceof Error ? e.message : e)
    return false
  }
}

export interface PaqueteArmado {
  pdf: Buffer
  filename: string
  huella: string
  /** Vouchers que no se pudieron anexar (formato que no se lee): se nombran, no se pierden. */
  sinAnexar: string[]
}

export async function armarPaquetePdf(db: Db, workspaceId: string, negocioId: string, nota: string | null): Promise<PaqueteArmado | null> {
  const base = (await leerNegocioConLinea(db, workspaceId, negocioId)) as Base | null
  if (!base) return null
  const cfg = configEntrega(base.configLinea)
  if (!cfg.activo) return null
  const [servicios, { viaje }, contactoRes, wsRes, cotRes, comercialRes] = await Promise.all([
    leerServiciosDelNegocio(db, { workspaceId, negocioId }),
    leerViajeDelNegocio(db, negocioId),
    base.negocio.contacto_id
      ? db.from('contactos').select('nombre').eq('id', base.negocio.contacto_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('workspaces').select('name, color_primario').eq('id', workspaceId).maybeSingle(),
    db.from('cotizaciones').select('documento_cliente').eq('negocio_id', negocioId).eq('estado', 'aceptada').order('created_at', { ascending: false }).limit(1),
    db.from('negocio_responsables').select('rol, staff!negocio_responsables_staff_id_fkey(full_name)').eq('negocio_id', negocioId),
  ])
  const filas = (servicios ?? []) as ServicioDelNegocio[]
  const ws = (wsRes.data ?? {}) as { name?: string; color_primario?: string | null }
  const agencia = (ws.name ?? '').trim() || 'Tu agencia'
  const responsables = (comercialRes.data ?? []) as Array<{ rol?: string | null; staff?: { full_name?: string | null } | null }>
  const comercial = (responsables.find(r => r.rol === 'comercial') ?? responsables[0])?.staff?.full_name?.trim() || null
  const cot = ((cotRes.data ?? []) as Array<{ documento_cliente?: unknown }>)[0]
  const texto = textoParaElViaje(leerDocumentoCliente(cot?.documento_cliente))

  // Vouchers: cada archivo al final del mismo PDF, en el orden del viaje.
  const conVoucher = filas.filter(f => pideVoucher(f) && f.voucher_ref)
  const archivos = await Promise.all(conVoucher.map(f => bytesDeReferencia(f.voucher_ref as string)))

  const fechas = viaje.fechas.inicio
    ? [viaje.fechas.inicio, viaje.fechas.fin].filter((x): x is string => !!x).map(fechaConAnio).join(' – ')
    : null
  const portada = await renderToBuffer(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createElement(PaqueteViajePDF, {
      agencia,
      colorPrimario: ws.color_primario ?? null,
      viajero: ((contactoRes.data as { nombre?: string | null } | null)?.nombre ?? '').trim(),
      titulo: (texto.titular?.trim() || base.negocio.nombre || viaje.destino || 'Tu viaje').trim(),
      fechas,
      itinerario: itinerarioDesdeServicios(filas, viaje.fechas.inicio),
      vouchers: filas.filter(pideVoucher).map(f => ({
        nombre: f.nombre,
        detalle: [f.proveedor_nombre, f.localizador ? `localizador ${f.localizador}` : null].filter(Boolean).join(' · ') || null,
        adjunto: !!f.voucher_ref && !!archivos[conVoucher.indexOf(f)],
      })),
      antesDeViajar: texto.antesDeViajar ?? [],
      contactosEmergencia: cfg.contactosEmergencia,
      nota: nota?.trim() || null,
      comercial,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  )
  const doc = await PDFDocument.load(portada)
  const sinAnexar: string[] = []
  for (let i = 0; i < conVoucher.length; i++) {
    const a = archivos[i]
    if (!a || !(await anexar(doc, a))) sinAnexar.push(conVoucher[i].nombre)
  }
  const pdf = Buffer.from(await doc.save())
  const slug = (base.negocio.nombre ?? 'viaje').normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'viaje'
  return { pdf, filename: `paquete-${slug}.pdf`, huella: huellaVouchers(filas), sinAnexar }
}
