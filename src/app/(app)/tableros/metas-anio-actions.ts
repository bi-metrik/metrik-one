'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import {
  aNumero, aTexto, filasVacias,
  type FilaMetaAnio,
} from '@/lib/metas/anio'

/**
 * Metas de un año completo — carga y guardado.
 *
 * Vive aparte de `comercial-actions.ts` porque no consulta ninguna RPC del
 * tablero: solo lee y escribe las dos tablas de metas.
 *
 * ⚠️ Son DOS tablas para lo mismo, y ese es el detalle que hay que tener en
 * mente al tocar esto:
 *  - `metas_comerciales` (workspace, staff, año, mes) — la lee el tablero
 *    Comercial. `staff_id NULL` es la meta del equipo.
 *  - `config_metas` (workspace, mes) — la lee la pestaña Dirección y /numeros.
 *
 * Las metas del EQUIPO se escriben en las dos, con el mismo número: mientras
 * cada tablero lea su tabla, escribir en una sola las deja discrepando. Se
 * midió: en agosto de 2026, `config_metas` decía 100 negocios y las metas por
 * vendedor sumaban exactamente 100, escrito dos veces a mano.
 */

const ROLES_EDITAN_METAS = ['owner', 'admin', 'supervisor']

/** Primer día del mes, que es como `config_metas` guarda el periodo. */
function primerDia(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-01`
}

export type MetasAnioData = {
  anio: number
  staffId: string | null
  filas: FilaMetaAnio[]
}

/**
 * Las doce filas del año para un alcance. Siempre devuelve doce, con los meses
 * sin meta en blanco: la tabla se dibuja completa y el vacío es un dato ("sin
 * meta fijada"), no una fila que falta.
 */
export async function getMetasAnio(
  anio: number,
  staffId: string | null,
): Promise<MetasAnioData | null> {
  const { supabase, workspaceId, role } = await getWorkspace()
  if (!supabase || !workspaceId) return null
  if (!ROLES_EDITAN_METAS.includes(role ?? '')) return null

  let q = (supabase as never as { from: (t: string) => any }) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from('metas_comerciales')
    .select('staff_id, mes, meta_num_ventas, meta_valor')
    .eq('workspace_id', workspaceId)
    .eq('anio', anio)
  q = staffId === null ? q.is('staff_id', null) : q.eq('staff_id', staffId)
  const { data: comerciales } = await q

  // Las metas de embudo son del workspace y solo se ofrecen en el alcance equipo.
  const { data: config } = staffId === null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (supabase as any)
        .from('config_metas')
        .select('mes, meta_leads_mensual, meta_leads_calificados_mensual')
        .eq('workspace_id', workspaceId)
        .gte('mes', primerDia(anio, 1))
        .lte('mes', primerDia(anio, 12))
    : { data: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const porMesComercial = new Map<number, any>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((comerciales ?? []) as any[]).map((r) => [Number(r.mes), r]),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const porMesConfig = new Map<number, any>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((config ?? []) as any[]).map((r) => [Number(String(r.mes).slice(5, 7)), r]),
  )

  const filas = filasVacias().map((f) => {
    const c = porMesComercial.get(f.mes)
    const g = porMesConfig.get(f.mes)
    return {
      ...f,
      metaLeads: aTexto(g?.meta_leads_mensual),
      metaLeadsCalificados: aTexto(g?.meta_leads_calificados_mensual),
      metaNumVentas: aTexto(c?.meta_num_ventas),
      metaValor: aTexto(c?.meta_valor),
    }
  })

  return { anio, staffId, filas }
}

/**
 * Guarda los meses que cambiaron. `filas` trae SOLO esos: el cliente hace el
 * diff, porque reescribir los doce pisaría el mes que otra persona acaba de
 * fijar y que aquí ni se abrió.
 */
export async function guardarMetasAnio(input: {
  anio: number
  staffId: string | null
  filas: FilaMetaAnio[]
}): Promise<{ ok: boolean; error?: string; guardados?: number }> {
  const { supabase, workspaceId, role, userId } = await getWorkspace()
  if (!workspaceId || !supabase) return { ok: false, error: 'Sin sesion' }
  if (!ROLES_EDITAN_METAS.includes(role ?? '')) {
    return { ok: false, error: 'Solo un supervisor, administrador o dueno puede editar metas.' }
  }
  if (input.filas.length === 0) return { ok: true, guardados: 0 }
  if (input.filas.some((f) => f.mes < 1 || f.mes > 12)) {
    return { ok: false, error: 'Mes fuera de rango' }
  }

  const ahora = new Date().toISOString()
  const { error: errComercial } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from('metas_comerciales')
    .upsert(
      input.filas.map((f) => ({
        workspace_id: workspaceId,
        staff_id: input.staffId,
        anio: input.anio,
        mes: f.mes,
        meta_num_ventas: aNumero(f.metaNumVentas),
        meta_valor: aNumero(f.metaValor),
        created_by: userId ?? null,
        updated_at: ahora,
      })),
      { onConflict: 'workspace_id,staff_id,anio,mes' },
    )
  if (errComercial) return { ok: false, error: errComercial.message }

  // Las metas del equipo van tambien a `config_metas`, que es la que leen la
  // pestaña Direccion y /numeros. Solo se tocan las columnas de meta: un upsert
  // parcial deja intactas las demas de esa fila (ej. `meta_recaudo_mensual`).
  if (input.staffId === null) {
    const { error: errConfig } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .from('config_metas')
      .upsert(
        input.filas.map((f) => ({
          workspace_id: workspaceId,
          mes: primerDia(input.anio, f.mes),
          meta_leads_mensual: aNumero(f.metaLeads),
          meta_leads_calificados_mensual: aNumero(f.metaLeadsCalificados),
          meta_negocios_mensual: aNumero(f.metaNumVentas),
          meta_ventas_mensual: aNumero(f.metaValor),
          updated_at: ahora,
        })),
        { onConflict: 'workspace_id,mes' },
      )
    if (errConfig) return { ok: false, error: errConfig.message }
  }

  revalidatePath('/tableros')
  revalidatePath('/equipo')
  revalidatePath('/numeros')
  return { ok: true, guardados: input.filas.length }
}
