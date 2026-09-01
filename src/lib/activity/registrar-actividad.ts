import type { ActivityLogTipo } from './tipos'

/**
 * Única vía para escribir en `activity_log`.
 *
 * ## Por qué existe
 *
 * Ningún insert a `activity_log` leía su `error`. Cuando Postgres rechazaba la fila
 * —por un `tipo` fuera del CHECK, por un `autor_id` que no existe en `staff`, por
 * RLS— la promesa se resolvía, el código seguía y **el evento no quedaba en ninguna
 * parte**. El síntoma es indistinguible del caso sano: el timeline simplemente no
 * muestra ese evento, y nadie tiene motivo para sospechar que falta.
 *
 * Medido en producción el 2026-09-01: **754 aprobaciones de propuesta sobre 311
 * negocios desde el 2026-04-15, y CERO filas `propuesta_aprobada` en `activity_log`.**
 * La aprobación que fijó el honorario de cada uno de esos negocios no existe en su
 * historia. El caso que lo destapó es V0429 de SOENA: la aprobación del 2026-08-26 no
 * aparece, y la reversión posterior sí, porque esa usa `tipo: 'cambio'`.
 *
 * ## Contrato
 *
 * - **Nunca lanza.** Un rechazo del log no puede tumbar la operación de negocio que lo
 *   originó: el pago ya se registró, la propuesta ya se aprobó, la carpeta ya se creó.
 *   Revertir el trabajo real porque no se pudo anotar sería peor que la anotación
 *   faltante.
 * - **Nunca calla.** El rechazo va a `console.error` con la entidad, el tipo y el
 *   motivo — lo mínimo para diagnosticarlo desde los logs de producción sin tener que
 *   reproducirlo.
 * - Devuelve el `id` de la fila para quien lo necesite (las menciones de un comentario,
 *   el `activity_log_id` de una corrección).
 *
 * `tipo` está acotado a {@link ActivityLogTipo}, así que un valor fuera del catálogo
 * ya no compila. Ese es el fondo del arreglo: el CHECK deja de ser la primera vez que
 * alguien se entera.
 */

/** Los datos de una entrada. Espeja las columnas de `activity_log`. */
export type FilaActividad = {
  workspace_id: string
  entidad_tipo: string
  entidad_id: string
  tipo: ActivityLogTipo
  /** ⚠️ FK a **`staff(id)`**, NO a `profiles(id)`. Cruzarlas viola la FK. */
  autor_id?: string | null
  contenido?: string | null
  campo_modificado?: string | null
  valor_anterior?: string | null
  valor_nuevo?: string | null
  /** FK a `staff(id)`. */
  mencion_id?: string | null
  link_url?: string | null
}

export type ResultadoActividad =
  | { ok: true; id: string | null }
  | { ok: false; id: null; motivo: string }

/**
 * Los clientes de Supabase llegan aquí con formas distintas: el autenticado tipado,
 * el de servicio, y varios ya pasados por el `db()` que devuelve `any`. Tiparlo
 * estrictamente obligaría a un cast en cada llamador, que es justo el ruido que
 * empuja a saltarse el helper. Se acepta `unknown` y el cast vive **una sola vez**,
 * aquí adentro. Mismo criterio que `ejecutarRetroceso({ supabase: unknown })`.
 */
type ClienteSupabase = unknown

type RespuestaInsert = {
  data: { id: string } | null
  error: { message: string; code?: string } | null
}

/**
 * Inserta una entrada en `activity_log`, lee el error y lo reporta.
 *
 * @param origen Etiqueta corta de quién escribe (`'aprobarVersionPropuesta'`). Va en
 *   el mensaje de error: sin ella, un fallo en producción obliga a adivinar cuál de
 *   los ~70 sitios lo produjo.
 */
export async function registrarActividad(
  supabase: ClienteSupabase,
  fila: FilaActividad,
  origen: string,
): Promise<ResultadoActividad> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = (await (supabase as any)
      .from('activity_log')
      .insert(fila)
      .select('id')
      .maybeSingle()) as RespuestaInsert

    if (error) {
      reportar(origen, fila, error.code ? `${error.code} ${error.message}` : error.message)
      return { ok: false, id: null, motivo: error.message }
    }

    return { ok: true, id: data?.id ?? null }
  } catch (err) {
    // Un throw aquí (red caída, cliente mal construido) tampoco puede tumbar la
    // operación de negocio. Se reporta igual que el rechazo de Postgres.
    const motivo = err instanceof Error ? err.message : String(err)
    reportar(origen, fila, motivo)
    return { ok: false, id: null, motivo }
  }
}

/**
 * Actualiza una entrada ya escrita. La usa la traza de correcciones, que refresca el
 * mismo evento mientras dure la corrección en vez de duplicarlo por cada pulsación
 * del autosave.
 */
export async function actualizarActividad(
  supabase: ClienteSupabase,
  activityLogId: string,
  cambios: Partial<Pick<FilaActividad, 'contenido' | 'valor_nuevo' | 'valor_anterior'>>,
  origen: string,
): Promise<{ ok: boolean; motivo?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = (await (supabase as any)
      .from('activity_log')
      .update(cambios)
      .eq('id', activityLogId)) as { error: { message: string } | null }

    if (error) {
      console.error(
        `[activity_log] ${origen}: no se pudo actualizar el evento ${activityLogId} — ${error.message}`,
      )
      return { ok: false, motivo: error.message }
    }
    return { ok: true }
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err)
    console.error(
      `[activity_log] ${origen}: no se pudo actualizar el evento ${activityLogId} — ${motivo}`,
    )
    return { ok: false, motivo }
  }
}

/**
 * Un solo formato de mensaje para los ~70 sitios: entidad, tipo y motivo. Con eso se
 * diagnostica desde los logs sin reproducir el caso.
 */
function reportar(origen: string, fila: FilaActividad, motivo: string) {
  console.error(
    `[activity_log] ${origen}: la entrada no se guardó — ` +
      `entidad=${fila.entidad_tipo}:${fila.entidad_id} tipo=${fila.tipo} ` +
      `workspace=${fila.workspace_id} motivo=${motivo}`,
  )
}
