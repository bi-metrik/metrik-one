/**
 * F1 · Seguimiento: lo que lee y escribe la base (PR 5). Lo puro vive en `seguimiento.ts`.
 *
 * El envío queda en dos sitios:
 *   · `cotizaciones.fecha_envio` (la columna ya existía; el bloque del negocio no la llenaba). De
 *     ella cuelgan los toques del motor de recordatorios (fuente `envio`).
 *   · una línea de actividad `cambio` con `campo_modificado = 'cotizacion_envio'`, la versión
 *     en el texto y el canal en `valor_nuevo` (`enviar`, `descargado`, `aprobada`). Así el
 *     embudo cuenta el canal sin una columna más.
 *
 * Solo con `seguimiento.activo` en la línea del negocio; apagado no escribe nada (Vera §7.1.6).
 *
 * H33 (2026-10-14): descargar el PDF ya NO registra el envío. Antes la descarga escribía
 * `fecha_envio` con la cotización en `borrador` (y un «No lo envié» de 8 s que nadie veía). Ahora
 * el editor pregunta «¿Ya se la mandaste?» y el «Sí» pasa por `enviarCotizacion` (canal
 * `descargado`): estado `enviada` y `fecha_envio` en el mismo UPDATE, con las guardas de «Enviar».
 */

import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { configSeguimiento, ETIQUETA_CANAL, versionEnCadena, type CanalEnvio, type ConfigSeguimiento } from './seguimiento'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export const CAMPO_ENVIO = 'cotizacion_envio'

/** La configuración de seguimiento de la línea del negocio. Sin línea, apagada. */
export async function configSeguimientoDelNegocio(supabase: Db, negocioId: string): Promise<ConfigSeguimiento> {
  const { data: neg } = await supabase.from('negocios').select('linea_id').eq('id', negocioId).maybeSingle()
  const lineaId = (neg as { linea_id: string | null } | null)?.linea_id
  if (!lineaId) return configSeguimiento(null)
  const { data: linea } = await supabase.from('lineas_negocio').select('config_extra').eq('id', lineaId).maybeSingle()
  return configSeguimiento((linea as { config_extra: unknown } | null)?.config_extra ?? null)
}

/** v1, v2… desde la cadena `duplicada_de` de las cotizaciones del negocio (F1-3). */
export async function versionDeCotizacion(supabase: Db, negocioId: string, cotizacionId: string): Promise<number> {
  const { data } = await supabase.from('cotizaciones').select('id, duplicada_de').eq('negocio_id', negocioId)
  const padreDe = new Map<string, string | null>(
    ((data ?? []) as Array<{ id: string; duplicada_de: string | null }>).map((c) => [c.id, c.duplicada_de]),
  )
  return versionEnCadena(cotizacionId, padreDe)
}

/**
 * Registra que la cotización salió. `fecha_envio` se escribe solo si estaba vacía: una segunda
 * descarga no corre los toques. Devuelve `registrado: false` con la línea apagada o si ya
 * había envío.
 */
export async function registrarEnvioCotizacion(
  supabase: Db,
  args: {
    workspaceId: string
    negocioId: string
    cotizacionId: string
    staffId: string | null
    canal: CanalEnvio
    /** El camino ya escribió `fecha_envio` (el «Enviar» del editor, desde siempre): solo falta la línea. */
    fechaYaEscrita?: boolean
  },
): Promise<{ registrado: boolean; version: number | null }> {
  const cfg = await configSeguimientoDelNegocio(supabase, args.negocioId)
  if (!cfg.activo) return { registrado: false, version: null }

  if (!args.fechaYaEscrita) {
    const { data: marcadas, error } = await supabase
      .from('cotizaciones')
      .update({ fecha_envio: new Date().toISOString() })
      .eq('id', args.cotizacionId)
      .eq('negocio_id', args.negocioId)
      .is('fecha_envio', null)
      .select('id')
    if (error) {
      console.error('[seguimiento] no se pudo registrar el envío:', error.message)
      return { registrado: false, version: null }
    }
    if (!marcadas || marcadas.length === 0) return { registrado: false, version: null }
  }

  const version = await versionDeCotizacion(supabase, args.negocioId, args.cotizacionId)
  await registrarActividad(supabase, {
    workspace_id: args.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: args.negocioId,
    tipo: 'cambio',
    autor_id: args.staffId,
    campo_modificado: CAMPO_ENVIO,
    contenido: `Cotización v${version} enviada ${ETIQUETA_CANAL[args.canal]}. Arranca el seguimiento.`,
    valor_nuevo: args.canal,
  }, 'registrarEnvioCotizacion')
  return { registrado: true, version }
}

/** ¿El negocio tiene alguna cotización enviada (`fecha_envio`)? Gate `cotizacion_enviada`. */
export async function hayCotizacionEnviada(supabase: Db, negocioId: string): Promise<boolean> {
  const { count } = await supabase
    .from('cotizaciones')
    .select('id', { count: 'exact', head: true })
    .eq('negocio_id', negocioId)
    .not('fecha_envio', 'is', null)
  return (count ?? 0) > 0
}
