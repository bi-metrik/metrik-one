'use server'

/**
 * Server actions de reapertura — Superficie 6 spec UX 2026-05-20.
 *
 * Dos caminos (decision Mauricio):
 *   - Mismas condiciones: reabrir el negocio en su etapa previa al cierre.
 *     Trigger sync_negocio_stage_from_etapa recalcula stage_actual y limpia
 *     cierre_motivo automaticamente (gotcha Noor).
 *   - Cambiaron condiciones: crear negocio nuevo pre-llenado con metadata
 *     basica (empresa, contacto, linea). NO copia cobros, cotizaciones,
 *     activity_log, documentos.
 *
 * Permisos (regla 11):
 *   - perdido → supervisor con area comercial (o admin/owner)
 *   - cancelado → admin/owner
 *   - exitoso → nadie reabre
 */

import { revalidatePath } from 'next/cache'
import { getWorkspace } from './get-workspace'
import { getAreasEfectivas, type Area } from '@/lib/permissions/can-edit'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStaffAreas(supabase: any, staffId: string): Promise<Area[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('staff_areas')
    .select('area')
    .eq('staff_id', staffId)
  const VALID_AREAS: readonly string[] = ['comercial', 'operaciones', 'financiera', 'direccion']
  return ((data ?? []) as Array<{ area: string }>)
    .map((r) => r.area)
    .filter((a): a is Area => VALID_AREAS.includes(a))
}

// ── reabrirNegocio ───────────────────────────────────────────────────

export async function reabrirNegocio(
  negocioId: string,
): Promise<{ ok: boolean; error?: string; etapaNombre?: string }> {
  const { supabase, workspaceId, staffId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) {
    return { ok: false, error: 'No autenticado' }
  }

  // Cargar negocio
  const { data: negocio } = await supabase
    .from('negocios')
    .select(
      'id, workspace_id, estado, stage_actual, cierre_motivo, etapa_actual_id, linea_id',
    )
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!negocio) return { ok: false, error: 'Negocio no encontrado' }
  const n = negocio as {
    estado: string
    stage_actual: string | null
    cierre_motivo: 'exitoso' | 'perdido' | 'cancelado' | null
    etapa_actual_id: string | null
    linea_id: string | null
  }

  if (n.stage_actual !== 'cerrado') {
    return { ok: false, error: 'Solo se pueden reabrir negocios cerrados' }
  }
  if (n.cierre_motivo === 'exitoso') {
    return {
      ok: false,
      error: 'Los negocios cerrados como exitoso no se reabren',
    }
  }

  // Permisos
  if (role !== 'owner' && role !== 'admin') {
    if (n.cierre_motivo === 'cancelado') {
      return {
        ok: false,
        error: 'Solo admin u owner pueden reabrir un negocio cancelado',
      }
    }
    // Perdido: supervisor con area comercial
    if (role !== 'supervisor') {
      return {
        ok: false,
        error: 'Solo supervisor (con area comercial), admin u owner pueden reabrir',
      }
    }
    if (!staffId) return { ok: false, error: 'Sin staff vinculado' }
    const areas = await getStaffAreas(supabase, staffId)
    const areasEf = getAreasEfectivas({ id: staffId, role: 'supervisor', areas })
    if (!areasEf.has('comercial')) {
      return {
        ok: false,
        error: 'Necesitas area comercial para reabrir negocios perdidos',
      }
    }
  }

  // Buscar etapa previa al cierre desde activity_log: ultima entrada con
  // tipo='cambio_etapa' previa al closed_at. Fallback: primera etapa
  // operativa (stage='venta') de la linea.
  let etapaDestinoId: string | null = null

  // Activity log query
  const { data: logRows } = await supabase
    .from('activity_log')
    .select('contenido, valor_anterior, valor_nuevo, created_at')
    .eq('entidad_tipo', 'negocio')
    .eq('entidad_id', negocioId)
    .eq('tipo', 'cambio_etapa')
    .order('created_at', { ascending: false })

  type ActivityRow = {
    contenido?: string
    valor_anterior?: string | null
    valor_nuevo?: string | null
    created_at: string
  }

  for (const row of (logRows ?? []) as ActivityRow[]) {
    if (row.valor_anterior) {
      etapaDestinoId = row.valor_anterior
      break
    }
  }

  // Fallback: primera etapa no-cerrada de la linea
  if (!etapaDestinoId && n.linea_id) {
    const { data: etapasRows } = await supabase
      .from('etapas_negocio')
      .select('id, orden, stage')
      .eq('linea_id', n.linea_id)
      .neq('stage', 'cerrado')
      .order('orden', { ascending: true })
      .limit(1)
    const rows = etapasRows as Array<{ id: string }> | null
    if (rows && rows.length > 0) etapaDestinoId = rows[0].id
  }

  if (!etapaDestinoId) {
    return { ok: false, error: 'No se pudo determinar la etapa de destino' }
  }

  // Update — el trigger sync_negocio_stage_from_etapa limpia cierre_motivo
  // y recalcula stage_actual automaticamente.
  const { error: updErr } = await supabase
    .from('negocios')
    .update({
      etapa_actual_id: etapaDestinoId,
      estado: 'abierto',
      closed_at: null,
      cierre_snapshot: null,
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updErr) {
    return { ok: false, error: (updErr as { message: string }).message }
  }

  // Obtener nombre de la etapa destino
  const { data: etapaRow } = await supabase
    .from('etapas_negocio')
    .select('nombre')
    .eq('id', etapaDestinoId)
    .maybeSingle()
  const etapaNombre = (etapaRow as { nombre?: string } | null)?.nombre

  // Activity log
  if (staffId) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_estado',
      autor_id: staffId,
      contenido: `Negocio reabierto desde cierre ${n.cierre_motivo}. Etapa: ${etapaNombre ?? 'inicial'}.`,
      valor_anterior: 'cerrado',
      valor_nuevo: 'abierto',
    })
  }

  // Si era cancelado, notificar owner (regla 11)
  if (n.cierre_motivo === 'cancelado') {
    const { data: owners } = await supabase
      .from('profiles')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('role', 'owner')
    for (const o of (owners ?? []) as Array<{ id: string }>) {
      if (o.id === userId) continue
      await supabase.from('notificaciones').insert({
        workspace_id: workspaceId,
        destinatario_id: o.id,
        tipo: 'cambio_estado',
        contenido: `Se reabrio un negocio cancelado. Revisalo cuando puedas.`,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        estado: 'pendiente',
        deep_link: `/negocios/${negocioId}`,
      })
    }
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { ok: true, etapaNombre }
}

// ── crearNegocioDesdeCerrado ─────────────────────────────────────────

export async function crearNegocioDesdeCerrado(
  negocioId: string,
): Promise<{ ok: boolean; error?: string; nuevoNegocioId?: string }> {
  const { supabase, workspaceId, staffId, role, error } = await getWorkspace()
  if (error || !workspaceId) {
    return { ok: false, error: 'No autenticado' }
  }

  // Cargar origen
  const { data: origen } = await supabase
    .from('negocios')
    .select(
      'id, workspace_id, codigo, nombre, empresa_id, contacto_id, linea_id, stage_actual, cierre_motivo',
    )
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!origen) return { ok: false, error: 'Negocio origen no encontrado' }
  const o = origen as {
    codigo: string | null
    nombre: string
    empresa_id: string | null
    contacto_id: string | null
    linea_id: string | null
    stage_actual: string | null
    cierre_motivo: 'exitoso' | 'perdido' | 'cancelado' | null
  }

  if (o.stage_actual !== 'cerrado') {
    return { ok: false, error: 'Solo desde negocios cerrados' }
  }

  // Permisos: mismas que reabrir
  if (role !== 'owner' && role !== 'admin' && role !== 'supervisor') {
    return {
      ok: false,
      error: 'Sin permisos para crear negocio desde cerrado',
    }
  }

  // Primera etapa de la linea
  let etapaInicialId: string | null = null
  if (o.linea_id) {
    const { data: etapasRows } = await supabase
      .from('etapas_negocio')
      .select('id, stage')
      .eq('linea_id', o.linea_id)
      .neq('stage', 'cerrado')
      .order('orden', { ascending: true })
      .limit(1)
    const rows = etapasRows as Array<{ id: string }> | null
    if (rows && rows.length > 0) etapaInicialId = rows[0].id
  }

  // Insert negocio nuevo. El trigger negocio_auto_codigo asigna el codigo.
  const insertPayload: Record<string, unknown> = {
    workspace_id: workspaceId,
    nombre: `${o.nombre} (reapertura)`,
    empresa_id: o.empresa_id,
    contacto_id: o.contacto_id,
    linea_id: o.linea_id,
    etapa_actual_id: etapaInicialId,
    estado: 'abierto',
  }

  const { data: nuevo, error: insErr } = await supabase
    .from('negocios')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(insertPayload as any)
    .select('id')
    .single()

  if (insErr || !nuevo) {
    return { ok: false, error: (insErr as { message: string } | null)?.message ?? 'Insert fallo' }
  }
  const nuevoId = (nuevo as { id: string }).id

  // Activity log en origen
  if (staffId) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'comentario',
      autor_id: staffId,
      contenido: `Se creo el negocio ${nuevoId} como reapertura con nuevas condiciones desde este cerrado (${o.cierre_motivo}).`,
    })
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: nuevoId,
      tipo: 'comentario',
      autor_id: staffId,
      contenido: `Negocio creado como reapertura desde ${o.codigo ?? negocioId} (${o.cierre_motivo}) con nuevas condiciones.`,
    })
  }

  revalidatePath('/negocios')
  return { ok: true, nuevoNegocioId: nuevoId }
}
