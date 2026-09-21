/**
 * Quiénes viajan y cuándo, leído de los bloques del negocio (etapa 1).
 *
 * La composición del grupo se captura en la etapa 1, en «Condiciones del viaje», con los
 * campos `adultos`, `ninos` e `infantes` (diseño tarifa-por-pasajero §3). Cada línea de la
 * cotización hereda esa composición como punto de partida.
 *
 * ## Por qué se busca por SLUG DE CAMPO y no por slug de bloque
 *
 * Los campos tienen nombres de dominio que no dependen de cómo se llame el bloque en cada
 * línea: un workspace que no los declara simplemente no tiene composición, y la pantalla
 * pide escribirla en la línea. Buscar el bloque por su slug ataría el producto al nombre
 * que le puso un cliente.
 *
 * ⚠️ El error de la lectura se DEVUELVE. Un `?? []` sobre PostgREST convertiría un 42501
 * en «el viaje no tiene composición», y la pantalla pediría escribir a mano un dato que sí
 * existe.
 */

import { nivelDetalleDesde, type NivelDetalle } from './detalle-viaje'
import { normalizarComposicion, type Composicion } from './tarifa-pasajero'

export interface ViajeDelNegocio {
  composicion: Composicion | null
  fechas: { inicio: string | null; fin: string | null }
  /**
   * A dónde va el viaje, según lo declaró la etapa 1 (`condiciones_del_viaje.destino`).
   * Es lo que la portada del documento del cliente pone en la ficha DESTINO.
   */
  destino: string | null
  /**
   * El párrafo con el que se presenta el destino en el documento del cliente (§2.2 de
   * `propuesta-visual.md`). Lo escribe quien cotiza; **no lo redacta el sistema**.
   */
  presentacion: string | null
  /** Qué tan detallado sale el documento. Sin declararlo, `normal`. */
  nivelDetalle: NivelDetalle
}

export const VIAJE_VACIO: ViajeDelNegocio = {
  composicion: null,
  fechas: { inicio: null, fin: null },
  destino: null,
  presentacion: null,
  nivelDetalle: nivelDetalleDesde(null),
}

function fecha(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim())
  return m ? m[1] : null
}

function textoLibre(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/** Lo puro: de las filas de `data` de los bloques al viaje. La primera composición válida gana. */
export function viajeDesdeFilas(filas: Record<string, unknown>[]): ViajeDelNegocio {
  let composicion: Composicion | null = null
  let inicio: string | null = null
  let fin: string | null = null
  let destino: string | null = null
  let presentacion: string | null = null
  let nivel: unknown = null
  for (const f of filas) {
    if (!composicion) composicion = normalizarComposicion(f)
    if (!inicio) inicio = fecha(f.fecha_salida)
    if (!fin) fin = fecha(f.fecha_regreso)
    if (!destino) destino = textoLibre(f.destino)
    if (!presentacion) presentacion = textoLibre(f.presentacion_destino)
    if (!nivel) nivel = f.nivel_detalle
  }
  return {
    composicion,
    fechas: { inicio, fin },
    destino,
    presentacion,
    nivelDetalle: nivelDetalleDesde(nivel),
  }
}

export async function leerViajeDelNegocio(
  supabase: unknown,
  negocioId: string | null,
): Promise<{ viaje: ViajeDelNegocio; error: string | null }> {
  if (!negocioId) return { viaje: VIAJE_VACIO, error: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('negocio_bloques')
    .select(
      'adultos:data->adultos, ninos:data->ninos, infantes:data->infantes, '
      + 'fecha_salida:data->fecha_salida, fecha_regreso:data->fecha_regreso, '
      // Los tres que alimentan la portada del documento del cliente. Un bloque que no los
      // declara devuelve null en esas columnas: no hay 400 que tolerar ni nada que romper.
      + 'destino:data->destino, presentacion_destino:data->presentacion_destino, nivel_detalle:data->nivel_detalle',
    )
    .eq('negocio_id', negocioId)
  if (error) return { viaje: VIAJE_VACIO, error: (error as { message: string }).message }
  return { viaje: viajeDesdeFilas((data ?? []) as Record<string, unknown>[]), error: null }
}
