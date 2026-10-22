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
import { completarFechasDeServicios, leerServiciosDelNegocio, type ServicioDelNegocio } from './servicios-viaje-datos'

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
  // tablero ganan fin, horas y tramos desde su ítem. Una sola vez por fila (`fechas_leidas_at`).
  let filas = leidas
  if (activo && filas && filas.some(faltaCompletar)) {
    const { completadas } = await completarFechasDeServicios(db, { workspaceId: args.workspaceId, negocioId: args.negocioId, soloSinMarca: true })
    if (completadas > 0) filas = (await leerServiciosDelNegocio(db, { workspaceId: args.workspaceId, negocioId: args.negocioId })) ?? filas
  }
  const pidieron = [...new Set((filas ?? []).flatMap(f => [
    ...f.aprobaciones.map(a => a.solicitada_por ?? ''),
    f.fechas_corregidas_por ?? '',
  ]).filter(Boolean))]
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
  }
}

/** Una fila de la cotización que nunca ganó las fechas completas y nadie corrigió a mano. */
export function faltaCompletar(f: Pick<ServicioDelNegocio, 'origen' | 'item_id' | 'fechas_leidas_at' | 'fechas_corregidas_at'>): boolean {
  return f.origen === 'cotizacion' && !!f.item_id && !f.fechas_leidas_at && !f.fechas_corregidas_at
}
