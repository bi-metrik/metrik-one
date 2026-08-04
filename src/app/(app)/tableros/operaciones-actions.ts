'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import type { OperacionesBonoData, OperacionesDetalleData } from './operaciones-types'

/**
 * Tablero de bono de operaciones.
 *
 * ⚠️ EL DINERO NO SE FILTRA EN EL CLIENTE. La RPC calcula el bono de todo el
 * equipo porque necesita el salario para hacerlo, pero el salario nunca sale de
 * la base y el bono ajeno nunca cruza al browser: se recorta aqui, en el
 * servidor, antes de serializar. Mandarlo y ocultarlo con CSS o con un `if` en
 * React lo deja visible en el payload de la pagina para cualquiera que abra las
 * herramientas del navegador.
 *
 * Regla acordada con la supervisora: cada operativo ve los indicadores de todos
 * (la comparacion es deliberada, motiva), pero el valor en pesos solo el propio.
 */
function puedeVerTodoElDinero(role: string | null): boolean {
  return ['owner', 'admin', 'supervisor'].includes(role || '')
}

export async function getOperacionesBono(
  anio: number,
  mes: number,
): Promise<OperacionesBonoData | null> {
  const { supabase, workspaceId, role, staffId } = await getWorkspace()
  if (!supabase || !workspaceId) return null

  // Los tipos generados de Supabase van por detras del esquema: la RPC es nueva.
  // Mismo patron que `comercial-actions.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_operaciones_bono_resumen', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })
  if (error || !data) return null

  const bruto = data as unknown as OperacionesBonoData
  const verTodo = puedeVerTodoElDinero(role)

  return {
    ...bruto,
    personas: (bruto.personas ?? []).map((p) => ({
      ...p,
      bono: verTodo || p.staff_id === staffId ? p.bono : undefined,
    })),
    supervisor: bruto.supervisor
      ? {
          ...bruto.supervisor,
          bono:
            verTodo || bruto.supervisor.staff_id === staffId
              ? bruto.supervisor.bono
              : undefined,
        }
      : null,
  }
}

/**
 * Detalle caso por caso de una persona. El porcentaje no sirve para conversar:
 * cuando alguien pregunta "por que perdi el indicador", la respuesta es la lista
 * de casos con sus horas.
 */
export async function getOperacionesDetalle(
  staffId: string,
  anio: number,
  mes: number,
): Promise<OperacionesDetalleData | null> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!supabase || !workspaceId) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_operaciones_bono_detalle', {
    p_staff_id: staffId,
    p_anio: anio,
    p_mes: mes,
  })
  if (error || !data) return null
  return data as unknown as OperacionesDetalleData
}
