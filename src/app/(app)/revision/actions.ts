'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { bogotaYearMonth } from '@/lib/dates/bogota'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizarMotivoAnulacion, MOTIVO_ANULACION_MIN } from '@/lib/cobros/anulacion'
import { anularCobro } from '@/lib/actions/pagos-externos'

// La tabla `movimientos_rechazados` y `gastos_fijos_borradores` no están en los tipos
// generados (`database.ts` va por detrás del ledger). Mismo cast que usa el resto.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

// ── Types ────────────────────────────────────────────────

export type ItemRevision = {
  id: string
  tipo: 'ingreso' | 'egreso'
  tabla: 'gastos' | 'cobros'
  fecha: string
  monto: number
  descripcion: string
  categoria: string | null
  proyecto: string | null
  negocio: string | null
  created_by_name: string | null
  deducible: boolean | null
  retencion: number | null
  tercero_nit: string | null
  soporte_url: string | null
  revisado: boolean
  revisado_at: string | null
}

// ── getRevisionData ──────────────────────────────────────
// Lista gastos+cobros del mes ordenados por revisado=false primero.
// Sin formularios fiscales — flag binario.

export async function getRevisionData(mes?: string) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) {
    return { items: [], counts: { pendientes: 0, revisados: 0 } }
  }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canMarcarRevisado && !perms.canViewRevision) {
    return { items: [], counts: { pendientes: 0, revisados: 0 } }
  }

  const currentMes = mes ?? bogotaYearMonth()
  const [y, m] = currentMes.split('-').map(Number)
  const startDate = `${currentMes}-01`
  const endDate = new Date(y, m, 0).toISOString().split('T')[0]

  const items: ItemRevision[] = []

  // ── Gastos ──────────────────────────────────────────
  const { data: gastos } = await supabase
    .from('gastos')
    .select('id, fecha, monto, descripcion, mensaje_original, categoria, soporte_url, proyecto_id, proyectos(nombre), negocio_id, negocios(nombre), created_by_wa_name, created_by_profile:profiles!gastos_created_by_profiles_fkey(full_name), deducible, retencion, tercero_nit, revisado, revisado_at')
    .eq('workspace_id', workspaceId)
    .gte('fecha', startDate)
    .lte('fecha', endDate)
    .order('revisado', { ascending: true })
    .order('fecha', { ascending: false })

  for (const g of gastos ?? []) {
    const proy = g.proyectos as { nombre: string } | null
    const neg = g.negocios as { nombre: string } | null
    const profile = g.created_by_profile as { full_name: string } | null
    items.push({
      id: g.id,
      tipo: 'egreso',
      tabla: 'gastos',
      fecha: g.fecha,
      monto: Number(g.monto),
      descripcion: g.descripcion || g.categoria || 'Gasto',
      categoria: g.categoria,
      proyecto: proy?.nombre ?? null,
      negocio: neg?.nombre ?? null,
      created_by_name: profile?.full_name ?? g.created_by_wa_name ?? null,
      deducible: g.deducible ?? null,
      retencion: g.retencion ? Number(g.retencion) : null,
      tercero_nit: g.tercero_nit ?? null,
      soporte_url: g.soporte_url ?? null,
      revisado: g.revisado ?? false,
      revisado_at: g.revisado_at ?? null,
    })
  }

  // ── Cobros ──────────────────────────────────────────
  const { data: cobros } = await supabase
    .from('cobros')
    .select('id, fecha, monto, notas, proyecto_id, proyectos(nombre), negocio_id, negocios(nombre, empresa_id, empresas(numero_documento)), created_by_profile:profiles!cobros_created_by_profiles_fkey(full_name), retencion, tercero_nit, revisado, revisado_at')
    .eq('workspace_id', workspaceId)
    .gte('fecha', startDate)
    .lte('fecha', endDate)
    .order('revisado', { ascending: true })
    .order('fecha', { ascending: false })

  for (const c of cobros ?? []) {
    const proy = c.proyectos as { nombre: string } | null
    const neg = c.negocios as { nombre: string; empresa_id: string; empresas: { numero_documento: string | null } | null } | null
    const profile = c.created_by_profile as { full_name: string } | null
    items.push({
      id: c.id,
      tipo: 'ingreso',
      tabla: 'cobros',
      fecha: c.fecha ?? '',
      monto: Number(c.monto),
      descripcion: c.notas ?? 'Cobro',
      categoria: null,
      proyecto: proy?.nombre ?? null,
      negocio: neg?.nombre ?? null,
      created_by_name: profile?.full_name ?? null,
      deducible: null,
      retencion: c.retencion ? Number(c.retencion) : null,
      tercero_nit: c.tercero_nit ?? neg?.empresas?.numero_documento ?? null,
      soporte_url: null,
      revisado: c.revisado ?? false,
      revisado_at: c.revisado_at ?? null,
    })
  }

  // Sort: revisado=false primero, luego por fecha desc
  items.sort((a, b) => {
    if (a.revisado !== b.revisado) return a.revisado ? 1 : -1
    return b.fecha.localeCompare(a.fecha)
  })

  const pendientes = items.filter(i => !i.revisado).length
  const revisados = items.filter(i => i.revisado).length

  return {
    items,
    counts: { pendientes, revisados },
  }
}

// ── marcarRevisado / desmarcarRevisado ────────────────────

export async function marcarRevisado(id: string, tabla: 'gastos' | 'cobros') {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canMarcarRevisado) return { success: false, error: 'Sin permisos para marcar revisado' }

  const updatePayload = {
    revisado: true,
    revisado_at: new Date().toISOString(),
    revisado_por: userId,
  }

  const { error: updateError } = tabla === 'gastos'
    ? await supabase.from('gastos').update(updatePayload).eq('id', id).eq('workspace_id', workspaceId)
    : await supabase.from('cobros').update(updatePayload).eq('id', id).eq('workspace_id', workspaceId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/revision')
  revalidatePath('/movimientos')
  return { success: true }
}

export async function desmarcarRevisado(id: string, tabla: 'gastos' | 'cobros') {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canMarcarRevisado) return { success: false, error: 'Sin permisos' }

  const updatePayload = {
    revisado: false,
    revisado_at: null,
    revisado_por: null,
  }

  const { error: updateError } = tabla === 'gastos'
    ? await supabase.from('gastos').update(updatePayload).eq('id', id).eq('workspace_id', workspaceId)
    : await supabase.from('cobros').update(updatePayload).eq('id', id).eq('workspace_id', workspaceId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/revision')
  revalidatePath('/movimientos')
  return { success: true }
}

/**
 * Rechazar un movimiento: DESAPARECE.
 *
 * Antes el botón llamaba a `desmarcarRevisado`, que solo pone `revisado = false`: el
 * movimiento volvía a la fila de pendientes y el motivo que el modal exigía se tiraba.
 * Quien rechazaba lo veía reaparecer.
 *
 * GASTO: se archiva la fila entera en `movimientos_rechazados` y se BORRA. Se eligió
 * borrar y no una bandera porque `gastos` se lee desde 42 sitios, incluidas las edge
 * functions de WhatsApp: una bandera obliga a recordar el filtro en cada uno, y el
 * olvido no se nota — aparece como plata que no cuadra.
 *
 * COBRO: no se borra, se ANULA por la vía que ya existe (`anularCobro`), porque su
 * monto sostiene el saldo del negocio y la cuenta de cobro emitida. Desaparece de la
 * lista igual, porque `getMovimientos` dejó de mostrar los anulados.
 */
export async function rechazarMovimiento(
  id: string,
  tabla: 'gastos' | 'cobros',
  motivo: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canMarcarRevisado) return { success: false, error: 'Sin permisos' }

  const motivoLimpio = normalizarMotivoAnulacion(motivo)
  if (!motivoLimpio) {
    return {
      success: false,
      error: `Escribe por qué lo rechazas (mínimo ${MOTIVO_ANULACION_MIN} caracteres). Queda guardado con tu nombre y la fecha.`,
    }
  }

  if (tabla === 'cobros') {
    const res = await anularCobro(id, motivoLimpio)
    if (!res.success) return res
    revalidatePath('/revision')
    revalidatePath('/movimientos')
    return { success: true }
  }

  const { data: fila } = await supabase
    .from('gastos').select('*').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
  if (!fila) return { success: false, error: 'Movimiento no encontrado' }

  // El archivo se escribe con el cliente de servicio: la tabla es server-only a
  // propósito (es la copia de lo que el usuario decidió quitar de su vista). Va ANTES
  // del borrado: si falla, el gasto sigue ahí y se puede reintentar; al revés, el
  // rechazo se lleva la fila sin dejar rastro.
  const { error: eArchivo } = await db(createServiceClient())
    .from('movimientos_rechazados')
    .insert({
      workspace_id: workspaceId,
      tabla: 'gastos',
      fila_id: id,
      fila,
      motivo: motivoLimpio,
      rechazado_por: userId ?? null,
    })
  if (eArchivo) return { success: false, error: `No se pudo guardar el rechazo: ${eArchivo.message}` }

  // `gastos_fijos_borradores` apunta a la fila con NO ACTION: sin soltar esa referencia
  // el DELETE falla con un error de llave foránea que no le dice nada a quien rechaza.
  await db(createServiceClient())
    .from('gastos_fijos_borradores').update({ gasto_id: null }).eq('gasto_id', id)

  const { error: eBorrar } = await supabase
    .from('gastos').delete().eq('id', id).eq('workspace_id', workspaceId)
  if (eBorrar) return { success: false, error: eBorrar.message }

  revalidatePath('/revision')
  revalidatePath('/movimientos')
  revalidatePath('/numeros')
  return { success: true }
}

// ── toggleDeducible ───────────────────────────────────────

export async function toggleDeducible(gastoId: string, deducible: boolean) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canToggleDeducible) return { success: false, error: 'Sin permisos para modificar deducibilidad' }

  const { data: gasto } = await supabase
    .from('gastos')
    .select('id')
    .eq('id', gastoId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!gasto) return { success: false, error: 'Gasto no encontrado' }

  const { error: updateError } = await supabase
    .from('gastos')
    .update({ deducible })
    .eq('id', gastoId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/revision')
  revalidatePath('/movimientos')
  return { success: true }
}
