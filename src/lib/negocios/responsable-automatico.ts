/**
 * Responsable automático al entrar a una etapa (SOE-016).
 *
 * Una etapa puede declarar quién toma el caso cuando llega:
 *
 *   etapas_negocio.config_extra.responsable_automatico = { rol: 'operaciones', staff_id: '<staff.id>' }
 *
 * Lo pidió SOENA (Deisy, 2026-10-14): los casos que llegan a Cargue, Cita y Anexos los asignaba
 * ella a mano a Camila. Se declara por ETAPA y con una persona concreta porque así lo dice la
 * operación («a esta etapa la atiende esta persona»); un reparto por área o por carga sería otra
 * regla, y nadie la pidió.
 *
 * Reglas:
 *   · No pisa una decisión humana: si el negocio ya tiene alguien en ese rol, no lo cambia.
 *   · Si el staff configurado no está activo, no es del workspace o no tiene el área del rol, no
 *     asigna y lo deja en el log del servidor. El avance de etapa sigue igual.
 *   · Escribe por `asignarResponsable` (fila con rol + línea en el timeline), con `assigned_by`
 *     NULL, `asignado_origen = 'regla_etapa'` con la etapa, y una nota que dice que fue automático.
 *   · Nunca lanza: un fallo aquí no puede tumbar el movimiento de etapa que ya ocurrió.
 *
 * Quien mueve la etapa la llama DESPUÉS del UPDATE exitoso, con el mismo cliente con el que movió
 * (la sesión, o `service_role` en los crons), siempre con el workspace del negocio.
 */

import { asignarResponsable, type RolResponsable } from '@/lib/negocios/responsable-rol'
import { sincronizarResponsablePrincipal } from '@/lib/negocios/crear-negocio'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

export type ConfigResponsableAutomatico = { rol: RolResponsable; staff_id: string }

export type ResultadoResponsableAutomatico =
  | 'sin_configuracion'
  | 'ya_tiene_responsable'
  | 'staff_no_disponible'
  | 'staff_sin_area'
  | 'asignado'
  | 'error'

/** Lee la configuración de la etapa. Cualquier forma inválida cuenta como «sin configuración». */
export function leerResponsableAutomatico(configExtra: unknown): ConfigResponsableAutomatico | null {
  const raw = (configExtra as { responsable_automatico?: unknown } | null)?.responsable_automatico
  if (!raw || typeof raw !== 'object') return null
  const { rol, staff_id } = raw as { rol?: unknown; staff_id?: unknown }
  if (rol !== 'comercial' && rol !== 'operaciones') return null
  if (typeof staff_id !== 'string' || !staff_id) return null
  return { rol, staff_id }
}

export async function asignarResponsableAlEntrar(
  supabase: unknown,
  p: { negocioId: string; etapaId: string; workspaceId: string },
): Promise<ResultadoResponsableAutomatico> {
  try {
    const { data: etapa } = await db(supabase)
      .from('etapas_negocio')
      .select('nombre, config_extra')
      .eq('id', p.etapaId)
      .maybeSingle()
    const cfg = leerResponsableAutomatico((etapa as { config_extra?: unknown } | null)?.config_extra)
    if (!cfg) return 'sin_configuracion'
    const nombreEtapa = (etapa as { nombre?: string | null }).nombre ?? 'la etapa'

    const { data: ocupante } = await db(supabase)
      .from('negocio_responsables')
      .select('staff_id')
      .eq('negocio_id', p.negocioId)
      .eq('rol', cfg.rol)
      .maybeSingle()
    if (ocupante) return 'ya_tiene_responsable'

    const { data: staff } = await db(supabase)
      .from('staff')
      .select('id, is_active')
      .eq('id', cfg.staff_id)
      .eq('workspace_id', p.workspaceId)
      .maybeSingle()
    if (!staff || (staff as { is_active: boolean | null }).is_active !== true) {
      console.warn(
        `[responsable automático] no se asignó: el staff ${cfg.staff_id} no está activo en el workspace ` +
          `(negocio=${p.negocioId}, etapa=${nombreEtapa})`,
      )
      return 'staff_no_disponible'
    }

    const { data: areasRaw } = await db(supabase)
      .from('staff_areas')
      .select('area')
      .eq('staff_id', cfg.staff_id)
    const areas = ((areasRaw ?? []) as Array<{ area: string }>).map((a) => a.area)
    if (!areas.includes(cfg.rol)) {
      console.warn(
        `[responsable automático] no se asignó: el staff ${cfg.staff_id} no tiene el área ${cfg.rol} ` +
          `(negocio=${p.negocioId}, etapa=${nombreEtapa})`,
      )
      return 'staff_sin_area'
    }

    const res = await asignarResponsable(supabase, {
      negocioId: p.negocioId,
      staffId: cfg.staff_id,
      assignedBy: null,
      rol: cfg.rol,
      nota: `asignado automáticamente al entrar a ${nombreEtapa}`,
      // La campanita y el detalle dicen «al entrar a la etapa <Etapa>» (migración 20261026090000).
      origen: 'regla_etapa',
      etapaId: p.etapaId,
    })
    if (res.error) {
      console.error(`[responsable automático] no se pudo asignar (negocio=${p.negocioId}): ${res.error}`)
      return 'error'
    }
    await sincronizarResponsablePrincipal(supabase, p.negocioId, p.workspaceId)
    return 'asignado'
  } catch (e) {
    console.error(
      `[responsable automático] falló (negocio=${p.negocioId}, etapa=${p.etapaId}):`,
      e instanceof Error ? e.message : e,
    )
    return 'error'
  }
}
