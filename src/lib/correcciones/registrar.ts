import 'server-only'

import { STAGE_TO_AREA, type Stage } from '@/lib/permissions/can-edit'

/**
 * Registro de correcciones sobre bloques de etapas ya superadas.
 *
 * Complementa la marca `data._ediciones` (quién y cuándo) con lo que faltaba para
 * poder mirar esto de forma agregada: QUÉ decía antes, QUÉ dice ahora, POR QUÉ se
 * cambió y a QUÉ ÁREA pertenece el bloque que se corrigió.
 *
 * Tres decisiones:
 *
 * 1. **El área es la del bloque corregido, no la de quien corrige.** Es lo que hace
 *    que el número responda "qué área se equivoca más" y no "quién limpia más
 *    errores ajenos".
 *
 * 2. **La sesión agrupa (una causa, N campos).** El id lo genera el cliente al abrir
 *    la corrección. Solo agrupa: no autoriza nada, y todo lo que importa (quién,
 *    área, valores) lo resuelve el servidor contra lo persistido.
 *
 * 3. **El timeline no puede mostrar un valor intermedio.** El guardado de un bloque
 *    de datos es un autosave que dispara cada 800 ms: si cada pulsación insertara su
 *    evento, el timeline quedaría lleno de valores a medio escribir. Por eso la
 *    primera vez se inserta el evento y las siguientes lo ACTUALIZAN, vía el
 *    `activity_log_id` que queda guardado en la fila.
 */

import { LABEL_CAUSA, type CausaCorreccion } from './causas'
import { registrarActividad, actualizarActividad } from '@/lib/activity/registrar-actividad'

export { esCausaValida, type CausaCorreccion } from './causas'

export type CampoCorregido = { slug: string; antes: unknown; despues: unknown }

/** Los valores se guardan como texto legible: la tabla es para leer, no para recalcular. */
function aTexto(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 500)
  return String(v).slice(0, 500)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

type ContextoBloque = {
  negocioId: string
  bloqueNombre: string | null
  bloqueSlug: string | null
  etapaId: string | null
  etapaNombre: string | null
  etapaOrden: number | null
  area: 'comercial' | 'operaciones' | 'financiera' | null
}

async function contextoDelBloque(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioBloqueId: string,
): Promise<ContextoBloque | null> {
  const { data } = await db(supabase)
    .from('negocio_bloques')
    .select(`
      negocio_id,
      bloque_configs!inner(
        nombre, slug,
        etapas_negocio!inner(id, nombre, orden, stage)
      )
    `)
    .eq('id', negocioBloqueId)
    .maybeSingle()

  if (!data) return null
  const cfg = (data as Record<string, unknown>).bloque_configs as
    | { nombre?: string; slug?: string; etapas_negocio?: { id: string; nombre: string; orden: number; stage: string } }
    | null
  const etapa = cfg?.etapas_negocio ?? null
  // `direccion` es transversal: cubre las tres áreas operativas, así que no puede ser
  // dueña de un error. Hoy `STAGE_TO_AREA` no la devuelve nunca (venta, ejecución y
  // cobro mapean a las tres operativas), pero el tipo la admite: se descarta aquí en
  // vez de dejar que el CHECK de la tabla falle en silencio si eso cambiara.
  const areaCruda = etapa ? STAGE_TO_AREA[etapa.stage as Stage] ?? null : null
  const area = areaCruda === 'direccion' ? null : areaCruda

  return {
    negocioId: (data as { negocio_id: string }).negocio_id,
    bloqueNombre: cfg?.nombre ?? null,
    bloqueSlug: cfg?.slug ?? null,
    etapaId: etapa?.id ?? null,
    etapaNombre: etapa?.nombre ?? null,
    etapaOrden: etapa?.orden ?? null,
    area,
  }
}

/**
 * ¿Se está escribiendo sobre un bloque de una etapa que el negocio YA superó?
 * Es la diferencia entre "trabajar la etapa" y "corregir hacia atrás", y define si
 * aplica el opt-in de corrección, la causa obligatoria y la marca de autoría.
 *
 * Vive aquí, y no dentro de las acciones de negocios, porque lo necesitan por igual
 * la corrección de bloques de datos y la de campos de documento: dos copias de esta
 * regla se separan en cuanto alguien toque una.
 */
export async function contextoCorreccion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioBloqueId: string,
): Promise<{ esPostAvance: boolean; permiteCorregir: boolean; dataPrevia: Record<string, unknown> } | null> {
  const { data: nb } = await db(supabase)
    .from('negocio_bloques')
    .select('negocio_id, data, bloque_configs!inner(config_extra, etapas_negocio!inner(orden))')
    .eq('id', negocioBloqueId)
    .single()
  if (!nb) return null

  const ordenBloque = nb.bloque_configs?.etapas_negocio?.orden as number | undefined
  const { data: neg } = await db(supabase)
    .from('negocios')
    .select('etapa_actual_id')
    .eq('id', nb.negocio_id)
    .single()
  const { data: etapaActual } = neg?.etapa_actual_id
    ? await db(supabase).from('etapas_negocio').select('orden').eq('id', neg.etapa_actual_id).single()
    : { data: null }

  const ordenActual = (etapaActual as { orden?: number } | null)?.orden
  const cfg = (nb.bloque_configs?.config_extra ?? {}) as { corregir_campos_gerencial?: boolean }
  return {
    esPostAvance: ordenBloque !== undefined && ordenActual !== undefined && ordenBloque < ordenActual,
    permiteCorregir: cfg.corregir_campos_gerencial === true,
    dataPrevia: (nb.data ?? {}) as Record<string, unknown>,
  }
}

/**
 * Deja registrada la corrección de uno o varios campos del mismo bloque.
 *
 * No lanza: un fallo aquí no puede tumbar el guardado del dato (el dato corregido es
 * el trabajo; el registro es la traza). Devuelve cuántas filas quedaron escritas para
 * que quien llama pueda loguear si algo no cuadró.
 */
export async function registrarCorrecciones(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  workspaceId: string
  /** profile.id — queda en `corregido_por` de esta tabla. */
  userId: string | undefined
  /**
   * staff.id — es lo ÚNICO que acepta `activity_log.autor_id` (FK → staff).
   * Pasarle el profile.id viola la FK y el evento del timeline se pierde sin ruido:
   * pasó con la primera corrección real (V0254, 2026-08-03), que quedó registrada en
   * la tabla y ausente del timeline. `profiles` y `staff` son tablas distintas y este
   * campo es el que más se confunde de las dos.
   */
  staffId: string | null | undefined
  userNombre?: string | null
  negocioBloqueId: string
  campos: CampoCorregido[]
  causa: CausaCorreccion
  sesionId: string
}): Promise<{ registradas: number }> {
  const { supabase, workspaceId, userId, staffId, negocioBloqueId, campos, causa, sesionId } = params
  if (campos.length === 0) return { registradas: 0 }

  try {
    const ctx = await contextoDelBloque(supabase, negocioBloqueId)
    if (!ctx) return { registradas: 0 }

    let nombre = params.userNombre ?? null
    if (!nombre && userId) {
      const { data: prof } = await db(supabase).from('profiles').select('full_name').eq('id', userId).maybeSingle()
      nombre = (prof?.full_name as string | null) ?? null
    }

    // Filas ya escritas en esta sesión: definen qué es insert y qué es refresco.
    const { data: previas } = await db(supabase)
      .from('bloque_correcciones')
      .select('id, campo_slug, activity_log_id')
      .eq('negocio_bloque_id', negocioBloqueId)
      .eq('sesion_id', sesionId)

    const yaRegistrado = new Map<string, { id: string; activity_log_id: string | null }>()
    for (const p of ((previas ?? []) as Array<{ id: string; campo_slug: string; activity_log_id: string | null }>)) {
      yaRegistrado.set(p.campo_slug, { id: p.id, activity_log_id: p.activity_log_id })
    }

    const ahora = new Date().toISOString()
    let registradas = 0

    for (const campo of campos) {
      const antes = aTexto(campo.antes)
      const despues = aTexto(campo.despues)
      const dondeVive = ctx.etapaNombre ? ` en ${ctx.etapaNombre}` : ''
      const contenido =
        `Corrigió «${campo.slug}»${dondeVive}: ${antes ?? 'vacío'} → ${despues ?? 'vacío'}. ` +
        `Causa: ${LABEL_CAUSA[causa]}.`

      const existente = yaRegistrado.get(campo.slug)

      if (existente) {
        // Mismo campo, misma corrección: se refresca el valor final, nunca el previo.
        await db(supabase)
          .from('bloque_correcciones')
          .update({ valor_nuevo: despues, updated_at: ahora })
          .eq('id', existente.id)

        if (existente.activity_log_id) {
          await actualizarActividad(
            supabase,
            existente.activity_log_id,
            { valor_nuevo: despues, contenido: contenido.slice(0, 280) },
            'correcciones',
          )
        }
        registradas++
        continue
      }

      // `tipo` sale del catálogo (`ACTIVITY_LOG_TIPOS`), así que un valor fuera del
      // CHECK ya no compila; y `registrarActividad` lee el error, así que si Postgres
      // rechaza la fila por otra razón (la FK de `autor_id`, RLS) tampoco se pierde en
      // silencio: la corrección quedaría en su tabla y ausente del timeline, que es
      // donde la gente la busca.
      const evento = await registrarActividad(supabase, {
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: ctx.negocioId,
        tipo: 'cambio',
        // staff.id, NO profile.id (ver el comentario del parámetro).
        autor_id: staffId ?? null,
        campo_modificado: campo.slug,
        valor_anterior: antes,
        valor_nuevo: despues,
        contenido: contenido.slice(0, 280),
      }, 'correcciones')

      const { error: errIns } = await db(supabase)
        .from('bloque_correcciones')
        .insert({
          workspace_id: workspaceId,
          negocio_id: ctx.negocioId,
          negocio_bloque_id: negocioBloqueId,
          bloque_slug: ctx.bloqueSlug,
          bloque_nombre: ctx.bloqueNombre,
          etapa_id: ctx.etapaId,
          etapa_nombre: ctx.etapaNombre,
          etapa_orden: ctx.etapaOrden,
          area: ctx.area,
          campo_slug: campo.slug,
          valor_anterior: antes,
          valor_nuevo: despues,
          causa,
          sesion_id: sesionId,
          corregido_por: userId ?? null,
          corregido_por_nombre: nombre,
          activity_log_id: evento.id,
        })

      if (!errIns) registradas++
    }

    return { registradas }
  } catch (err) {
    console.error('[correcciones] no se pudo registrar la traza:', err)
    return { registradas: 0 }
  }
}
