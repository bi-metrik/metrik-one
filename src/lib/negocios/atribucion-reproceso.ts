/**
 * A quien se le imputa un reproceso.
 *
 * Vive aparte de `reproceso-actions.ts` porque tiene DOS consumidores en runtimes
 * distintos: el server action que abre el reproceso y el script que repone los
 * eventos perdidos (`scripts/backfill-reproceso-eventos.ts`). Escrita dos veces,
 * las dos copias se desincronizan y el sintoma seria que un backfill le imputa el
 * error a alguien distinto del que se lo imputaria la aplicacion — sobre un dato
 * del que cuelga el 40% del bono.
 *
 * No puede vivir dentro del server action: `'use server'` solo admite exports
 * async, y ademas exportar esto de ahi lo convertiria en un endpoint alcanzable.
 *
 * Sin `server-only`: el script de backfill corre fuera del bundle de Next y esa
 * marca lo rompe al resolverla. No hace falta — el modulo no toca `process.env`
 * ni credenciales, recibe el cliente ya construido por quien llama.
 */

/**
 * El bloque cuyo trabajo hay que rehacer, por tipo de reproceso. Es el que dice
 * QUIEN lo hizo: `negocio_bloques.completado_por`.
 */
export const BLOQUE_DEL_TRAMO = {
  certificacion_upme: 'radicado_de_certificacion',
  devolucion_dian: 'confirmacion_envio_a_dian',
} as const

export type TipoReproceso = keyof typeof BLOQUE_DEL_TRAMO

/**
 * La causa decide si el reproceso cuenta como falla de calidad. Regla dura de la
 * reunion con Deisy: si la DIAN devuelve porque el funcionario interpreto distinto
 * el procedimiento, no es culpa nuestra y NO penaliza el bono; si nos equivocamos
 * en un valor o en el procedimiento, si.
 */
export type CausaReproceso = 'error_propio' | 'criterio_tercero'

/**
 * Quien HIZO el trabajo que hay que rehacer, **no** quien reporta el reproceso: eso
 * siempre es la supervisora, y cargarselo a ella invertiria el indicador.
 *
 * Devuelve `staff.id`, o `null` si no se puede resolver — trabajo que entro por
 * cargue masivo, sin autor. Un `null` se cuenta como "sin atribuir" en el tablero;
 * colgarselo a alguien por descarte seria peor que no saberlo.
 *
 * ⚠️ `negocio_bloques.completado_por` es `profiles.id`, mientras que el tablero
 * agrupa por `staff.id`. Son tablas distintas y el puente es `staff.profile_id`;
 * comparar los dos ids directamente devuelve vacio en silencio, que en un tablero
 * se lee como "esta persona no trabajo".
 */
export async function resolverAtribucionReproceso(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioId: string,
  tipo: TipoReproceso,
): Promise<string | null> {
  const slug = BLOQUE_DEL_TRAMO[tipo]
  const { data } = await supabase
    .from('negocio_bloques')
    .select('completado_por, completado_at, bloque_configs!inner(slug)')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.slug', slug)
    .not('completado_por', 'is', null)
    .order('completado_at', { ascending: false })
    .limit(1)

  const profileId = ((data ?? []) as Array<{ completado_por: string | null }>)[0]?.completado_por
  if (!profileId) return null

  const { data: st } = await supabase
    .from('staff')
    .select('id')
    .eq('profile_id', profileId)
    .maybeSingle()
  return (st as { id: string } | null)?.id ?? null
}
