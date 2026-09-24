/**
 * ¿Se puede generar un formulario de este negocio, o hay una lectura en disputa?
 *
 * En SOENA la declaración juramentada y la relación de facturas de V0142 salieron para la
 * DIAN con una cédula que el RUT leyó mal, mientras la factura y el certificado UPME
 * traían la buena. Con un voto de la línea en disputa (`niega_generacion`), ningún
 * formulario del negocio se genera: el documento saldría con un número que dos fuentes
 * contradicen, y un papel radicado ante la DIAN no se corrige con un clic.
 *
 * Vive en el núcleo de la generación (`generarFormularioCore`), así que la barrera vale
 * igual para la pantalla y para los scripts de cargue.
 *
 * No es un archivo `'use server'`: exportar esto desde uno lo volvería un endpoint.
 */

import { lecturasQueNieganGeneracion } from './datos-clave-servidor'
import type { ResultadoVoto } from './votos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

/** El motivo que ve el equipo. Puro, para probarlo. */
export function motivoGeneracionNegada(votos: ResultadoVoto[]): string | null {
  if (votos.length === 0) return null
  const detalle = votos.map(v => v.mensaje ?? v.label).join(' ')
  return (
    `No se genera el documento: hay un dato en disputa entre los documentos del caso. ${detalle} ` +
    'Corrígelo desde «Datos clave» en la ficha del negocio y vuelve a generar.'
  )
}

/**
 * El motivo por el que NO se genera, o `null` si se puede. Si la verificación misma
 * falla, NO se genera: el lado seguro de un control que protege un papel para la DIAN
 * es frenar, y el mensaje pide reintentar en vez de fingir que todo cuadra.
 */
export async function generacionNegadaPorDisputa(
  supabase: unknown,
  args: { negocioId: string; lineaId: string },
): Promise<string | null> {
  try {
    const [lineaRes, negocioRes] = await Promise.all([
      db(supabase).from('lineas_negocio').select('config_extra').eq('id', args.lineaId).maybeSingle(),
      db(supabase).from('negocios').select('etapa_actual_id').eq('id', args.negocioId).maybeSingle(),
    ])
    // Una lectura que falla no se confunde con «la línea no declara votos».
    if (lineaRes.error) throw lineaRes.error
    if (negocioRes.error) throw negocioRes.error
    const linea = lineaRes.data
    const negocio = negocioRes.data
    const configLinea = (linea as { config_extra?: Record<string, unknown> | null } | null)?.config_extra ?? null
    const etapaActualId = (negocio as { etapa_actual_id?: string | null } | null)?.etapa_actual_id ?? null
    const votos = await lecturasQueNieganGeneracion(supabase, {
      negocioId: args.negocioId,
      lineaId: args.lineaId,
      etapaActualId,
      etapaOrden: null,
      configLinea,
    })
    return motivoGeneracionNegada(votos)
  } catch (e) {
    console.error('[formulario] verificación de lecturas en disputa:', e)
    return 'No se pudo comprobar que los documentos del caso coincidan en el número de identificación. Intenta de nuevo en un momento.'
  }
}
