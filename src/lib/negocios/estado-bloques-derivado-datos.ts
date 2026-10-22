import 'server-only'

/**
 * El estado derivado de los bloques de autorización, ficha y servicios, leído de donde vive su
 * dato (ver `estado-bloques-derivado.ts`). Lo llama la ficha del negocio para pintar la cabecera
 * y dejar `negocio_bloques.estado` igual al veredicto del gate.
 *
 * Lo que no se puede leer queda sin veredicto (`null`): el bloque se queda como estaba. Mejor una
 * cabecera vieja que un «Completo» o un «Pendiente» inventado.
 */

import { estadoDelContacto } from '@/lib/autorizacion-datos/servidor'
import { hayMenores } from '@/lib/autorizacion-datos/estado'
import type { CampoContacto, ValoresContacto } from '@/lib/contactos/campos-contacto'
import { serviciosViajeActivo } from '@/lib/viaje/estado-servicio'
import { configReglasPago } from '@/lib/viaje/reglas-pago'
import { leerServiciosDelNegocio } from '@/lib/viaje/servicios-viaje-datos'
import { estadoAutorizacion, estadoFicha, estadoServicios, type EstadoBloque, type TipoDerivado } from './estado-bloques-derivado'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface BloqueConEstadoDerivado {
  instanciaId: string
  tipo: TipoDerivado
  /** Solo la ficha: los campos de su config. */
  campos?: CampoContacto[]
}

export async function derivarEstadosDeBloques(
  db: Db,
  args: {
    workspaceId: string
    negocioId: string
    contactoId: string | null
    configLinea: unknown
    bloques: readonly BloqueConEstadoDerivado[]
  },
): Promise<Map<string, EstadoBloque | null>> {
  const out = new Map<string, EstadoBloque | null>()
  if (args.bloques.length === 0) return out
  const hay = (t: TipoDerivado) => args.bloques.some(b => b.tipo === t)

  const [autorizacion, ficha, servicios] = await Promise.all([
    hay('autorizacion') ? veredictoAutorizacion(db, args) : Promise.resolve(null),
    hay('ficha') ? valoresDelContacto(db, args) : Promise.resolve(undefined),
    hay('servicios') ? veredictoServicios(db, args) : Promise.resolve(null),
  ])

  for (const b of args.bloques) {
    if (b.tipo === 'autorizacion') out.set(b.instanciaId, autorizacion)
    else if (b.tipo === 'servicios') out.set(b.instanciaId, servicios)
    else out.set(b.instanciaId, ficha === undefined ? null : estadoFicha(b.campos ?? [], ficha))
  }
  return out
}

/** El veredicto del gate `autorizacion_datos`, con los menores del viaje. */
async function veredictoAutorizacion(db: Db, args: { workspaceId: string; negocioId: string; contactoId: string | null }): Promise<EstadoBloque | null> {
  if (!args.contactoId) return estadoAutorizacion(null, false)
  const [{ estado, error }, bloques] = await Promise.all([
    estadoDelContacto(args.workspaceId, args.contactoId),
    db.from('negocio_bloques').select('data').eq('negocio_id', args.negocioId),
  ])
  if (error || bloques.error) {
    console.error('[estado derivado] no se pudo leer la autorización:', error ?? bloques.error?.message)
    return null
  }
  const menores = hayMenores(((bloques.data ?? []) as Array<{ data: Record<string, unknown> | null }>).map(b => b.data))
  return estadoAutorizacion(estado, menores)
}

/** Los valores del contacto. `null` = no hay contacto; `undefined` = no se pudo leer. */
async function valoresDelContacto(db: Db, args: { workspaceId: string; contactoId: string | null }): Promise<ValoresContacto | null | undefined> {
  if (!args.contactoId) return null
  const { data, error } = await db
    .from('contactos')
    .select('nombre, email, telefono, rol, segmento, custom_data')
    .eq('id', args.contactoId)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle()
  if (error) {
    console.error('[estado derivado] no se pudo leer el contacto:', error.message)
    return undefined
  }
  if (!data) return null
  const c = data as ValoresContacto & { custom_data: Record<string, unknown> | null }
  return { ...c, custom_data: c.custom_data ?? {} }
}

/** El veredicto del gate `servicios_listos`. Con la línea apagada no hay veredicto. */
async function veredictoServicios(db: Db, args: { workspaceId: string; negocioId: string; configLinea: unknown }): Promise<EstadoBloque | null> {
  if (!serviciosViajeActivo(args.configLinea)) return null
  const filas = await leerServiciosDelNegocio(db, { workspaceId: args.workspaceId, negocioId: args.negocioId })
  if (filas === null) return null
  return estadoServicios(filas, configReglasPago(args.configLinea).exigeConfirmacion)
}
