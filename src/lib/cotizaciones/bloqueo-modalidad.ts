/**
 * ¿El viaje es A medida o Bloqueo, y con qué operador? (brief del 2026-10-27, punto 1).
 *
 * Los dos datos viven en los campos del bloque «Condiciones del viaje» (`negocio_bloques.data`), como
 * todo lo demás de la solicitud: `modalidad_viaje` (`a_medida` | `bloqueo`) y `operador_bloqueo`
 * (texto). Los declara la config del workspace (`sql/trappvel/2026-10-27_modalidad-bloqueo.sql`), así
 * que los llena la asesora en el panel y el bot de WhatsApp los llena con el mismo camino que el resto
 * de la solicitud: el modelo interpreta («un bloqueo de Aliados del 5 al 8 de febrero») y el código
 * solo guarda.
 *
 * ⚠️ El slug NO es `tipo_viaje`: ese ya existe y dice playa / naturaleza / crucero.
 *
 * Sin el campo, o vacío, el viaje es A medida (el default): nada cambia para nadie.
 */

export const SLUG_MODALIDAD = 'modalidad_viaje'
export const SLUG_OPERADOR = 'operador_bloqueo'

/**
 * Los campos de la solicitud que en Bloqueo los define el PAQUETE, no el cliente (N-13 del QA del
 * 2026-10-29): el hotel lo trae el operador, así que «¿De qué categoría prefieren el hotel?» no se
 * pide para cotizar. En A medida cuentan como siempre.
 */
export const CAMPOS_QUE_DEFINE_EL_PAQUETE: readonly string[] = ['categoria_hotel']

/** ¿Este campo no se pide porque el viaje es Bloqueo y lo define el paquete? */
export function campoLoDefineElPaquete(slug: string, valores: Record<string, unknown>): boolean {
  return CAMPOS_QUE_DEFINE_EL_PAQUETE.includes(slug) && esValorBloqueo(valores[SLUG_MODALIDAD])
}

export interface ModalidadDelViaje {
  bloqueo: boolean
  operador: string | null
}

export const A_MEDIDA: ModalidadDelViaje = { bloqueo: false, operador: null }

/** ¿El valor guardado dice Bloqueo? Acepta el value (`bloqueo`) y la etiqueta escrita a mano. */
export function esValorBloqueo(v: unknown): boolean {
  return typeof v === 'string' && v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() === 'bloqueo'
}

/** De las filas de `negocio_bloques.data` a la modalidad. La primera fila con valor gana. */
export function modalidadDesdeFilas(filas: readonly Record<string, unknown>[]): ModalidadDelViaje {
  let bloqueo: boolean | null = null
  let operador: string | null = null
  for (const f of filas) {
    const m = f[SLUG_MODALIDAD]
    if (bloqueo === null && typeof m === 'string' && m.trim() !== '') bloqueo = esValorBloqueo(m)
    const o = f[SLUG_OPERADOR]
    if (operador === null && typeof o === 'string' && o.trim() !== '') operador = o.trim().slice(0, 120)
  }
  return bloqueo ? { bloqueo: true, operador } : A_MEDIDA
}

/**
 * Lee la modalidad del negocio. El error se DEVUELVE (no se convierte en «A medida» en silencio).
 * Una consulta propia y estrecha: no toca la lectura del viaje (`viaje-negocio.ts`), que usa medio
 * motor de la cotización.
 */
export async function leerModalidadDelViaje(
  supabase: unknown,
  negocioId: string | null,
): Promise<{ modalidad: ModalidadDelViaje; error: string | null }> {
  if (!negocioId) return { modalidad: A_MEDIDA, error: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('negocio_bloques')
    .select(`${SLUG_MODALIDAD}:data->>${SLUG_MODALIDAD}, ${SLUG_OPERADOR}:data->>${SLUG_OPERADOR}`)
    .eq('negocio_id', negocioId)
  if (error) return { modalidad: A_MEDIDA, error: (error as { message: string }).message }
  return { modalidad: modalidadDesdeFilas((data ?? []) as Record<string, unknown>[]), error: null }
}
