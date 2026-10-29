import 'server-only'

/**
 * El estado derivado de los bloques de autorización, ficha y servicios, leído de donde vive su
 * dato (ver `estado-bloques-derivado.ts`). Lo llama la ficha del negocio para pintar la cabecera
 * y dejar `negocio_bloques.estado` igual al veredicto del gate.
 *
 * Lo que no se puede leer queda sin veredicto (`null`): el bloque se queda como estaba. Mejor una
 * cabecera vieja que un «Completo» o un «Pendiente» inventado.
 */

import { faltaAutorizacionDelNegocio } from '@/lib/autorizacion-datos/envio'
import type { FaltaGate } from '@/lib/autorizacion-datos/estado'
import type { CampoContacto, ValoresContacto } from '@/lib/contactos/campos-contacto'
import { serviciosViajeActivo } from '@/lib/viaje/estado-servicio'
import { configReglasPago } from '@/lib/viaje/reglas-pago'
import { leerServiciosDelNegocio, type ServicioDelNegocio } from '@/lib/viaje/servicios-viaje-datos'
import { estadoFicha, estadoServicios, type EstadoBloque, type TipoDerivado } from './estado-bloques-derivado'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface BloqueConEstadoDerivado {
  instanciaId: string
  tipo: TipoDerivado
  /** Solo la ficha: los campos de su config. */
  campos?: CampoContacto[]
  /** Solo servicios: su etapa pide los vouchers (`vouchers_completos` con la entrega encendida). */
  exigeVouchers?: boolean
}

export async function derivarEstadosDeBloques(
  db: Db,
  args: {
    workspaceId: string
    negocioId: string
    contactoId: string | null
    configLinea: unknown
    bloques: readonly BloqueConEstadoDerivado[]
    /** Lo que ya se leyó de la autorización para el aviso de la ficha: así no se lee dos veces. */
    faltaAutorizacion?: Promise<FaltaGate | 'error' | null>
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
    else if (b.tipo === 'servicios') out.set(b.instanciaId, servicios === null ? null : estadoServicios(servicios.filas, servicios.exigeConfirmacion, b.exigeVouchers === true))
    else out.set(b.instanciaId, ficha === undefined ? null : estadoFicha(b.campos ?? [], ficha))
  }
  return out
}

/** El veredicto del gate `autorizacion_datos`, con los menores del viaje (la regla de `envio.ts`). */
async function veredictoAutorizacion(db: Db, args: { workspaceId: string; negocioId: string; contactoId: string | null; faltaAutorizacion?: Promise<FaltaGate | 'error' | null> }): Promise<EstadoBloque | null> {
  const falta = await (args.faltaAutorizacion ?? faltaAutorizacionDelNegocio(db, args))
  if (falta === 'error') {
    console.error('[estado derivado] no se pudo leer la autorización')
    return null
  }
  return falta === null ? 'completo' : 'pendiente'
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

/** Lo que hace falta para el veredicto de servicios (cada bloque lo juzga con los gates de su etapa). Con la línea apagada no hay veredicto. */
async function veredictoServicios(db: Db, args: { workspaceId: string; negocioId: string; configLinea: unknown }): Promise<{ filas: ServicioDelNegocio[]; exigeConfirmacion: boolean } | null> {
  if (!serviciosViajeActivo(args.configLinea)) return null
  const filas = await leerServiciosDelNegocio(db, { workspaceId: args.workspaceId, negocioId: args.negocioId })
  if (filas === null) return null
  return { filas, exigeConfirmacion: configReglasPago(args.configLinea).exigeConfirmacion }
}
