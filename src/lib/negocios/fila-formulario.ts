/**
 * ¿En qué fila lee y escribe una acción de formulario (generar, casillas, seccional, NIT)?
 *
 * Un formulario normal: en la suya. Una COPIA heredada (`source_etapa_orden`) solo si declara
 * `genera_en_origen` (ver `copia-heredada.origenDeCopiaGenerable`): entonces todo va a la fila
 * del ORIGEN, con la configuración del origen (plantilla, `campos_fuente`, `requiere_bloques`,
 * `drive_subfolder`, `label`). Una fila, un PDF, una sola serie de versiones.
 *
 * Caso que lo pide (SOENA, 2026-10-08): la carta de autorización se genera en Documentación
 * (`carta_autorizacion_generar`) y el equipo la necesita generar desde Cita, donde ya tenía
 * una copia de solo lectura (#1057).
 *
 * Cualquier otra copia se rechaza: su fila no se pinta nunca (la pantalla muestra la del
 * origen), así que escribir ahí sería perder el dato en silencio.
 *
 * El permiso NO se decide aquí: quien llama corre `guardEditarBloque` sobre la fila que el
 * usuario tiene enfrente (la copia, en la etapa donde trabaja), y después escribe en la que
 * devuelve esta función.
 */

import { resolverDestino, type DestinoBloque } from './casilla-compartida'
import {
  esCopiaHeredada,
  origenDeCopiaGenerable,
  mensajeCopiaDeSoloLectura,
  MENSAJE_ORIGEN_NO_RESUELTO,
} from './copia-heredada'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

export type FilaFormulario =
  | { ok: true; id: string; desdeCopia: boolean }
  /** `sinOrigen`: copia generable cuyo origen todavía no tiene fila (solo en lecturas). */
  | { ok: false; error: string; sinOrigen?: boolean }

export async function filaDelFormulario(
  supabase: Cliente,
  negocioBloqueId: string,
  opciones: { crear: boolean },
): Promise<FilaFormulario> {
  const { data } = await supabase
    .from('negocio_bloques')
    .select('bloque_configs(config_extra)')
    .eq('id', negocioBloqueId)
    .single()
  const ce = ((data?.bloque_configs as { config_extra?: Record<string, unknown> } | null)?.config_extra
    ?? {}) as Record<string, unknown>

  if (!esCopiaHeredada(ce)) return { ok: true, id: negocioBloqueId, desdeCopia: false }
  if (!origenDeCopiaGenerable(ce)) return { ok: false, error: mensajeCopiaDeSoloLectura(ce) }

  const destino: DestinoBloque = await resolverDestino(supabase, negocioBloqueId, {
    generaEnOrigen: true,
    crear: opciones.crear,
  })
  if (!destino.redirigido) {
    return { ok: false, error: MENSAJE_ORIGEN_NO_RESUELTO, ...(opciones.crear ? {} : { sinOrigen: true }) }
  }
  return { ok: true, id: destino.id, desdeCopia: true }
}
