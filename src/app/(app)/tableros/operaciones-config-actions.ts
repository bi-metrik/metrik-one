'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Configuracion del bono de operaciones, mes a mes.
 *
 * El objetivo es que el cliente ajuste su propio bono sin pasar por MeTRIK: que
 * indicadores aplican, cuantos puntos vale cada uno y con que umbrales se juzgan.
 *
 * Dos reglas gobiernan este archivo:
 *
 * 1. **Un mes liquidado no cambia de cifra.** `config_bono_operaciones` sigue siendo
 *    el valor por defecto y `config_bono_operaciones_mes` manda cuando existe. Pero
 *    eso solo no alcanza: un mes SIN fila propia cae al default, asi que mover el
 *    default moveria ese mes. Por eso guardar cualquier cosa **fija primero** todos
 *    los meses anteriores al corriente que no tengan fila. Sin ese paso el congelado
 *    seria una promesa que la base no cumple.
 *
 * 2. **Se escribe con `service_role`, no con el cliente de la sesion.** La tabla le
 *    da SELECT a `authenticated` y nada mas, a proposito: de aqui cuelga plata y el
 *    gate de rol se decide en el servidor. Ya hubo un incidente exactamente por lo
 *    contrario: `reproceso_eventos` perdia los inserts con 42501 en silencio porque
 *    el escritor usaba el cliente de la sesion.
 */

/** Campos que el cliente puede mover. `workspace_id`, `anio` y `mes` no son de esta lista. */
const CAMPOS = [
  'calidad_base', 'calidad_tramo', 'calidad_frac_un_malo', 'calidad_malos_pierde_todo',
  'peso_radicacion', 'peso_envio', 'peso_correcciones',
  'piso_operativo', 'techo_operativo',
  'horas_radicacion', 'horas_desde_certificado', 'horas_antes_cita',
  'radicacion_reloj', 'jornada_inicio_hora', 'jornada_fin_hora', 'jornada_sabado_habil',
  'correcciones_cobertura', 'etapa_radicacion_dian_orden',
  'bono_max_pct', 'bono_max_pct_director', 'piso_director', 'techo_director',
] as const

export type CampoConfigBono = (typeof CAMPOS)[number]
export type ConfigBonoMes = Partial<Record<CampoConfigBono, number | string | boolean>>

/**
 * Quien puede mover la politica del bono. Es el mismo grupo que ya puede ver el dinero
 * de todo el equipo (`puedeVerTodoElDinero` en `operaciones-actions.ts`): quien no
 * puede ver un bono ajeno tampoco puede cambiar como se calcula.
 */
function puedeConfigurar(role: string | null): boolean {
  return ['owner', 'admin', 'supervisor'].includes(role || '')
}

/**
 * Fija los meses viejos que todavia siguen al default, para que el cambio que viene
 * no los toque. Idempotente: solo escribe donde no hay fila.
 */
async function congelarMesesPasados(
  svc: ReturnType<typeof createServiceClient>,
  workspaceId: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (svc as any).rpc('congelar_config_bono_meses_pasados', {
    p_workspace_id: workspaceId,
  })
  if (error) throw new Error(`No se pudieron congelar los meses pasados: ${error.message}`)
}

export async function guardarConfigBonoMes(
  anio: number,
  mes: number,
  valores: ConfigBonoMes,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, workspaceId, role, staffId } = await getWorkspace()
  if (!supabase || !workspaceId) return { ok: false, error: 'Sesión sin espacio de trabajo.' }
  if (!puedeConfigurar(role)) {
    return { ok: false, error: 'No tienes permiso para cambiar la política del bono.' }
  }
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return { ok: false, error: 'Periodo inválido.' }
  }

  // Solo lo que esta en la lista blanca llega a la base. Un `...valores` suelto aqui
  // dejaria que el navegador escriba columnas que nadie penso en exponer.
  const limpio: Record<string, unknown> = {}
  for (const campo of CAMPOS) {
    if (valores[campo] !== undefined) limpio[campo] = valores[campo]
  }
  if (Object.keys(limpio).length === 0) return { ok: false, error: 'No hay nada que guardar.' }

  const svc = createServiceClient()
  try {
    await congelarMesesPasados(svc, workspaceId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error congelando meses.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (svc as any)
    .from('config_bono_operaciones_mes')
    .upsert(
      {
        workspace_id: workspaceId,
        anio,
        mes,
        ...limpio,
        actualizado_por: staffId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,anio,mes' },
    )
  if (error) return { ok: false, error: error.message }

  revalidatePath('/tableros')
  revalidatePath('/equipo')
  return { ok: true }
}

/**
 * Devuelve la configuracion de un mes tal como esta guardada, o null si ese mes
 * todavia sigue el valor por defecto. La configuracion EFECTIVA (con la caida al
 * default ya resuelta) viaja dentro de `getOperacionesBono`, en `parametros`: no se
 * resuelve dos veces en dos lugares distintos, que es como se producen dos verdades.
 */
export async function getConfigBonoMes(anio: number, mes: number) {
  const { supabase, workspaceId, role } = await getWorkspace()
  if (!supabase || !workspaceId) return null
  if (!puedeConfigurar(role)) return null

  // Los tipos generados de Supabase van por detras del esquema: la tabla es nueva.
  // Mismo patron que `operaciones-actions.ts` con la RPC del resumen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('config_bono_operaciones_mes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('anio', anio)
    .eq('mes', mes)
    .maybeSingle()
  return data ?? null
}
