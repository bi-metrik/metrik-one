import 'server-only'

/**
 * La autorización de datos frena ENVIAR la cotización, no armarla (reunión con Trappvel del
 * 2026-10-22: el cliente puede tardar en autorizar y la agencia necesita ir armando la
 * cotización mientras tanto).
 *
 * Hasta ese día el gate `autorizacion_datos` estaba en la salida de Solicitud (E1): sin la firma
 * del cliente el negocio no llegaba a Cotización. Ahora el gate pasa a la salida de Cotización
 * (E2, SQL de configuración en `sql/trappvel/`) y, además, «Enviar», «Enviar por pasos» y
 * «Aprobar» la exigen aquí: lo que sale al cliente y todo lo que viene después (reservas, cobros)
 * queda detrás de la autorización, como dice la ley de datos.
 *
 * Aplica en la línea que declara el gate en CUALQUIERA de sus etapas. Así el código vale antes y
 * después de mover el gate: sin declararlo, nada cambia (SOENA, AFI y demás).
 *
 * Falla CERRADO, como el gate: si no se puede leer, no sale. Es un control legal.
 */

import { estadoDelContacto } from './servidor'
import { faltaParaAvanzar, GATE_AUTORIZACION, hayMenores, type FaltaGate } from './estado'
import { MENSAJE_ENVIO_PENDIENTE } from './mensajes'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

/** Lo que se le dice a quien intenta enviar. */
export const MENSAJE_ENVIO: Record<FaltaGate | 'error', string> = {
  sin_contacto: 'El negocio no tiene contacto: asígnale el cliente y pídele la autorización de datos antes de enviar la cotización.',
  generales: MENSAJE_ENVIO_PENDIENTE,
  menores: 'El viaje lleva menores y el cliente no autorizó el uso de sus datos: la cotización se puede armar, pero no enviar. Envíale el link desde «Autorización de datos».',
  error: 'No se pudo revisar la autorización de datos del cliente. Vuelve a intentarlo.',
}

export interface VeredictoEnvio {
  /** La línea del negocio declara el gate en alguna etapa. Sin eso, nada que revisar. */
  aplica: boolean
  /** Qué falta. `null` = autorizado (o no aplica). */
  falta: FaltaGate | 'error' | null
}

/** ¿La línea declara `autorizacion_datos` en alguna de sus etapas? */
export function lineaExigeAutorizacion(etapas: ReadonlyArray<{ config_extra?: unknown } | null | undefined>): boolean {
  return etapas.some(e => {
    const gates = (e?.config_extra as { gates?: unknown } | null | undefined)?.gates
    return Array.isArray(gates) && gates.includes(GATE_AUTORIZACION)
  })
}

/** Lo que hace falta del negocio: su contacto y las etapas de su línea, en UNA ida. */
export const SELECT_NEGOCIO_ENVIO = 'linea_id, contacto_id, lineas_negocio(etapas_negocio(config_extra))'

/**
 * El mismo negocio embebido en la lectura de la cotización que ya hacen «Enviar» y «Aprobar»: así
 * revisar si la línea pide la autorización no les suma una ida (el presupuesto de C0).
 */
export const EMBED_NEGOCIO_ENVIO = `negocio_envio:negocios!cotizaciones_negocio_id_fkey(${SELECT_NEGOCIO_ENVIO})`

export interface NegocioParaEnvio {
  linea_id: string | null
  contacto_id: string | null
  lineas_negocio?: { etapas_negocio?: { config_extra?: unknown }[] | null } | null
}

/**
 * El veredicto con el negocio ya leído. Solo si la línea declara el gate se pregunta por la
 * autorización (la RPC y los menores del viaje).
 */
export async function autorizacionDelNegocioLeido(
  supabase: Cliente,
  args: { workspaceId: string; negocioId: string; negocio: NegocioParaEnvio | null },
): Promise<VeredictoEnvio> {
  const n = args.negocio
  if (!n?.linea_id) return { aplica: false, falta: null }
  if (!lineaExigeAutorizacion(n.lineas_negocio?.etapas_negocio ?? [])) return { aplica: false, falta: null }
  return { aplica: true, falta: await faltaAutorizacionDelNegocio(supabase, { workspaceId: args.workspaceId, negocioId: args.negocioId, contactoId: n.contacto_id }) }
}

/**
 * Qué le falta a la autorización del negocio, con la línea ya sabida que la exige: la RPC del
 * contacto y los menores del viaje, la regla del gate (`faltaParaAvanzar`). La comparten «Enviar»,
 * «Aprobar», «El cliente confirmó» y la ficha (el aviso y el estado del bloque), para que el aviso
 * y el bloqueo no puedan decir cosas distintas. `'error'` = no se pudo leer.
 */
export async function faltaAutorizacionDelNegocio(
  supabase: Cliente,
  args: { workspaceId: string; negocioId: string; contactoId: string | null },
): Promise<FaltaGate | 'error' | null> {
  if (!args.contactoId) return 'sin_contacto'
  const [{ estado, error: errEstado }, bloques] = await Promise.all([
    estadoDelContacto(args.workspaceId, args.contactoId),
    supabase.from('negocio_bloques').select('data').eq('negocio_id', args.negocioId),
  ])
  if (errEstado || bloques.error) return 'error'
  const menores = hayMenores(((bloques.data ?? []) as Array<{ data: Record<string, unknown> | null }>).map(b => b.data))
  return faltaParaAvanzar(estado, { menores })
}

/**
 * ¿Se avisa que falta la autorización? Sí cuando la regla dice qué falta; no cuando está firmada,
 * la línea no la pide (`null`) o no se pudo leer (`'error'`: no se afirma lo que no se sabe).
 */
export function autorizacionEstaPendiente(falta: FaltaGate | 'error' | null): boolean {
  return falta === 'sin_contacto' || falta === 'generales' || falta === 'menores'
}

/** El veredicto para un negocio, leído de la base. */
export async function autorizacionParaEnviar(
  supabase: Cliente,
  args: { workspaceId: string; negocioId: string | null },
): Promise<VeredictoEnvio> {
  if (!args.negocioId) return { aplica: false, falta: null }
  const { data: neg, error } = await supabase
    .from('negocios')
    .select(SELECT_NEGOCIO_ENVIO)
    .eq('id', args.negocioId)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle()
  if (error) return { aplica: true, falta: 'error' }
  return autorizacionDelNegocioLeido(supabase, { workspaceId: args.workspaceId, negocioId: args.negocioId, negocio: neg as NegocioParaEnvio | null })
}

/**
 * El motivo con el negocio embebido en la cotización (`EMBED_NEGOCIO_ENVIO`). Si el embebido no
 * llegó (sin negocio), no aplica.
 */
export async function motivoAutorizacionDeCotizacion(
  supabase: Cliente,
  args: { workspaceId: string; negocioId: string | null; negocio: unknown },
): Promise<string | null> {
  if (!args.negocioId) return null
  const v = await autorizacionDelNegocioLeido(supabase, { workspaceId: args.workspaceId, negocioId: args.negocioId, negocio: (args.negocio ?? null) as NegocioParaEnvio | null })
  return v.falta ? MENSAJE_ENVIO[v.falta] : null
}

/** El motivo para no enviar ni aprobar, o `null`. */
export async function motivoAutorizacionParaEnviar(
  supabase: Cliente,
  args: { workspaceId: string; negocioId: string | null },
): Promise<string | null> {
  const v = await autorizacionParaEnviar(supabase, args)
  return v.falta ? MENSAJE_ENVIO[v.falta] : null
}
