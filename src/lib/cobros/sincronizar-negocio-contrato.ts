/**
 * Ritual post-firma: sincroniza un negocio de ONE desde su contrato FIRMADO.
 *
 * El contrato firmado (en la carpeta del proyecto) es la fuente de verdad de precio y
 * cronograma. Este helper hace el write-back atómico e idempotente a ONE:
 *   - negocios.precio_aprobado + metadata.carpeta_local
 *   - empresa fiscal (razón social, NIT, responsable IVA, CIIU, dirección, email)
 *   - contacto email
 *   - plan_cobro + plan_cobro_cuotas (cronograma exacto: anticipo + cuotas)
 *
 * Diseño: recibe los datos YA EXTRAÍDOS del contrato (el agente /contrato los lee del .md
 * firmado y los pasa estructurados). La app desplegada no accede a la carpeta local, por eso
 * la extracción vive en el caller y este helper solo escribe. Sólo actualiza campos provistos.
 *
 * NO emite ni envía cuentas: el gate de envío al cliente sigue siendo humano.
 *
 * Refs: docs/specs/2026-06-30_vinculo-negocio-carpeta-contrato.md (Slice 3),
 *       .claude/rules/vinculo-negocio-carpeta.md
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type CuotaContrato = {
  numero: number // 0 = anticipo
  tipo: 'anticipo' | 'cuota'
  monto: number
  fecha_vencimiento: string // YYYY-MM-DD
  concepto_detalle?: string
}

export type SincronizarNegocioInput = {
  precio_aprobado?: number
  carpeta_local?: string
  empresa?: {
    razon_social?: string
    numero_documento?: string
    responsable_iva?: boolean
    agente_retenedor?: boolean
    actividad_ciiu?: string
    direccion_fiscal?: string
    email_fiscal?: string
    contacto_nombre?: string
    telefono?: string
  }
  contacto_email?: string
  plan?: {
    concepto_detalle_template?: string
    activo?: boolean // default false — se activa cuando el cronograma queda confirmado
    cuotas: CuotaContrato[]
  }
}

export type SincronizarNegocioResult = {
  ok: boolean
  negocio_actualizado: boolean
  empresa_actualizada: boolean
  contacto_actualizado: boolean
  plan_id: string | null
  cuotas_upsert: number
  errores: string[]
}

export async function sincronizarNegocioDesdeContrato(
  supabase: SupabaseClient,
  negocioId: string,
  input: SincronizarNegocioInput,
): Promise<SincronizarNegocioResult> {
  const res: SincronizarNegocioResult = {
    ok: true,
    negocio_actualizado: false,
    empresa_actualizada: false,
    contacto_actualizado: false,
    plan_id: null,
    cuotas_upsert: 0,
    errores: [],
  }

  // 0. Resolver negocio (workspace, empresa, contacto)
  const { data: negData, error: nErr } = await supabase
    .from('negocios')
    .select('id, workspace_id, empresa_id, contacto_id, metadata')
    .eq('id', negocioId)
    .maybeSingle()
  if (nErr || !negData) {
    res.ok = false
    res.errores.push(`Negocio ${negocioId} no encontrado`)
    return res
  }
  const neg = negData as {
    id: string
    workspace_id: string
    empresa_id: string | null
    contacto_id: string | null
    metadata: Record<string, unknown> | null
  }
  const workspaceId = neg.workspace_id

  // 1. Negocio: precio + carpeta_local
  const negocioPatch: Record<string, unknown> = {}
  if (typeof input.precio_aprobado === 'number') negocioPatch.precio_aprobado = input.precio_aprobado
  if (input.carpeta_local) {
    negocioPatch.metadata = { ...(neg.metadata ?? {}), carpeta_local: input.carpeta_local }
  }
  if (Object.keys(negocioPatch).length > 0) {
    negocioPatch.updated_at = new Date().toISOString()
    const { error } = await supabase.from('negocios').update(negocioPatch).eq('id', negocioId)
    if (error) res.errores.push(`negocio: ${error.message}`)
    else res.negocio_actualizado = true
  }

  // 2. Empresa fiscal (solo campos provistos)
  if (input.empresa && neg.empresa_id) {
    const e = input.empresa
    const empresaPatch: Record<string, unknown> = {}
    if (e.razon_social !== undefined) empresaPatch.razon_social = e.razon_social
    if (e.numero_documento !== undefined) empresaPatch.numero_documento = e.numero_documento
    if (e.responsable_iva !== undefined) empresaPatch.responsable_iva = e.responsable_iva
    if (e.agente_retenedor !== undefined) empresaPatch.agente_retenedor = e.agente_retenedor
    if (e.actividad_ciiu !== undefined) empresaPatch.actividad_ciiu = e.actividad_ciiu
    if (e.direccion_fiscal !== undefined) empresaPatch.direccion_fiscal = e.direccion_fiscal
    if (e.email_fiscal !== undefined) empresaPatch.email_fiscal = e.email_fiscal
    if (e.contacto_nombre !== undefined) empresaPatch.contacto_nombre = e.contacto_nombre
    if (e.telefono !== undefined) empresaPatch.telefono = e.telefono
    if (Object.keys(empresaPatch).length > 0) {
      empresaPatch.updated_at = new Date().toISOString()
      const { error } = await supabase.from('empresas').update(empresaPatch).eq('id', neg.empresa_id)
      if (error) res.errores.push(`empresa: ${error.message}`)
      else res.empresa_actualizada = true
    }
  }

  // 3. Contacto email
  if (input.contacto_email && neg.contacto_id) {
    const { error } = await supabase
      .from('contactos')
      .update({ email: input.contacto_email, updated_at: new Date().toISOString() })
      .eq('id', neg.contacto_id)
    if (error) res.errores.push(`contacto: ${error.message}`)
    else res.contacto_actualizado = true
  }

  // 4. Plan + cronograma explícito
  if (input.plan && input.plan.cuotas.length > 0) {
    const cuotasReales = input.plan.cuotas.filter(c => c.tipo === 'cuota')
    const fechas = input.plan.cuotas.map(c => c.fecha_vencimiento).sort()
    const totalCuotas = cuotasReales.length
    const montoRef = cuotasReales[0]?.monto ?? input.plan.cuotas[0].monto

    // Resolver o crear plan (uno por negocio)
    const { data: planExist } = await supabase
      .from('planes_cobro').select('id').eq('negocio_id', negocioId).maybeSingle()
    let planId = (planExist as { id: string } | null)?.id ?? null

    const planFields = {
      workspace_id: workspaceId,
      negocio_id: negocioId,
      monto: montoRef,
      frecuencia: 'mensual',
      total_cuotas: totalCuotas,
      fecha_inicio: fechas[0],
      fecha_fin: fechas[fechas.length - 1],
      concepto_detalle_template: input.plan.concepto_detalle_template ?? null,
      activo: input.plan.activo ?? false,
      updated_at: new Date().toISOString(),
    }

    if (!planId) {
      const { data, error } = await supabase.from('planes_cobro').insert(planFields).select('id').single()
      if (error) { res.errores.push(`plan_cobro: ${error.message}`); res.ok = res.errores.length === 0; return res }
      planId = (data as { id: string }).id
    } else {
      const { error } = await supabase.from('planes_cobro').update(planFields).eq('id', planId)
      if (error) res.errores.push(`plan_cobro update: ${error.message}`)
    }
    res.plan_id = planId

    // Upsert cuotas (idempotente por plan_cobro_id + numero)
    const rows = input.plan.cuotas.map(c => ({
      workspace_id: workspaceId,
      plan_cobro_id: planId,
      numero: c.numero,
      tipo: c.tipo,
      monto: c.monto,
      fecha_vencimiento: c.fecha_vencimiento,
      concepto_detalle: c.concepto_detalle ?? null,
      updated_at: new Date().toISOString(),
    }))
    const { error: upErr, count } = await supabase
      .from('plan_cobro_cuotas')
      .upsert(rows, { onConflict: 'plan_cobro_id,numero', count: 'exact' })
    if (upErr) res.errores.push(`plan_cobro_cuotas: ${upErr.message}`)
    else res.cuotas_upsert = count ?? rows.length
  }

  res.ok = res.errores.length === 0
  return res
}
