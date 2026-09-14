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
 * Los documentos GENERADOS del tramo, cuyo autor responde por el reproceso cuando el
 * bloque de arriba no tiene `completado_por`.
 *
 * Hace falta porque generar un formulario NUNCA estampa `completado_por`: el autor
 * queda solo en `formulario_versiones.generated_by`. Medido el 2026-09-14 con V0142: su
 * devolución DIAN por error propio («Está mal la relación de las facturas», 7-sep) quedó
 * con `atribuido_a` NULL, y el indicador filtra `atribuido_a IS NOT NULL`, así que el
 * error no le contaba a nadie. La relación la había generado una persona el 19-ago.
 *
 * Solo los bloques de la etapa Generación. Las copias de Envío (`formulario_dian_envio`,
 * `formulario_1668_envio`) también tienen versiones y quedan fuera a propósito: son la
 * reimpresión de lo ya preparado, no el trabajo que la DIAN devolvió.
 */
export const DOCUMENTOS_DEL_TRAMO: Record<TipoReproceso, readonly string[]> = {
  certificacion_upme: [],
  devolucion_dian: ['formulario_dian', 'formulario_1668', 'declaracion_juramentada', 'relacion_de_facturas'],
}

/**
 * La causa decide si el reproceso cuenta como falla de calidad. Regla dura de la
 * reunion con Deisy: si la DIAN devuelve porque el funcionario interpreto distinto
 * el procedimiento, no es culpa nuestra y NO penaliza el bono; si nos equivocamos
 * en un valor o en el procedimiento, si.
 */
export type CausaReproceso = 'error_propio' | 'criterio_tercero'

/**
 * `reproceso_eventos.ciclo` de un error registrado SIN devolver el caso.
 *
 * El ciclo cuenta las veces que el caso VOLVIÓ atrás, y sale de
 * `negocios.metadata.reproceso.ciclo + 1`. Un error que se registra sin mover el caso no
 * abre ciclo, así que no puede tomar el número siguiente: el próximo reproceso real lo
 * repetiría. Cero es el valor que ningún reproceso real puede tener (el primero es 1), y
 * por eso sirve de marca sin migración. Los consumidores del indicador cuentan filas por
 * tipo, causa, atribución y fecha: el ciclo no entra en ninguna cuenta.
 */
export const CICLO_SIN_RETORNO = 0

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
  opciones: {
    /** El `staff` se busca DENTRO de este workspace: `staff.profile_id` es único GLOBAL. */
    workspaceId: string
    /**
     * Solo cuentan versiones generadas ANTES de este momento (el `abierto_at` del
     * evento). Sin él, la versión que se genera para CORREGIR el error se llevaría la
     * culpa del error.
     */
    antesDe?: string | null
  },
): Promise<string | null> {
  const { workspaceId, antesDe } = opciones

  // 1. Quien cerró el bloque del tramo.
  const slug = BLOQUE_DEL_TRAMO[tipo]
  const { data } = await supabase
    .from('negocio_bloques')
    .select('completado_por, completado_at, bloque_configs!inner(slug)')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.slug', slug)
    .not('completado_por', 'is', null)
    .order('completado_at', { ascending: false })
    .limit(1)

  const profileBloque = ((data ?? []) as Array<{ completado_por: string | null }>)[0]?.completado_por
  const staffBloque = profileBloque ? await staffDelWorkspace(supabase, profileBloque, workspaceId) : null
  if (staffBloque) return staffBloque

  // 2. Quien generó el último documento del tramo antes del reproceso. También entra
  //    cuando el bloque tiene autor pero ese autor no es staff de ESTE workspace (un
  //    platform_admin operando en un workspace ajeno): para el tablero, eso también es
  //    "nadie de aquí".
  const documentos = DOCUMENTOS_DEL_TRAMO[tipo]
  if (documentos.length === 0) return null

  let consulta = supabase
    .from('formulario_versiones')
    .select('generated_by, generated_at, negocio_bloques!inner(negocio_id, bloque_configs!inner(slug))')
    .eq('workspace_id', workspaceId)
    .eq('negocio_bloques.negocio_id', negocioId)
    .in('negocio_bloques.bloque_configs.slug', documentos as string[])
    .not('generated_by', 'is', null)
  if (antesDe) consulta = consulta.lt('generated_at', antesDe)
  const { data: versiones } = await consulta.order('generated_at', { ascending: false }).limit(1)

  const profileVersion = ((versiones ?? []) as Array<{ generated_by: string | null }>)[0]?.generated_by
  return profileVersion ? staffDelWorkspace(supabase, profileVersion, workspaceId) : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function staffDelWorkspace(supabase: any, profileId: string, workspaceId: string): Promise<string | null> {
  const { data: st } = await supabase
    .from('staff')
    .select('id')
    .eq('profile_id', profileId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return (st as { id: string } | null)?.id ?? null
}
