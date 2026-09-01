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

/**
 * Rangos de cada campo. No es cosmetica: de aqui cuelga plata y el formulario no es
 * la unica puerta a esta accion. Un `peso_radicacion` de 5 no falla en la base (es un
 * numeric) y multiplicaria el bono por cinco sin que nada avise.
 */
const RANGO: Partial<Record<CampoConfigBono, [number, number]>> = {
  calidad_base: [0, 1], calidad_tramo: [0, 1], calidad_frac_un_malo: [0, 1],
  calidad_malos_pierde_todo: [1, 99],
  peso_radicacion: [0, 1], peso_envio: [0, 1], peso_correcciones: [0, 1],
  // El piso puede ser 0 (sin piso). El techo NO: es divisor en la formula del score.
  piso_operativo: [0, 1], techo_operativo: [0.01, 1],
  piso_director: [0, 1], techo_director: [0.01, 1],
  horas_radicacion: [1, 8760], horas_desde_certificado: [1, 8760], horas_antes_cita: [1, 8760],
  jornada_inicio_hora: [0, 23], jornada_fin_hora: [1, 24],
  etapa_radicacion_dian_orden: [1, 999],
  bono_max_pct: [0, 1], bono_max_pct_director: [0, 1],
}

function validar(v: Record<string, unknown>): string | null {
  for (const [campo, valor] of Object.entries(v)) {
    const rango = RANGO[campo as CampoConfigBono]
    if (!rango) continue
    const n = Number(valor)
    if (!Number.isFinite(n)) return `${campo} no es un número.`
    if (n < rango[0] || n > rango[1]) return `${campo} debe estar entre ${rango[0]} y ${rango[1]}.`
  }
  if (v.radicacion_reloj !== undefined && !['habil', 'corrido'].includes(String(v.radicacion_reloj))) {
    return 'El reloj de radicación solo puede ser hábil o corrido.'
  }
  if (v.correcciones_cobertura !== undefined
      && !['devolucion_dian', 'cualquier_reproceso'].includes(String(v.correcciones_cobertura))) {
    return 'La cobertura de correcciones no es válida.'
  }
  const ini = v.jornada_inicio_hora, fin = v.jornada_fin_hora
  if (ini !== undefined && fin !== undefined && Number(fin) <= Number(ini)) {
    return 'La jornada tiene que terminar después de empezar.'
  }
  return null
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

  const invalido = validar(limpio)
  if (invalido) return { ok: false, error: invalido }

  const svc = createServiceClient()
  try {
    await congelarMesesPasados(svc, workspaceId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error congelando meses.' }
  }

  // ⚠️ La fila del mes se escribe COMPLETA, no solo con lo que cambio. Todas las
  // columnas de `config_bono_operaciones_mes` son NOT NULL, asi que un upsert parcial
  // que INSERTA toma los DEFAULT de la tabla para lo que no viaje, no los valores
  // vigentes del workspace. Guardar solo "suspender envío" en un mes nuevo habria
  // reescrito en silencio las horas, los pisos y el porcentaje del bono con los
  // valores de fabrica. Se resuelve la fila efectiva y encima va el cambio.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: base } = await (svc as any)
    .from('config_bono_operaciones')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!base) return { ok: false, error: 'Este espacio de trabajo no tiene política de bono configurada.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: delMes } = await (svc as any)
    .from('config_bono_operaciones_mes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('anio', anio)
    .eq('mes', mes)
    .maybeSingle()

  const fila: Record<string, unknown> = {}
  for (const campo of CAMPOS) {
    const vigente = delMes?.[campo] ?? base[campo]
    fila[campo] = limpio[campo] !== undefined ? limpio[campo] : vigente
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (svc as any)
    .from('config_bono_operaciones_mes')
    .upsert(
      {
        workspace_id: workspaceId,
        anio,
        mes,
        ...fila,
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
 * Las etapas de la linea, para elegir cual marca la radicacion ante la DIAN. Se
 * ofrecen por NOMBRE y orden porque asi las nombra quien configura, aunque lo que se
 * guarda es el orden: es lo unico estable si la etapa se renombra.
 */
export async function getEtapasParaBono(): Promise<{ orden: number; nombre: string }[]> {
  const { supabase, workspaceId, role } = await getWorkspace()
  if (!supabase || !workspaceId) return []
  if (!puedeConfigurar(role)) return []

  const { data } = await supabase
    .from('etapas_negocio')
    .select('orden, nombre, lineas_negocio!inner(workspace_id)')
    .eq('lineas_negocio.workspace_id', workspaceId)
    .order('orden')
  return ((data ?? []) as unknown as { orden: number; nombre: string }[])
    .map((e) => ({ orden: e.orden, nombre: e.nombre }))
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

/**
 * Si quien mira puede cambiar la politica del bono.
 *
 * Se pregunta al servidor en vez de recibirlo como prop porque esta pantalla se monta
 * desde DOS lugares (`/tableros` y `/equipo`) y cada uno tendria que acordarse de
 * pasarlo: el dia que uno se olvide, el boton desaparece sin que nadie lo note. Aqui
 * el criterio es el mismo `puedeConfigurar` que aplica la escritura, asi que no puede
 * decir una cosa y la accion otra. El gate real sigue estando en el guardado; esto
 * solo decide si se dibuja el boton.
 */
export async function puedeConfigurarBono(): Promise<boolean> {
  const { workspaceId, role } = await getWorkspace()
  return Boolean(workspaceId) && puedeConfigurar(role)
}
