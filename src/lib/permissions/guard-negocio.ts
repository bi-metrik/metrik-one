'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import {
  canEditBloque,
  canViewNegocio,
  canAdvanceStage,
  corrigeHaciaAtrasSinArea,
  esEtapaSuperada,
  type UserContext,
  type Stage,
  type Role,
  type Area,
} from './can-edit'
import { negocioCerrado, MENSAJE_NEGOCIO_CERRADO } from '@/lib/negocios/motivo-cierre'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'

/**
 * Guards server-side de negocios. TODA server action que muta bloques/etapas o
 * expone el detalle de un negocio DEBE invocar el guard correspondiente al
 * inicio. getBloqueMode/_areaReadonly (cliente) es solo UX, no es seguridad.
 *
 * UserContext.id = staff.id (negocio_responsables guarda staff.id). El cliente
 * supabase es el del usuario real/impersonado (getWorkspace ya aplica "Ver como").
 *
 * Los negocios, sus bloques y sus etapas son de Clarity: los tres guards piden el módulo
 * además del rol. El gate por ruta cierra `/negocios`, pero cada acción es un endpoint, y
 * detrás de este guard hay lectura con Gemini (documentos), Drive con las credenciales de
 * MeTRIK (formularios, propuesta, guía) y el almacenamiento externo. Medido el 2026-09-16:
 * los únicos negocios fuera de un workspace con Clarity son 2 de advise, sin tocar desde el
 * 2026-07-30 y ya fuera de su alcance por el gate de `/negocios`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(c: unknown): any { return c }

type Ctx = { supabase: unknown; user: UserContext }

async function resolverCtx(): Promise<Ctx | { error: string } | null> {
  const { supabase, role, staffId, areas, error } = await getWorkspace()
  if (error) return null
  const modulo = await exigirModulo(REQUISITO.clarity)
  if (!modulo.ok) {
    return { error: modulo.error === 'no_autenticado' ? 'No autenticado' : MENSAJE_MODULO_NO_ACTIVO }
  }
  const user: UserContext = {
    id: staffId ?? '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  }
  return { supabase, user }
}

async function responsablesDe(supabase: unknown, negocioId: string): Promise<string[]> {
  const { data } = await db(supabase)
    .from('negocio_responsables')
    .select('staff_id')
    .eq('negocio_id', negocioId)
  return ((data ?? []) as { staff_id: string }[]).map((r) => r.staff_id)
}

const MENSAJE_SIN_AREA = 'Tu rol o área no permite editar en esta fase del negocio'

/**
 * ¿El bloque vive en una etapa que el negocio YA superó?
 *
 * Una sola consulta: el orden del bloque y el `etapa_actual_id` ya vienen de la
 * lectura principal del guard, así que aquí solo falta el orden de la etapa actual.
 * Se llama SOLO cuando el chequeo de área falló y el rol puede corregir — el camino
 * normal (trabajar la etapa propia) no paga nada.
 *
 * La comparación es la de `esEtapaSuperada`, la misma que usa `contextoCorreccion`
 * para decidir que hay que exigir causa y dejar registro.
 */
async function bloqueDeEtapaSuperada(
  supabase: unknown,
  ordenBloque: number | null | undefined,
  etapaActualId: string | null | undefined,
): Promise<boolean> {
  if (typeof ordenBloque !== 'number' || !etapaActualId) return false
  const { data } = await db(supabase)
    .from('etapas_negocio')
    .select('orden')
    .eq('id', etapaActualId)
    .maybeSingle()
  return esEtapaSuperada(ordenBloque, (data as { orden?: number } | null)?.orden)
}

/** Guard de edición de un bloque por su id (resuelve negocio + stage + responsables). */
export async function guardEditarBloque(
  negocioBloqueId: string,
): Promise<{ ok: boolean; error?: string }> {
  const c = await resolverCtx()
  if (!c) return { ok: false, error: 'No autenticado' }
  if ('error' in c) return { ok: false, error: c.error }
  const { data: nb } = await db(c.supabase)
    .from('negocio_bloques')
    .select('negocio_id, negocios!inner(estado, etapa_actual_id), bloque_configs!inner(config_extra, etapas_negocio!inner(stage, orden))')
    .eq('id', negocioBloqueId)
    .single()
  if (!nb) return { ok: false, error: 'Bloque no encontrado' }
  // Un negocio cerrado sale de circulacion: se ve y se descarga, no se alimenta.
  // El corte va AQUI y no en cada accion porque este es el choke point de toda
  // mutacion de bloques: documentos, formularios, propuesta economica, guia de
  // devolucion y lo que se agregue despues entran por la misma puerta.
  //
  // El estado viaja en la MISMA consulta con `!inner`, asi que no hay un caso "no
  // pude leer el estado" que decidir aparte: si el negocio no esta, `nb` sale nulo
  // y ya cae en la linea de arriba.
  if (negocioCerrado((nb.negocios as { estado: string | null } | null)?.estado)) {
    return { ok: false, error: MENSAJE_NEGOCIO_CERRADO }
  }
  const stage = (nb.bloque_configs?.etapas_negocio?.stage ?? null) as Stage | null
  if (!stage) return { ok: false, error: 'Etapa sin stage' }
  // Áreas invitadas a editar ESTE bloque, aunque el stage sea de otra área.
  const areasExtra = ((nb.bloque_configs as { config_extra?: { areas_editoras?: unknown } | null } | null)
    ?.config_extra?.areas_editoras ?? []) as Area[]
  const resp = await responsablesDe(c.supabase, nb.negocio_id as string)
  if (canEditBloque(c.user, { stage, areasExtra }, resp)) return { ok: true }

  // Segundo intento: corrección HACIA ATRÁS. El área deja de cortar cuando el bloque
  // es de una etapa ya superada y el rol corrige documentos (ver
  // `corrigeHaciaAtrasSinArea`). Se pregunta aquí y no antes para que el camino
  // normal —trabajar un bloque de la etapa propia— no pague una consulta de más;
  // y `corrigeHaciaAtrasSinArea` se evalúa PRIMERO porque es puro y descarta sin IO
  // a operator, contador y read_only, que son la mayoría de los rechazos.
  if (!corrigeHaciaAtrasSinArea(c.user, { esPostAvance: true })) {
    return { ok: false, error: MENSAJE_SIN_AREA }
  }
  const esPostAvance = await bloqueDeEtapaSuperada(
    c.supabase,
    (nb.bloque_configs?.etapas_negocio?.orden ?? null) as number | null,
    ((nb.negocios as { etapa_actual_id?: string | null } | null)?.etapa_actual_id ?? null),
  )
  if (esPostAvance && canEditBloque(c.user, { stage, areasExtra, esPostAvance: true }, resp)) {
    return { ok: true }
  }
  return { ok: false, error: MENSAJE_SIN_AREA }
}

/** Guard de visibilidad de un negocio (operator solo si es responsable). */
export async function guardVerNegocio(
  negocioId: string,
): Promise<{ ok: boolean; error?: string }> {
  const c = await resolverCtx()
  if (!c) return { ok: false, error: 'No autenticado' }
  if ('error' in c) return { ok: false, error: c.error }
  const resp = await responsablesDe(c.supabase, negocioId)
  if (!canViewNegocio(c.user, resp)) return { ok: false, error: 'Sin acceso a este negocio' }
  return { ok: true }
}

/** Guard de avance/cambio de etapa al stage destino. */
export async function guardAvanzarStage(
  negocioId: string,
  stageTo: Stage,
  /**
   * Áreas que la etapa ACTUAL invita a avanzarla (`config_extra.areas_que_avanzan`).
   * Lo resuelve quien llama, que ya tiene la config de la etapa a mano.
   */
  areasQueAvanzan?: Area[],
): Promise<{ ok: boolean; error?: string }> {
  const c = await resolverCtx()
  if (!c) return { ok: false, error: 'No autenticado' }
  if ('error' in c) return { ok: false, error: c.error }
  const resp = await responsablesDe(c.supabase, negocioId)
  if (!canAdvanceStage(c.user, stageTo, resp, areasQueAvanzan)) {
    return { ok: false, error: 'Tu rol o área no permite avanzar a esta fase' }
  }
  return { ok: true }
}

/**
 * ¿El usuario actual es owner/admin? Para overrides (omitir gate, retroceder).
 *
 * OJO — el nombre engaña: esto NO incluye `supervisor`. Es estrictamente
 * owner|admin. Para "¿puede corregir documentos?" (owner/admin/supervisor) usar
 * `puedeCorregirDocumentos(role)` de `src/lib/roles.ts`.
 */
export async function esGerencial(): Promise<boolean> {
  const c = await resolverCtx()
  if (!c || 'error' in c) return false
  return c.user.role === 'owner' || c.user.role === 'admin'
}
