import 'server-only'

/**
 * Lo que el tablero de servicios necesita del servidor (F0 + F3): las filas con sus pagos y
 * aprobaciones, los medios de pago del espacio, las reglas de la línea, lo cobrado al cliente y
 * los nombres de quien pidió cada aprobación.
 *
 * `workspaces.config_extra` es de servidor: se lee con el cliente de servicio, acotado al espacio
 * de la sesión (mismo criterio que `cuentasDelNegocio`).
 */

import { createServiceClient } from '@/lib/supabase/server'
import { cobradoConfirmado } from '@/lib/cobros/saldo-negocio'
import type { DatosBloqueServicios } from './bloque-servicios'
import { aprobadoresDeLinea, serviciosViajeActivo } from './estado-servicio'
import { configReglasPago, mediosPagoProveedor, type MedioPagoProveedor } from './reglas-pago'
import { completarFechasDeServicios, leerServiciosDelNegocio, vueloSinNumeroDeRegreso, type ServicioDelNegocio } from './servicios-viaje-datos'
import { configHitos, type Hito } from './hitos'
import { hitosDelNegocio } from './hitos-datos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Medios de pago a proveedores del espacio. Vacío si no hay o no se pueden leer. */
export async function mediosDelEspacio(workspaceId: string): Promise<MedioPagoProveedor[]> {
  const { data } = await (createServiceClient() as Db).from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle()
  return mediosPagoProveedor((data as { config_extra?: unknown } | null)?.config_extra)
}

/** Lo cobrado confirmado al cliente y el precio aprobado del negocio. */
export async function plataDelCliente(db: Db, workspaceId: string, negocioId: string): Promise<{ cobrado: number; precio: number }> {
  const [cobrosRes, negRes] = await Promise.all([
    db.from('cobros').select('*').eq('negocio_id', negocioId).eq('workspace_id', workspaceId),
    db.from('negocios').select('precio_aprobado, precio_estimado').eq('id', negocioId).eq('workspace_id', workspaceId).maybeSingle(),
  ])
  const neg = negRes.data as { precio_aprobado?: number | null; precio_estimado?: number | null } | null
  return {
    cobrado: cobradoConfirmado((cobrosRes.data ?? []) as Parameters<typeof cobradoConfirmado>[0]),
    precio: Number(neg?.precio_aprobado ?? neg?.precio_estimado ?? 0) || 0,
  }
}

export async function datosDelTablero(
  db: Db,
  args: {
    workspaceId: string
    negocioId: string
    configLinea: unknown
    hayCotizacionAceptada: boolean
    quien: DatosBloqueServicios['quien']
  },
): Promise<DatosBloqueServicios> {
  const activo = serviciosViajeActivo(args.configLinea)
  const [leidas, medios, plata] = await Promise.all([
    leerServiciosDelNegocio(db, { workspaceId: args.workspaceId, negocioId: args.negocioId }),
    mediosDelEspacio(args.workspaceId).catch(() => [] as MedioPagoProveedor[]),
    plataDelCliente(db, args.workspaceId, args.negocioId).catch(() => ({ cobrado: 0, precio: 0 })),
  ])
  // Filas generadas antes de las fechas completas (2026-10-21): la primera vez que se abre el
  // tablero ganan fin, horas y tramos desde su ítem. Una sola vez por fila (`fechas_leidas_at`), salvo
  // el vuelo sin número de regreso (2026-10-22), que se relee hasta que su ítem lo dé.
  let filas = leidas
  if (activo && filas && filas.some(faltaCompletar)) {
    const { completadas } = await completarFechasDeServicios(db, { workspaceId: args.workspaceId, negocioId: args.negocioId, soloSinMarca: true })
    if (completadas > 0) filas = (await leerServiciosDelNegocio(db, { workspaceId: args.workspaceId, negocioId: args.negocioId })) ?? filas
  }
  // Hitos de gestión (píldoras y «Sigue:»), solo con `config_extra.hitos.activo`. Si no se pueden
  // calcular, el tablero se ve como siempre.
  const hitos = configHitos(args.configLinea).activo ? await hitosDelTablero(db, args).catch(() => [] as Hito[]) : []
  const pidieron = [...new Set([
    ...(filas ?? []).flatMap(f => [...f.aprobaciones.map(a => a.solicitada_por ?? ''), f.fechas_corregidas_por ?? '']),
    ...hitos.map(h => h.marca?.hecho_por ?? ''),
  ].filter(Boolean))]
  const nombres: Record<string, string> = {}
  if (pidieron.length > 0) {
    const { data } = await db.from('staff').select('id, full_name').eq('workspace_id', args.workspaceId).in('id', pidieron)
    for (const s of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
      const nombre = (s.full_name ?? '').trim().split(/\s+/)[0]
      if (nombre) nombres[s.id] = nombre
    }
  }
  return {
    activo,
    hayCotizacionAceptada: args.hayCotizacionAceptada,
    filas: filas ?? [],
    quien: { ...args.quien, aprobadores: args.quien.aprobadores ?? aprobadoresDeLinea(args.configLinea) },
    medios,
    reglas: configReglasPago(args.configLinea),
    cobradoCliente: plata.cobrado,
    precioAprobado: plata.precio,
    nombres,
    ...(hitos.length > 0 ? { hitos } : {}),
  }
}

/** Los hitos de las filas del negocio (sin los del viaje: esos viven en la agenda). */
async function hitosDelTablero(db: Db, args: { workspaceId: string; negocioId: string; configLinea: unknown }): Promise<Hito[]> {
  const { data } = await db.from('negocios').select('linea_id').eq('id', args.negocioId).eq('workspace_id', args.workspaceId).maybeSingle()
  const lineaId = (data as { linea_id?: string | null } | null)?.linea_id
  if (!lineaId) return []
  const { hitos } = await hitosDelNegocio(db, { workspaceId: args.workspaceId, negocioId: args.negocioId, linea: { id: lineaId, config_extra: args.configLinea } })
  return hitos.filter(h => h.servicioId)
}

/** Una fila de la cotización que nunca ganó las fechas completas y nadie corrigió a mano. */
export function faltaCompletar(
  f: Pick<ServicioDelNegocio, 'origen' | 'item_id' | 'fechas_leidas_at' | 'fechas_corregidas_at'> & Partial<Pick<ServicioDelNegocio, 'tipo' | 'tramos'>>,
): boolean {
  if (f.origen !== 'cotizacion' || !f.item_id || f.fechas_corregidas_at) return false
  // Un vuelo leído antes del número por tramo (2026-10-22) se vuelve a leer aunque tenga la marca.
  return !f.fechas_leidas_at || vueloSinNumeroDeRegreso({ tipo: f.tipo ?? '', tramos: f.tramos ?? null })
}
