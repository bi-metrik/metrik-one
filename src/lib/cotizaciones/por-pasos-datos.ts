/**
 * El interruptor de la cotización por pasos, leído de la BASE (pieza C1).
 *
 * La regla vive en `por-pasos.ts` (puro). Aquí solo se leen sus cuatro entradas para el
 * GUARD DEL SERVIDOR: toda acción nueva de la forma por pasos (elegir traslado o actividad
 * por tarifa, Opcional en traslado, aceptar en lote, deshacer, completar el precio por
 * pasajero…) vuelve a comprobar el interruptor contra la base, no contra lo que diga la
 * pantalla. Una server action exportada es un endpoint alcanzable aunque ningún botón la
 * invoque, y una pestaña abierta antes de apagar no puede seguir escribiendo con la forma
 * nueva.
 *
 * ⚠️ Ningún lector de plata importa este archivo (criterio N4): lo comprueba
 * `por-pasos-lectura-guard.test.ts`.
 */

import { lineaCotizaPorTipo } from './lineas-por-tipo'
import {
  estadoPorPasos,
  piezaEncendida,
  rechazoPorPasos,
  type EstadoPorPasos,
  type PiezaPorPasos,
} from './por-pasos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

/**
 * ¿La línea del negocio cotiza por tipo? La MISMA consulta que hace la página de la
 * cotización (una sola ida). Si no se puede leer, `false`: lo de siempre, nombre libre.
 */
export async function leerLineasPorTipo(supabase: Supabase, lineaId: string | null): Promise<boolean> {
  if (!lineaId) return false
  try {
    const { data, error } = await supabase
      .from('bloque_configs')
      .select('fields:config_extra->fields, etapas_negocio!inner(linea_id)')
      .eq('etapas_negocio.linea_id', lineaId)
    if (error) {
      console.warn('[cotizacion] no se pudo leer si la línea cotiza por tipo:', error.message)
      return false
    }
    return lineaCotizaPorTipo(((data ?? []) as { fields: unknown }[]).map(b => b.fields))
  } catch {
    return false
  }
}

/**
 * El estado del interruptor para UNA cotización, con las cuatro condiciones leídas de la
 * base. `null` si la cotización no existe o no se ve (RLS).
 */
export async function estadoPorPasosDeCotizacion(
  supabase: Supabase,
  cotizacionId: string,
): Promise<EstadoPorPasos | null> {
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('id, estado, negocio_id, workspace_id')
    .eq('id', cotizacionId)
    .maybeSingle()
  if (!cot) return null

  // H2 (verificación D) · el workspace y la línea del negocio no dependen uno del otro: van en
  // paralelo. Mismas consultas, mismo resultado; una ida menos en serie en cada guard.
  const leerWorkspace = async () => {
    const { data } = await supabase
      .from('workspaces')
      .select('config_extra, cotizacion_template_slug')
      .eq('id', cot.workspace_id)
      .maybeSingle()
    return data
  }
  const leerLineas = async () => {
    let lineaId: string | null = null
    if (cot.negocio_id) {
      const { data: neg } = await supabase
        .from('negocios')
        .select('linea_id')
        .eq('id', cot.negocio_id)
        .maybeSingle()
      lineaId = (neg?.linea_id ?? null) as string | null
    }
    return leerLineasPorTipo(supabase, lineaId)
  }
  const [ws, lineasPorTipo] = await Promise.all([leerWorkspace(), leerLineas()])

  return estadoPorPasos({
    lineasPorTipo,
    plantilla: (ws?.cotizacion_template_slug ?? null) as string | null,
    configWorkspace: ws?.config_extra ?? null,
    estado: (cot.estado ?? null) as string | null,
  })
}

export type ResultadoGuardPorPasos =
  | { ok: true; estado: EstadoPorPasos }
  | { ok: false; error: string }

/**
 * El guard del servidor de toda acción nueva: rechaza si la cotización no se trabaja por
 * pasos (cualquiera de las cuatro condiciones) o si la pieza que la acción necesita está
 * apagada.
 */
export async function exigirPorPasos(
  supabase: Supabase,
  cotizacionId: string,
  pieza?: PiezaPorPasos,
): Promise<ResultadoGuardPorPasos> {
  const estado = await estadoPorPasosDeCotizacion(supabase, cotizacionId)
  if (!estado) return { ok: false, error: 'Cotización no encontrada' }
  if (!estado.encendido) return { ok: false, error: rechazoPorPasos(estado.motivo ?? 'interruptor_apagado') }
  if (pieza && !piezaEncendida(estado, pieza)) return { ok: false, error: rechazoPorPasos('pieza_apagada') }
  return { ok: true, estado }
}
