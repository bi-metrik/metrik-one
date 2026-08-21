/**
 * Casilla compartida: la MISMA casilla vista desde dos etapas distintas.
 *
 * No es una copia de solo lectura (eso es `source_etapa_orden`, que muestra el archivo del
 * origen y no deja escribir). Aquí hay UNA fila y dos puertas de entrada, porque el mismo
 * papel puede llegar por dos caminos según la rama que tome el caso.
 *
 * Caso que lo obliga (SOENA VE): el certificado UPME lo pide Certificación, pero el tramo de
 * solo devolución de IVA no pasa por Certificación y aun así no se puede ejecutar sin él.
 * Medido 2026-08-20: de 11 casos de solo IVA, 9 no tenían ni la fila del certificado.
 *
 * ⚠️ Por qué la casilla del origen se CREA aquí y no se da por existente.
 * La versión anterior de esto vivía en `negocio-v2-actions` y hacía `maybeSingle()`: si no
 * encontraba la fila del origen, devolvía la fila local. Para un bloque de datos eso nunca
 * pasaba, porque las dos etapas estaban en el mismo camino. Para el certificado UPME pasa
 * SIEMPRE, así que el mecanismo habría degradado en silencio a una copia local y el
 * resultado dependería de si el caso pasó o no por la etapa de origen: dos comportamientos
 * distintos para la misma configuración, que es peor que no tener el mecanismo.
 *
 * La fila se crea `pendiente` y vacía. Quien llama escribe inmediatamente después.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

export type ConfigExtra = Record<string, unknown>

export type DestinoBloque = {
  /** Fila donde debe escribirse. La del origen si la casilla es compartida. */
  id: string
  /** true cuando la escritura se redirigió a otra fila. */
  redirigido: boolean
  /** true cuando hubo que crear la fila del origen. */
  creado: boolean
}

/**
 * Slug del bloque origen cuando esta config declara una casilla compartida.
 *
 * Exige las dos mitades: el flag Y el slug. Un flag sin slug no dice a dónde escribir, y
 * asumir un destino sería exactamente el error que este módulo existe para evitar.
 */
export function origenCompartido(configExtra: ConfigExtra | null | undefined): string | null {
  const ce = configExtra ?? {}
  if (ce.compartido_con_origen !== true) return null
  const slug = ce.source_bloque_slug
  return typeof slug === 'string' && slug.length > 0 ? slug : null
}

/**
 * Cuál de los bloques candidatos es el origen.
 *
 * Un slug identifica un bloque dentro de su línea. Si la consulta devuelve más de uno, la
 * configuración es ambigua y NO se elige por criterio propio: se devuelve `null` para que
 * quien llama escriba donde el usuario está. Inventar el destino de un documento es peor
 * que dejarlo en la casilla equivocada, porque nadie se entera.
 */
export function origenUnico<T extends { id: string }>(candidatos: readonly T[] | null | undefined): T | null {
  if (!candidatos || candidatos.length !== 1) return null
  return candidatos[0]
}

/**
 * Resuelve en qué fila escribir, creando la casilla del origen si hace falta.
 *
 * Quien llama debe LEER también de la fila devuelta: así la subcarpeta de Drive, los campos
 * de extracción y los cross-checks salen de la config del origen y el bloque espejo se
 * comporta igual sin copiarle nada. Duplicar esa config sería garantizar que se
 * desincronicen, y el síntoma de esa desincronización es mudo.
 *
 * Devuelve la fila recibida cuando el bloque no es compartido, cuando el origen es ambiguo
 * o cuando algo falla: ante la duda se escribe donde el usuario está, nunca se pierde el dato.
 */
export async function resolverDestino(
  supabase: Cliente,
  negocioBloqueId: string,
): Promise<DestinoBloque> {
  const { data: actual } = await supabase
    .from('negocio_bloques')
    .select('negocio_id, bloque_configs!inner(config_extra)')
    .eq('id', negocioBloqueId)
    .single()

  const ceLocal = ((actual?.bloque_configs as { config_extra?: ConfigExtra } | null)?.config_extra
    ?? {}) as ConfigExtra
  const local: DestinoBloque = { id: negocioBloqueId, redirigido: false, creado: false }
  if (!actual) return local

  const srcSlug = origenCompartido(ceLocal)
  if (!srcSlug) return local

  const negocioId = (actual as { negocio_id: string }).negocio_id

  const { data: origen } = await supabase
    .from('negocio_bloques')
    .select('id, bloque_configs!inner(slug)')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.slug', srcSlug)
    .limit(2)

  const filaOrigen = origenUnico((origen ?? []) as Array<{ id: string }>)
  if (filaOrigen) {
    return { id: filaOrigen.id, redirigido: true, creado: false }
  }
  // Más de una fila con el mismo slug: configuración ambigua, no se elige por cuenta propia.
  if ((origen?.length ?? 0) > 1) {
    console.error('[casilla-compartida] slug ambiguo, se escribe local:', srcSlug, negocioBloqueId)
    return local
  }

  return crearCasillaOrigen(supabase, negocioId, srcSlug, local)
}

/**
 * Crea la casilla del origen para un caso que nunca recorrió esa etapa.
 *
 * ⚠️ Deja una fila en una etapa por la que el negocio NO pasó, y hay un lector que infiere el
 * recorrido contando instancias de bloques: `src/lib/correcciones/reversa.ts` arma su conjunto
 * `recorridas` así. Con esta fila, la etapa de origen le parece recorrida.
 *
 * Se acepta a propósito, no por descuido: la reversa propone devolver un caso a una etapa que
 * se saltó, y el trabajo de la etapa de origen (conseguir el papel) SÍ está hecho — el papel
 * está cargado, en esta misma fila. Proponer devolverlo ahí sería mandar a rehacer algo que ya
 * existe. Lo que se pierde es poder distinguir después "pasó por la etapa" de "el papel llegó
 * por el otro camino"; para eso está el `bloque_config` del espejo, que dice por dónde entró.
 *
 * El día que se calcule la ruta recorrida para mostrarla en pantalla, hay que leerla del
 * routing y no de las filas, que además es lo correcto por otras razones.
 */
async function crearCasillaOrigen(
  supabase: Cliente,
  negocioId: string,
  srcSlug: string,
  local: DestinoBloque,
): Promise<DestinoBloque> {
  const { data: negocio } = await supabase
    .from('negocios')
    .select('linea_id')
    .eq('id', negocioId)
    .single()

  const lineaId = (negocio as { linea_id?: string | null } | null)?.linea_id
  if (!lineaId) return local

  const { data: configs } = await supabase
    .from('bloque_configs')
    .select('id, etapas_negocio!inner(linea_id)')
    .eq('etapas_negocio.linea_id', lineaId)
    .eq('slug', srcSlug)
    .limit(2)

  const cfg = origenUnico((configs ?? []) as Array<{ id: string }>)
  if (!cfg) {
    console.error('[casilla-compartida] origen no encontrado o ambiguo en la línea:', srcSlug, lineaId)
    return local
  }

  // `ignoreDuplicates` cubre la carrera de dos subidas simultáneas: la tabla tiene índice
  // único por (negocio_id, bloque_config_id), así que la segunda no crea una fila gemela.
  const { error: errIns } = await supabase
    .from('negocio_bloques')
    .upsert(
      { negocio_id: negocioId, bloque_config_id: cfg.id, estado: 'pendiente', data: {} },
      { onConflict: 'negocio_id,bloque_config_id', ignoreDuplicates: true },
    )
  if (errIns) {
    console.error('[casilla-compartida] no se pudo crear la casilla del origen:', errIns)
    return local
  }

  // Se relee en vez de confiar en el retorno del upsert: con `ignoreDuplicates` la fila
  // ganadora puede ser la de la otra escritura, y lo que importa es cuál quedó.
  const { data: creada } = await supabase
    .from('negocio_bloques')
    .select('id')
    .eq('negocio_id', negocioId)
    .eq('bloque_config_id', cfg.id)
    .maybeSingle()

  const id = (creada as { id?: string } | null)?.id
  if (!id) return local

  return { id, redirigido: true, creado: true }
}

/** Compatibilidad con los llamadores que solo necesitan la fila destino. */
export async function resolverDestinoCompartido(
  supabase: Cliente,
  negocioBloqueId: string,
): Promise<string> {
  const destino = await resolverDestino(supabase, negocioBloqueId)
  return destino.id
}

/**
 * ¿Este gate espejo de un DOCUMENTO ya está resuelto, aunque su fila siga `pendiente`?
 *
 * La casilla compartida redirige la ESCRITURA a la fila del origen, y `procesarDocumento`
 * cierra únicamente la fila que escribió (`documento-actions.ts`: el `estado: 'completo'`
 * va contra `bloqueId`, que ya es el destino resuelto). La fila local del espejo nunca se
 * toca: nace `pendiente` y se queda ahí para siempre.
 *
 * Para un espejo de tipo `datos` eso no se nota, porque esos espejos se configuran con
 * `editable_solo_si_vacio` y el cierre lo hace `soloLecturaPorDatoLleno`. Ese camino no
 * sirve aquí: evalúa `config_extra.fields`, y un bloque documento no tiene `fields`, así
 * que devuelve `false` siempre. Un espejo documento con `es_gate` retendría el caso
 * esperando un papel que YA está cargado — exactamente el defecto que este repo documentó
 * en `gateVisibleQuedaResuelto` y en `documentoHeredadoNaceCompleto`.
 *
 * Por eso el veredicto se toma sobre el ARCHIVO DEL ORIGEN, igual que
 * `documentoHeredadoNaceCompleto`: el render ya sustituyó la data del espejo por la del
 * origen, así que `dataResuelta` es la del origen y `drive_url` dice si el papel llegó.
 *
 * Devuelve false para todo lo que no sea un espejo documento: un bloque con fila propia lo
 * cierra quien lo diligencia, y no le corresponde a esto adelantarse.
 */
export function documentoCompartidoQuedaResuelto(
  configExtra: ConfigExtra | null | undefined,
  esDocumento: boolean,
  dataResuelta: Record<string, unknown> | null | undefined,
): boolean {
  if (!esDocumento) return false
  if (!origenCompartido(configExtra)) return false
  const url = (dataResuelta ?? {}).drive_url
  return typeof url === 'string' && url.length > 0
}
