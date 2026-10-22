/**
 * Lee de la base lo que los hitos necesitan (`hitos.ts`) para un conjunto de negocios. Lo usan la
 * Agenda (cliente de sesión, RLS por workspace), las acciones de los hitos, el tablero de servicios
 * (píldoras) y el motor de recordatorios (service_role, acotado a las líneas encendidas).
 *
 * No es `'use server'` ni `server-only` a propósito: recibe el cliente de quien llama, que ya pasó
 * su guarda (mismo criterio que `servicios-viaje-datos.ts`).
 *
 * De dónde sale cada dato:
 *   · fechas y tramos de los servicios: `negocio_servicios` (PR de fechas #1236);
 *   · salida, regreso, destino y si es internacional: el bloque de la etapa 1 (`negocio_bloques.data`);
 *   · día en que el cliente confirmó: la creación de las filas de servicio que nacen al aceptar la
 *     cotización (`origen = 'cotizacion'`, la más antigua). Es la huella que deja
 *     `aceptarCotizacionNegocio` en una línea con servicios del viaje; sin filas, «Falta la fecha»;
 *   · documentos de los viajeros: `contacto_documentos` vigentes del contacto del negocio (el mismo
 *     criterio del gate de documentos, `faltaDocumentos`);
 *   · marcas: `negocio_hitos`.
 */

import { todayBogotaISO } from '@/lib/dates/bogota'
import { aprobadoresDeLinea } from './estado-servicio'
import { esInternacional, faltaDocumentos, type DocumentoViajero } from './entrega'
import { configHitos, hitosDelViaje, type ConfigHitos, type Hito, type MarcaHito, type ServicioHitos, type ViajeHitos } from './hitos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const TANDA = 150
async function porTandas<T>(ids: string[], leer: (t: string[]) => Promise<T[]>): Promise<T[]> {
  const tandas: string[][] = []
  for (let i = 0; i < ids.length; i += TANDA) tandas.push(ids.slice(i, i + TANDA))
  return (await Promise.all(tandas.map(leer))).flat()
}

function filas<T>(r: { data: T[] | null; error?: { message: string; code?: string } | null }, que: string, tolerar = false): T[] {
  if (r.error) {
    if (tolerar) return []
    throw new Error(`hitos: no se pudo leer ${que}: ${r.error.message}`)
  }
  return (r.data ?? []) as T[]
}

const fecha = (v: unknown): string | null => (typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(v.trim())?.[1] ?? null : null)
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export interface LineaHitos {
  id: string
  config_extra: unknown
}

/** Las líneas con `config_extra.hitos.activo`. */
export function lineasConHitos<T extends LineaHitos>(lineas: readonly T[]): T[] {
  return lineas.filter(l => configHitos(l.config_extra).activo)
}

/**
 * Los viajes con todo lo que los hitos necesitan. `negocioIds` acota a esos negocios (acciones,
 * tablero); sin él, todos los abiertos de las líneas.
 */
export async function leerViajesParaHitos(
  db: Db,
  args: { lineas: readonly LineaHitos[]; workspaceId?: string | null; negocioIds?: readonly string[] },
): Promise<ViajeHitos[]> {
  const lineas = lineasConHitos(args.lineas)
  if (lineas.length === 0) return []
  const lineaIds = lineas.map(l => l.id)
  const configDe = new Map<string, { cat: ConfigHitos; aprobadores: string[] }>(
    lineas.map(l => [l.id, { cat: configHitos(l.config_extra), aprobadores: aprobadoresDeLinea(l.config_extra) }]),
  )

  type Neg = { id: string; workspace_id: string; nombre: string; codigo: string | null; linea_id: string; contacto_id: string | null; etapa_actual_id: string | null; estado: string; metadata: Record<string, unknown> | null }
  const negocios = args.negocioIds
    ? await porTandas([...args.negocioIds], async t => {
        let q = db.from('negocios').select('id, workspace_id, nombre, codigo, linea_id, contacto_id, etapa_actual_id, estado, metadata').in('id', t).in('linea_id', lineaIds)
        if (args.workspaceId) q = q.eq('workspace_id', args.workspaceId)
        return filas<Neg>(await q, 'negocios')
      })
    : await porTandas(lineaIds, async t => {
        let q = db.from('negocios').select('id, workspace_id, nombre, codigo, linea_id, contacto_id, etapa_actual_id, estado, metadata').in('linea_id', t).eq('estado', 'abierto')
        if (args.workspaceId) q = q.eq('workspace_id', args.workspaceId)
        return filas<Neg>(await q, 'negocios')
      })
  if (negocios.length === 0) return []
  const ids = negocios.map(n => n.id)
  const etapaIds = [...new Set(negocios.map(n => n.etapa_actual_id).filter((x): x is string => !!x))]
  const contactoIds = [...new Set(negocios.map(n => n.contacto_id).filter((x): x is string => !!x))]

  type Svc = ServicioHitos & { negocio_id: string; origen: string | null; created_at: string | null }
  const [etapas, responsables, servicios, bloques, contactos, documentos, marcas] = await Promise.all([
    porTandas(etapaIds, async t => filas<{ id: string; numero: number }>(await db.from('etapas_negocio').select('id, numero').in('id', t), 'etapas')),
    porTandas(ids, async t => filas<{ negocio_id: string; staff_id: string; rol: string | null }>(await db.from('negocio_responsables').select('negocio_id, staff_id, rol').in('negocio_id', t), 'responsables')),
    porTandas(ids, async t => filas<Svc>(
      await db.from('negocio_servicios')
        .select('id, negocio_id, tipo, nombre, estado, responsable_staff_id, fecha_servicio, hora_inicio, fecha_fin, hora_fin, tramos, voucher_ref, confirmacion_ref, origen, created_at')
        .in('negocio_id', t),
      'servicios',
    )),
    porTandas(ids, async t => filas<{ negocio_id: string; fecha_salida: unknown; fecha_regreso: unknown; destino: unknown; destino_tipo: unknown }>(
      await db.from('negocio_bloques').select('negocio_id, fecha_salida:data->fecha_salida, fecha_regreso:data->fecha_regreso, destino:data->destino, destino_tipo:data->destino_tipo').in('negocio_id', t),
      'bloques',
    )),
    porTandas(contactoIds, async t => filas<{ id: string; nombre: string | null; telefono: string | null }>(await db.from('contactos').select('id, nombre, telefono').in('id', t), 'contactos')),
    // Sin la migración de documentos la tabla no existe: el hito de documentos queda pendiente a mano.
    porTandas(contactoIds, async t => filas<DocumentoViajero & { contacto_id: string }>(
      await db.from('contacto_documentos').select('id, contacto_id, tipo, numero, nombre_en_documento, pais, fecha_vencimiento, archivo_ref').in('contacto_id', t).eq('vigente', true),
      'documentos', true,
    )),
    // Sin esta migración aplicada la tabla no existe: sin marcas (todo pendiente), nada se rompe.
    porTandas(ids, async t => filas<MarcaHito & { negocio_id: string }>(
      await db.from('negocio_hitos').select('negocio_id, servicio_id, tramo, hito_id, fecha_objetivo, estado, evidencia_ref, nota, hecho_por, hecho_at').in('negocio_id', t),
      'marcas', true,
    )),
  ])
  const numeroDe = new Map(etapas.map(e => [e.id, e.numero]))
  const contactoDe = new Map(contactos.map(c => [c.id, c]))

  return negocios.map(n => {
    const cfg = configDe.get(n.linea_id)!
    const b = bloques.filter(x => x.negocio_id === n.id)
    const resp = responsables.filter(r => r.negocio_id === n.id)
    const svs = servicios.filter(s => s.negocio_id === n.id)
    const contacto = n.contacto_id ? contactoDe.get(n.contacto_id) : undefined
    const internacional = esInternacional(b.map(x => x.destino_tipo).find(v => typeof v === 'string' && v.trim()) ?? null)
    const salida = b.map(x => fecha(x.fecha_salida)).find(Boolean) ?? null
    const regreso = b.map(x => fecha(x.fecha_regreso)).find(Boolean) ?? null
    const docs = n.contacto_id ? documentos.filter(d => d.contacto_id === n.contacto_id) : []
    const nombre = (contacto?.nombre ?? '').trim()
    const documentosCompletos = internacional === true
      ? faltaDocumentos({ internacional, documentos: docs, fechaRegreso: regreso, nombreContacto: nombre }) === null
      : docs.length > 0
    const creadas = svs.filter(s => s.origen === 'cotizacion' && s.created_at).map(s => s.created_at as string).sort()
    return {
      id: n.id,
      workspaceId: n.workspace_id,
      nombre: n.codigo ? `${n.codigo} — ${n.nombre}` : n.nombre,
      cliente: nombre || n.nombre,
      clienteTelefono: contacto?.telefono ?? null,
      estado: n.estado,
      etapaNumero: n.etapa_actual_id ? numeroDe.get(n.etapa_actual_id) ?? null : null,
      esPrueba: (n.metadata as { es_prueba?: unknown } | null)?.es_prueba === true,
      salida,
      regreso,
      internacional,
      destino: b.map(x => texto(x.destino)).find(Boolean) ?? null,
      confirmadoEl: creadas[0] ? todayBogotaISO(new Date(creadas[0])) : null,
      documentosCompletos,
      comercialStaffId: resp.find(r => r.rol === 'comercial')?.staff_id ?? null,
      operacionesStaffId: resp.find(r => r.rol === 'operaciones')?.staff_id ?? null,
      aprobadoresStaffIds: cfg.aprobadores,
      catalogo: cfg.cat,
      servicios: svs,
      marcas: marcas.filter(m => m.negocio_id === n.id).map(m => ({ ...m, fecha_objetivo: String(m.fecha_objetivo).slice(0, 10) })),
    }
  })
}

/** Los hitos de un negocio (acciones y tablero). Vacío si la línea no los tiene encendidos. */
export async function hitosDelNegocio(
  db: Db,
  args: { workspaceId: string; negocioId: string; linea: LineaHitos; hoy?: string },
): Promise<{ viaje: ViajeHitos | null; hitos: Hito[] }> {
  const [viaje] = await leerViajesParaHitos(db, { lineas: [args.linea], workspaceId: args.workspaceId, negocioIds: [args.negocioId] })
  if (!viaje) return { viaje: null, hitos: [] }
  return { viaje, hitos: hitosDelViaje(viaje, args.hoy ?? todayBogotaISO()) }
}

/** Primer nombre por staff id (para la inicial, el contador y «hecho por»). */
export async function nombresDeStaff(db: Db, workspaceId: string | null, ids: readonly string[]): Promise<Record<string, string>> {
  const unicos = [...new Set(ids.filter(Boolean))]
  if (unicos.length === 0) return {}
  const out: Record<string, string> = {}
  const leidas = await porTandas(unicos, async t => {
    let q = db.from('staff').select('id, full_name').in('id', t)
    if (workspaceId) q = q.eq('workspace_id', workspaceId)
    return filas<{ id: string; full_name: string | null }>(await q, 'staff', true)
  })
  for (const s of leidas) {
    const n = (s.full_name ?? '').trim().split(/\s+/)[0]
    if (n) out[s.id] = n
  }
  return out
}
