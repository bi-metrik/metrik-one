/**
 * El gate `margen_sobre_piso`, leído de la base.
 *
 * Vive aquí y no dentro de `negocio-v2-actions.ts` por la misma razón que
 * `itinerarios-datos.ts`: con el cliente de Supabase por PARÁMETRO se puede ejercitar
 * con un doble y ver el bloqueo ocurrir. Metido dentro de la server action, lo único
 * probable sería el helper puro — y un helper perfecto que la action no llama se ve
 * exactamente igual que un gate que funciona.
 */

import {
  cotizacionesBajoPiso,
  cotizacionesQueFijanElPrecio,
  mensajeGateMargen,
  type CotizacionMedida,
} from './gate-margen'
import { cascadaVigente, contextoDeCotizacion, leerItinerarios } from './itinerarios-datos'

// El cliente tipado obliga a arrastrar medio `database.ts` por cada `select`, y las
// tablas de itinerarios ni siquiera están en los tipos generados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

export interface VeredictoGateMargen {
  bloquea: boolean
  /** El motivo, ya redactado. Vacío cuando no bloquea. */
  mensaje: string
}

/**
 * ¿Alguna cotización de este negocio está por debajo de su piso de margen?
 *
 * ⚠️ El margen se RECALCULA contra la base con la misma regla del editor
 * (`cascadaVigente`). No se lee `cotizaciones.valor_total` contra `costo_total`:
 * `costo_total` es el costo DIRECTO, sin los administrativos, así que con AIU
 * declarado ese cociente sale por encima del margen real. Decidir un bloqueo con una
 * cifra que la pantalla no muestra en ningún lado deja al usuario sin nada que hacer.
 *
 * ⚠️ Si las cotizaciones no se pueden LEER, **frena**. Un control que deja pasar
 * cuando no pudo mirar es un decorado; el mensaje dice que fue un fallo de lectura y
 * no un margen bajo, para que nadie salga a subir un precio que estaba bien.
 */
export async function evaluarGateMargen(
  supabase: Supabase,
  negocioId: string,
): Promise<VeredictoGateMargen> {
  const { data, error } = await supabase
    .from('cotizaciones')
    .select('id, codigo, estado')
    .eq('negocio_id', negocioId)

  if (error) {
    return {
      bloquea: true,
      mensaje: 'No se pudieron leer las cotizaciones para comprobar el margen. Reintenta.',
    }
  }

  const candidatas = cotizacionesQueFijanElPrecio(
    (data ?? []) as { id: string; codigo: string | null; estado: string | null }[],
  )

  const medidas: CotizacionMedida[] = []
  for (const cot of candidatas) {
    const ctx = await contextoDeCotizacion(supabase, cot.id)
    // Una cotización que no se puede reconstruir no se juzga: no es «bajo el piso»,
    // es que no está. Las candidatas salen de una lectura que ya funcionó.
    if (!ctx) continue
    const filas = await leerItinerarios(supabase, cot.id)
    const cascada = cascadaVigente(ctx, filas)
    medidas.push({ ...cot, margenRealPct: cascada.margenRealPct, umbrales: ctx.umbrales })
  }

  const bajoPiso = cotizacionesBajoPiso(medidas)
  return { bloquea: bajoPiso.length > 0, mensaje: mensajeGateMargen(bajoPiso) }
}
