import 'server-only'

import type { Area, Stage, UserContext } from '@/lib/permissions/can-edit'
import { CLAVE_CARPETA_LOCAL, conCarpetaLocal, leerCarpetaLocal, puedeEditarCarpetaLocal } from './carpeta-local'

/**
 * Lectura y escritura de `negocios.metadata.carpeta_local` contra Supabase. Las reglas
 * están en `carpeta-local.ts`; aquí solo se juntan los datos que piden y se escribe.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(c: unknown): any { return c }

/**
 * ¿Puede este usuario escribir la carpeta de este negocio?
 *
 * La usan la ficha (para dibujar el campo editable) y la server action (para aceptar la
 * escritura), con las MISMAS lecturas: si cada una juntara los datos por su lado, la
 * pantalla podría ofrecer lo que la acción rechaza.
 */
export async function resolverPermisoCarpetaLocal(
  supabase: unknown,
  user: UserContext,
  workspaceId: string,
  negocioId: string,
): Promise<boolean> {
  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('stage_actual, etapa_actual_id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!negocio) return false

  const { stage_actual, etapa_actual_id } = negocio as { stage_actual: Stage | null; etapa_actual_id: string | null }
  const [etapaRes, respRes] = await Promise.all([
    etapa_actual_id
      ? db(supabase).from('etapas_negocio').select('config_extra').eq('id', etapa_actual_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db(supabase).from('negocio_responsables').select('staff_id').eq('negocio_id', negocioId),
  ])

  const areasQueAvanzan = ((etapaRes.data as { config_extra?: { areas_que_avanzan?: unknown } | null } | null)
    ?.config_extra?.areas_que_avanzan ?? []) as Area[]
  const responsables = ((respRes.data ?? []) as { staff_id: string }[]).map(r => r.staff_id)

  return puedeEditarCarpetaLocal(user, { stage: stage_actual, responsables, areasQueAvanzan })
}

export type ResultadoGuardarCarpeta =
  | { ok: true; anterior: string | null }
  | { ok: false; error: string }

const INTENTOS = 3

/**
 * Escribe (o quita, con `carpeta = null`) la clave sin tocar el resto de `metadata`.
 *
 * PostgREST no puede mandar `metadata || jsonb_build_object(...)`: el `update` lleva el
 * objeto entero. Para que eso no pise lo que otro proceso escriba en el medio, la
 * escritura es condicional: se lee `metadata` + `updated_at` y se actualiza SOLO si
 * `updated_at` sigue igual. `negocios` tiene un trigger BEFORE UPDATE
 * (`negocios_updated_at`) que lo mueve en toda escritura, así que si alguien escribió
 * entre la lectura y el `update`, la fila no coincide, se vuelve a leer y se fusiona
 * sobre lo nuevo. Si la lectura falla, no se escribe: sin la metadata de ahora, escribir
 * sería reemplazarla.
 */
export async function guardarCarpetaLocal(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
  carpeta: string | null,
): Promise<ResultadoGuardarCarpeta> {
  for (let intento = 0; intento < INTENTOS; intento++) {
    const { data: fila, error: errLeer } = await db(supabase)
      .from('negocios')
      .select('metadata, updated_at')
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (errLeer) return { ok: false, error: (errLeer as { message: string }).message }
    if (!fila) return { ok: false, error: 'Negocio no encontrado' }

    // `updated_at` es NOT NULL: siempre hay contra qué condicionar.
    const { metadata, updated_at } = fila as { metadata: unknown; updated_at: string }
    const anterior = leerCarpetaLocal(metadata)
    // Se compara el valor CRUDO, no el leído: un `""` guardado se lee como null, y pedir
    // borrarlo tiene que quitar la clave, no dejar el texto vacío porque "ya estaba vacío".
    const crudo = (metadata as Record<string, unknown> | null)?.[CLAVE_CARPETA_LOCAL]
    if (crudo === (carpeta ?? undefined)) return { ok: true, anterior }

    const { data: escritas, error: errEscribir } = await db(supabase)
      .from('negocios')
      .update({ metadata: conCarpetaLocal(metadata, carpeta), updated_at: new Date().toISOString() })
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
      .eq('updated_at', updated_at)
      .select('id')
    if (errEscribir) return { ok: false, error: (errEscribir as { message: string }).message }
    if (((escritas ?? []) as unknown[]).length > 0) return { ok: true, anterior }
    // Cero filas: otra escritura se metió en el medio. Se relee y se fusiona otra vez.
  }
  return { ok: false, error: 'El negocio cambió mientras se guardaba la carpeta. Intenta de nuevo.' }
}
