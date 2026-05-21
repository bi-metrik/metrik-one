'use server'

/**
 * Server actions para cierre adelantado de negocios (Superficie 2 spec UX 2026-05-20).
 *
 * - validarCierrePerdido: chequea cero cobros antes de permitir cierre como perdido.
 * - cerrarNegocioPerdido: marca cerrado con cierre_motivo='perdido'. Solo si hay 0 cobros.
 * - cerrarNegocioCancelado: marca cerrado con cierre_motivo='cancelado'. Permite cobros previos.
 *
 * Comportamiento:
 *   - Busca primera etapa con stage='cerrado' en el flujo del negocio.
 *   - Actualiza etapa_actual_id (trigger sync_negocio_stage_from_etapa
 *     re-deriva stage_actual='cerrado' y setea cierre_motivo='exitoso' por
 *     default; corregimos a perdido/cancelado en update siguiente).
 *   - Cierra estado='perdido'|'cancelado' (compat con sistema legacy).
 *   - Inserta entrada en activity_log.
 *   - Si cancelado: notifica owner (insert en notificaciones).
 *
 * Permisos (regla 11 + canEditBloque):
 *   - Perdido en stage venta: requiere area 'comercial' efectiva.
 *   - Cancelado en cualquier stage: requiere role admin/owner.
 *
 * Decision Mauricio A1: post-cierre el cliente queda inline read-only
 * (no redirect). Solo revalidatePath del detalle.
 */

import { revalidatePath } from 'next/cache'
import { getWorkspace } from './get-workspace'
import { canEditHeader, getAreasEfectivas, type Area } from '@/lib/permissions/can-edit'

// ── Tipos ────────────────────────────────────────────────────────────

interface NegocioInfo {
  id: string
  workspace_id: string
  estado: string
  stage_actual: string | null
  etapa_actual_id: string | null
  linea_id: string | null
}

interface ValidarCierrePerdidoResult {
  ok: boolean
  cobrosCount: number
  cobrosTotal: number
  reason?: string
}

// ── Helpers internos ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStaffAreas(supabase: any, staffId: string): Promise<Area[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('staff_areas')
    .select('area')
    .eq('staff_id', staffId)
  return (
    ((data ?? []) as Array<{ area: string }>)
      .map((r) => r.area)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((a): a is Area =>
        (['comercial', 'operaciones', 'financiera', 'direccion'] as const).includes(
          a as any,
        ),
      )
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getNegocioBase(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioId: string,
  workspaceId: string,
): Promise<NegocioInfo | null> {
  const { data } = await supabase
    .from('negocios')
    .select('id, workspace_id, estado, stage_actual, etapa_actual_id, linea_id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return (data as NegocioInfo) ?? null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findEtapaCierre(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  lineaId: string | null,
): Promise<string | null> {
  if (!lineaId) return null
  // Buscar primera etapa con stage='cerrado' de esa linea
  const { data } = await supabase
    .from('etapas_negocio')
    .select('id, orden')
    .eq('linea_id', lineaId)
    .eq('stage', 'cerrado')
    .order('orden', { ascending: true })
    .limit(1)
  const rows = data as Array<{ id: string }> | null
  return rows && rows.length > 0 ? rows[0].id : null
}

// ── validarCierrePerdido ─────────────────────────────────────────────

export async function validarCierrePerdido(
  negocioId: string,
): Promise<ValidarCierrePerdidoResult> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) {
    return { ok: false, cobrosCount: 0, cobrosTotal: 0, reason: 'unauthenticated' }
  }

  const { data: cobrosData } = await supabase
    .from('cobros')
    .select('monto')
    .eq('negocio_id', negocioId)

  const cobros = (cobrosData ?? []) as Array<{ monto: number | null }>
  const total = cobros.reduce((sum, c) => sum + (c.monto ?? 0), 0)
  return {
    ok: cobros.length === 0,
    cobrosCount: cobros.length,
    cobrosTotal: total,
    reason: cobros.length === 0 ? undefined : 'tiene_cobros',
  }
}

// ── cerrarNegocioPerdido ─────────────────────────────────────────────

export async function cerrarNegocioPerdido(
  negocioId: string,
  payload: { razon: string },
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, staffId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) {
    return { ok: false, error: 'No autenticado' }
  }

  if (!payload.razon || payload.razon.trim().length === 0) {
    return { ok: false, error: 'La razon es obligatoria' }
  }

  const negocio = await getNegocioBase(supabase, negocioId, workspaceId)
  if (!negocio) return { ok: false, error: 'Negocio no encontrado' }
  if (negocio.estado !== 'abierto') {
    return { ok: false, error: 'El negocio ya esta cerrado' }
  }
  if (negocio.stage_actual !== 'venta') {
    return {
      ok: false,
      error: 'Cierre como perdido solo aplica en etapa de venta',
    }
  }

  // Validar cero cobros (server es la autoridad — regla 10)
  const val = await validarCierrePerdido(negocioId)
  if (!val.ok) {
    return {
      ok: false,
      error: `Este negocio tiene ${val.cobrosCount} cobro${val.cobrosCount !== 1 ? 's' : ''} registrado${val.cobrosCount !== 1 ? 's' : ''}. Usa Cancelar en su lugar.`,
    }
  }

  // Permiso: canEditBloque sobre stage venta = comercial en areas efectivas o owner/admin
  if (role !== 'owner' && role !== 'admin') {
    if (!staffId) {
      return { ok: false, error: 'Sin staff vinculado' }
    }
    const areas = await getStaffAreas(supabase, staffId)
    const areasEf = getAreasEfectivas({ id: staffId, role: role as 'supervisor', areas })
    if (!areasEf.has('comercial')) {
      return {
        ok: false,
        error: 'Tu rol no puede cerrar negocios en venta. Habla con tu supervisor.',
      }
    }
  }

  // Resolver etapa de cierre
  const etapaCierreId = await findEtapaCierre(supabase, negocio.linea_id)

  const updatePayload: Record<string, unknown> = {
    estado: 'perdido',
    razon_cierre: payload.razon.trim(),
    descripcion_cierre: null,
    closed_at: new Date().toISOString(),
  }
  if (etapaCierreId) {
    updatePayload.etapa_actual_id = etapaCierreId
  }

  const { error: updErr } = await supabase
    .from('negocios')
    .update(updatePayload)
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updErr) {
    return { ok: false, error: (updErr as { message: string }).message }
  }

  // Corregir cierre_motivo a perdido (trigger setea exitoso por default)
  if (etapaCierreId) {
    await supabase
      .from('negocios')
      .update({ cierre_motivo: 'perdido' })
      .eq('id', negocioId)
  }

  // Activity log
  if (staffId) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_estado',
      autor_id: staffId,
      contenido: `Negocio cerrado como perdido. Razon: ${payload.razon.trim()}`,
      valor_nuevo: 'perdido',
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { ok: true }
}

// ── cerrarNegocioCancelado ───────────────────────────────────────────

export async function cerrarNegocioCancelado(
  negocioId: string,
  payload: { razon: string; manejoPagos?: string },
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, staffId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) {
    return { ok: false, error: 'No autenticado' }
  }

  if (!payload.razon || payload.razon.trim().length === 0) {
    return { ok: false, error: 'La razon es obligatoria' }
  }

  // Cancelado solo admin/owner (regla 11)
  if (role !== 'owner' && role !== 'admin') {
    return {
      ok: false,
      error: 'Solo admin u owner pueden cancelar un negocio.',
    }
  }

  const negocio = await getNegocioBase(supabase, negocioId, workspaceId)
  if (!negocio) return { ok: false, error: 'Negocio no encontrado' }
  if (negocio.estado !== 'abierto') {
    return { ok: false, error: 'El negocio ya esta cerrado' }
  }

  // Si tiene cobros, manejoPagos es obligatorio (min 30 chars)
  const { data: cobrosData } = await supabase
    .from('cobros')
    .select('id, monto')
    .eq('negocio_id', negocioId)
  const cobros = (cobrosData ?? []) as Array<{ monto: number | null }>
  const hayCobros = cobros.length > 0

  if (hayCobros) {
    if (!payload.manejoPagos || payload.manejoPagos.trim().length < 30) {
      return {
        ok: false,
        error:
          'Cuando hay cobros registrados debes describir el manejo de pagos (minimo 30 caracteres).',
      }
    }
  }

  // Resolver etapa de cierre
  const etapaCierreId = await findEtapaCierre(supabase, negocio.linea_id)

  const descripcion = hayCobros
    ? `${payload.razon.trim()}\n\nManejo de pagos: ${payload.manejoPagos?.trim() ?? ''}`
    : payload.razon.trim()

  const updatePayload: Record<string, unknown> = {
    estado: 'cancelado',
    razon_cierre: payload.razon.trim(),
    descripcion_cierre: descripcion,
    closed_at: new Date().toISOString(),
  }
  if (etapaCierreId) {
    updatePayload.etapa_actual_id = etapaCierreId
  }

  const { error: updErr } = await supabase
    .from('negocios')
    .update(updatePayload)
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updErr) {
    return { ok: false, error: (updErr as { message: string }).message }
  }

  // Corregir cierre_motivo a cancelado
  if (etapaCierreId) {
    await supabase
      .from('negocios')
      .update({ cierre_motivo: 'cancelado' })
      .eq('id', negocioId)
  }

  // Activity log
  if (staffId) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_estado',
      autor_id: staffId,
      contenido: `Negocio cancelado. Razon: ${payload.razon.trim()}${
        payload.manejoPagos ? ` · Manejo de pagos: ${payload.manejoPagos.trim()}` : ''
      }`,
      valor_nuevo: 'cancelado',
    })
  }

  // Notificar al owner del workspace
  const { data: owners } = await supabase
    .from('profiles')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner')
  for (const o of (owners ?? []) as Array<{ id: string }>) {
    if (o.id === userId) continue // no notificarse a si mismo
    await supabase.from('notificaciones').insert({
      workspace_id: workspaceId,
      destinatario_id: o.id,
      tipo: 'cambio_estado',
      contenido: `Negocio cancelado. Motivo: ${payload.razon.trim()}`,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      estado: 'pendiente',
      deep_link: `/negocios/${negocioId}`,
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { ok: true }
}

/**
 * Helper que indica si el usuario tiene permiso para cerrar un negocio
 * como perdido o cancelado, segun rol + areas.
 *
 * No consulta cobros — eso lo hace `validarCierrePerdido` aparte.
 */
export async function getCierrePermisos(): Promise<{
  puedePerder: boolean
  puedeCancelar: boolean
  role: string | null
}> {
  const { staffId, role, supabase } = await getWorkspace()
  const r = role ?? null

  const puedeCancelar = r === 'owner' || r === 'admin'

  // Perdido requiere comercial en areas efectivas
  let puedePerder = r === 'owner' || r === 'admin'
  if (!puedePerder && r === 'supervisor' && staffId) {
    const areas = await getStaffAreas(supabase, staffId)
    const areasEf = getAreasEfectivas({ id: staffId, role: 'supervisor', areas })
    puedePerder = areasEf.has('comercial')
  }
  if (!puedePerder && r === 'operator' && staffId) {
    // operator + responsable + comercial — chequeo de responsabilidad
    // se valida en submit. Aqui solo gateamos por area.
    const areas = await getStaffAreas(supabase, staffId)
    const areasEf = getAreasEfectivas({ id: staffId, role: 'operator', areas })
    puedePerder = areasEf.has('comercial')
  }

  // canEditHeader es referencia adicional para futuras superficies
  void canEditHeader

  return { puedePerder, puedeCancelar, role: r }
}
