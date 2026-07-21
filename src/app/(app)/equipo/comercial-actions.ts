'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { bogotaYearMonth } from '@/lib/dates/bogota'
import type { ComercialResumenRow, ComercialPerfil } from './comercial-types'

/**
 * Resumen comercial por responsable del workspace activo (incluye bucket sin
 * responsable). Alimenta la vista /equipo en workspaces con
 * modules.comercial_negocios. Sobre negocios+responsable_id, NO ventas_hechos.
 */
export async function getComercialResumen(
  anio: number | null = null,
  mes: number | null = null,
): Promise<ComercialResumenRow[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_comercial_resumen_soena', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })
  return (data as ComercialResumenRow[]) ?? []
}

/**
 * Perfil de un responsable. staffId === 'sin-responsable' resuelve el bucket de
 * negocios sin responsable_id (la RPC lo interpreta como p_responsable_id NULL).
 */
export async function getComercialPerfil(
  staffId: string,
  anio: number | null = null,
  mes: number | null = null,
): Promise<ComercialPerfil | null> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!workspaceId || !supabase) return null
  const responsableId = staffId === 'sin-responsable' ? null : staffId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_comercial_perfil_soena', {
    p_responsable_id: responsableId,
    p_anio: anio,
    p_mes: mes,
  })
  if (!data) return null
  return data as ComercialPerfil
}

// ── Iteracion 2: KPIs del mes, series, metas ──

import { revalidatePath } from 'next/cache'
import type {
  ComercialMesResponse,
  ComercialSerieResponse,
  MetaComercial,
} from './comercial-types'

/** KPIs + tabla por vendedor de un mes (default: mes actual Bogota). */
export async function getComercialMes(anio: number, mes: number): Promise<ComercialMesResponse | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_comercial_kpis_mes_soena', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })
  return (data as ComercialMesResponse) ?? null
}

/** Serie historica de los ultimos N meses. */
export async function getComercialSerie(meses = 12): Promise<ComercialSerieResponse | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_comercial_serie_mensual_soena', {
    p_workspace_id: workspaceId,
    p_meses: meses,
  })
  return (data as ComercialSerieResponse) ?? null
}

/** Metas del mes (global + por vendedor) para la mini UI de edicion. */
export async function getMetasComerciales(anio: number, mes: number): Promise<MetaComercial[]> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!workspaceId || !supabase) return []
  // metas_comerciales aun no esta en database.ts generado -> cast puntual (mismo patron que otras tablas nuevas).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('metas_comerciales')
    .select('id, staff_id, anio, mes, meta_num_ventas, meta_valor')
    .eq('workspace_id', workspaceId)
    .eq('anio', anio)
    .eq('mes', mes)
  return (data as MetaComercial[]) ?? []
}

/**
 * Mapa staff_id -> meta_num_ventas para un PERIODO, para el ranking de cumplimiento.
 *
 * - Por mes (anio+mes): la meta de ese vendedor en ese mes.
 * - Acumulado (anio+mes null): SUMA de las metas mensuales del vendedor en el anio
 *   en curso (Bogota). No se usa la meta global ni se reparte: un vendedor sin metas
 *   propias no aparece en el mapa (degrada a "sin meta" en el ranking).
 *
 * Solo cuenta metas con staff_id (por vendedor). La meta global (staff_id NULL) NO
 * entra: el cumplimiento por vendedor exige meta por vendedor.
 */
export async function getMetasPorVendedorPeriodo(
  anio: number | null,
  mes: number | null,
): Promise<Map<string, number>> {
  const { supabase, workspaceId } = await getWorkspace()
  const out = new Map<string, number>()
  if (!workspaceId || !supabase) return out
  // Acumulado: sumar todas las metas del anio en curso (Bogota). Por mes: solo ese mes.
  const anioBase = anio ?? Number(bogotaYearMonth().split('-')[0])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('metas_comerciales')
    .select('staff_id, meta_num_ventas, mes')
    .eq('workspace_id', workspaceId)
    .eq('anio', anioBase)
    .not('staff_id', 'is', null)
  if (mes != null) query = query.eq('mes', mes)
  const { data } = await query
  for (const row of (data as { staff_id: string; meta_num_ventas: number | null }[]) ?? []) {
    if (!row.staff_id || row.meta_num_ventas == null) continue
    out.set(row.staff_id, (out.get(row.staff_id) ?? 0) + row.meta_num_ventas)
  }
  return out
}

// Editar metas: misma puerta que conciliacion (owner/admin/supervisor).
const ROLES_EDITAN_METAS = ['owner', 'admin', 'supervisor']

/**
 * Upsert de una meta (staffId null = meta global del equipo). Gate de rol
 * server-side. Valores null limpian la meta. Conflicto por (workspace, staff,
 * anio, mes) via indice unico NULLS NOT DISTINCT.
 */
export async function guardarMetaComercial(input: {
  staffId: string | null
  anio: number
  mes: number
  metaNumVentas: number | null
  metaValor: number | null
}): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, role, userId } = await getWorkspace()
  if (!workspaceId || !supabase) return { ok: false, error: 'Sin sesion' }
  if (!ROLES_EDITAN_METAS.includes(role ?? '')) {
    return { ok: false, error: 'Solo un supervisor, administrador o dueno puede editar metas.' }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('metas_comerciales')
    .upsert(
      {
        workspace_id: workspaceId,
        staff_id: input.staffId,
        anio: input.anio,
        mes: input.mes,
        meta_num_ventas: input.metaNumVentas,
        meta_valor: input.metaValor,
        created_by: userId ?? null,
        updated_at: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      { onConflict: 'workspace_id,staff_id,anio,mes' },
    )
  if (error) return { ok: false, error: error.message }
  revalidatePath('/equipo')
  return { ok: true }
}
