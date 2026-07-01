/**
 * Emisión de cuentas de cobro desde un cronograma EXPLÍCITO (plan_cobro_cuotas).
 *
 * A diferencia de generar-cuentas-cobro.ts (período-driven, día 15, monto uniforme),
 * aquí cada cuota tiene su fecha_vencimiento y monto exactos del contrato — soporta
 * anticipo + cuotas irregulares (ej. Trappvel: anticipo $1M + 5×$833.333 + 1×$833.335).
 *
 * Reusa los mismos primitivos que el generador uniforme (render, Drive, emisor, format),
 * y deja la cuenta en 'emitida_pendiente_aprobacion' — el envío al cliente sigue siendo
 * gate humano (server action aprobarYEnviarCuentaCobro).
 *
 * NO modifica el generador de período: los planes sin plan_cobro_cuotas siguen igual.
 *
 * Refs: docs/specs/2026-06-30_vinculo-negocio-carpeta-contrato.md (Slice 2)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { renderCuentaCobro, type CuentaCobroRenderPayload } from '@/lib/pdf/pdf-render-client'
import { createDriveFolder, uploadFileToDrive } from '@/lib/google-drive'
import { EMISOR_MAURICIO, getAnioGravableDeclaracion } from './emisor-mauricio'
import { formatCOP, formatFechaLetras, montoEnLetrasCOP } from './format'

const SUBFOLDER_CUENTAS = '4. Cuentas de cobro'
const TEMPLATE_SLUG = 'metrik'

function extractFolderIdFromUrl(url: string | null): string | null {
  if (!url) return null
  const m = url.match(/\/folders\/([-\w]+)/)
  return m ? m[1] : null
}

/** Siguiente correlativo CC-YYYY-MM-NNN del período (no hay RPC en DB; se calcula por max). */
async function siguienteNumeroCuenta(
  supabase: SupabaseClient,
  workspaceId: string,
  anio: number,
  mes: number,
): Promise<string> {
  const { data } = await supabase
    .from('cuentas_cobro_emitidas')
    .select('numero')
    .eq('workspace_id', workspaceId)
    .eq('anio', anio)
    .eq('mes', mes)
  let max = 0
  for (const r of (data ?? []) as { numero: string }[]) {
    const m = r.numero?.match(/-(\d+)$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `CC-${anio}-${String(mes).padStart(2, '0')}-${String(max + 1).padStart(3, '0')}`
}

type CuotaRow = {
  id: string
  workspace_id: string
  plan_cobro_id: string
  numero: number
  tipo: 'anticipo' | 'cuota'
  monto: number
  fecha_vencimiento: string
  concepto_detalle: string | null
}

type PlanRow = {
  id: string
  negocio_id: string
  total_cuotas: number
  concepto_detalle_template: string | null
}

type NegocioRow = { id: string; nombre: string; empresa_id: string | null; carpeta_url: string | null }

type EmpresaRow = {
  id: string
  nombre: string
  razon_social: string | null
  numero_documento: string | null
  direccion_fiscal: string | null
  email_fiscal: string | null
  telefono: string | null
  contacto_nombre: string | null
}

export type EmitirCuotaResult =
  | { success: true; numero: string; cuentaId: string; pdfUrl: string | null; omitida?: boolean }
  | { success: false; error: string }

/**
 * Emite la cuenta de cobro de UNA cuota explícita. Idempotente:
 *   - reusa el cobro de la cuota si ya existe (unique plan+numero)
 *   - aborta si esa cuota ya tiene cuenta emitida (evita doble emisión)
 */
export async function emitirCuentaDesdeCuota(
  supabase: SupabaseClient,
  planCuotaId: string,
  options: { isDraft?: boolean; fechaEmisionOverride?: string } = {},
): Promise<EmitirCuotaResult> {
  // 1. Cuota + plan + negocio + empresa
  const { data: cuotaData, error: qErr } = await supabase
    .from('plan_cobro_cuotas')
    .select('id, workspace_id, plan_cobro_id, numero, tipo, monto, fecha_vencimiento, concepto_detalle')
    .eq('id', planCuotaId)
    .maybeSingle()
  if (qErr || !cuotaData) return { success: false, error: `Cuota ${planCuotaId} no encontrada` }
  const cuota = cuotaData as CuotaRow
  const workspaceId = cuota.workspace_id

  const { data: planData } = await supabase
    .from('planes_cobro')
    .select('id, negocio_id, total_cuotas, concepto_detalle_template')
    .eq('id', cuota.plan_cobro_id)
    .maybeSingle()
  if (!planData) return { success: false, error: 'Plan de cobro no encontrado' }
  const plan = planData as PlanRow

  const { data: negData } = await supabase
    .from('negocios')
    .select('id, nombre, empresa_id, carpeta_url')
    .eq('id', plan.negocio_id)
    .maybeSingle()
  const negocio = negData as NegocioRow | null
  if (!negocio?.empresa_id) return { success: false, error: 'Negocio sin empresa asociada' }

  const { data: empData } = await supabase
    .from('empresas')
    .select('id, nombre, razon_social, numero_documento, direccion_fiscal, email_fiscal, telefono, contacto_nombre')
    .eq('id', negocio.empresa_id)
    .maybeSingle()
  const empresa = empData as EmpresaRow | null
  if (!empresa) return { success: false, error: 'Empresa no encontrada' }

  // 2. Cobro de la cuota (idempotente por unique plan+numero_cuota)
  const { data: cobroExist } = await supabase
    .from('cobros')
    .select('id')
    .eq('plan_cobro_id', plan.id)
    .eq('numero_cuota', cuota.numero)
    .maybeSingle()

  let cobroId = (cobroExist as { id: string } | null)?.id ?? null
  if (!cobroId) {
    const { data: cobroNuevo, error: cErr } = await supabase
      .from('cobros')
      .insert({
        workspace_id: workspaceId,
        negocio_id: negocio.id,
        plan_cobro_id: plan.id,
        numero_cuota: cuota.numero,
        tipo_cobro: cuota.tipo === 'anticipo' ? 'anticipo' : 'programado',
        monto: cuota.monto,
        fecha: null, // override DEFAULT CURRENT_DATE — emitido, no pagado
        fecha_esperada: cuota.fecha_vencimiento,
        vencido: false,
      })
      .select('id')
      .single()
    if (cErr) return { success: false, error: `Insert cobro: ${cErr.message}` }
    cobroId = (cobroNuevo as { id: string }).id
  }

  // 3. Idempotencia de cuenta: ¿ya hay una cuenta que incluye este cobro?
  const { data: cuentaPrevia } = await supabase
    .from('cuentas_cobro_emitidas')
    .select('id, numero, pdf_drive_url')
    .eq('workspace_id', workspaceId)
    .contains('cobros_ids', [cobroId])
    .maybeSingle()
  if (cuentaPrevia) {
    const cp = cuentaPrevia as { id: string; numero: string; pdf_drive_url: string | null }
    return { success: true, numero: cp.numero, cuentaId: cp.id, pdfUrl: cp.pdf_drive_url, omitida: true }
  }

  // 4. Fechas + número
  const [anio, mes] = cuota.fecha_vencimiento.split('-').map(Number)
  const fechaEmision = options.fechaEmisionOverride ?? new Date().toISOString().slice(0, 10)
  const fechaVencimiento = cuota.fecha_vencimiento
  const numero = await siguienteNumeroCuenta(supabase, workspaceId, anio, mes)

  // 5. Concepto
  const conceptoDetalle =
    cuota.concepto_detalle ??
    (cuota.tipo === 'anticipo'
      ? `Anticipo — ${negocio.nombre}`
      : (plan.concepto_detalle_template ?? `Cuota ${cuota.numero} de ${plan.total_cuotas} — ${negocio.nombre}`)
          .replace(/\{numero_cuota\}/g, String(cuota.numero))
          .replace(/\{total_cuotas\}/g, String(plan.total_cuotas)))

  const conceptoParrafos =
    cuota.tipo === 'anticipo'
      ? `<p>Anticipo correspondiente al acuerdo suscrito con <strong>${empresa.razon_social ?? empresa.nombre}</strong>, conforme al contrato vigente entre las Partes.</p>`
      : `<p>Cuota correspondiente al acuerdo suscrito con <strong>${empresa.razon_social ?? empresa.nombre}</strong>, conforme al contrato vigente entre las Partes.</p>`

  // 6. Payload PDF
  const payload: CuentaCobroRenderPayload = {
    numero,
    lugar_emision: 'Bogotá D.C.',
    fecha_emision_letras: formatFechaLetras(fechaEmision),
    fecha_vencimiento_letras: formatFechaLetras(fechaVencimiento),
    emisor_nombre: EMISOR_MAURICIO.nombre,
    emisor_documento: EMISOR_MAURICIO.documento_completo,
    emisor_documento_sin_dv: EMISOR_MAURICIO.documento_numero,
    emisor_regimen: EMISOR_MAURICIO.regimen,
    emisor_direccion: EMISOR_MAURICIO.direccion,
    emisor_email: EMISOR_MAURICIO.email,
    emisor_telefono: EMISOR_MAURICIO.telefono,
    emisor_ciiu: EMISOR_MAURICIO.ciiu_full,
    pagador_nombre: empresa.razon_social ?? empresa.nombre,
    pagador_nit: empresa.numero_documento ?? '—',
    pagador_direccion: empresa.direccion_fiscal ?? '—',
    pagador_representante: empresa.contacto_nombre ?? '—',
    pagador_email: empresa.email_fiscal ?? '—',
    pagador_telefono: empresa.telefono ?? '—',
    concepto_titulo: 'Concepto',
    concepto_parrafos: conceptoParrafos,
    conceptos: [{ detalle: conceptoDetalle, monto: formatCOP(cuota.monto) }],
    total_label: `Total a cobrar — ${formatFechaLetras(fechaVencimiento).replace(/^\d+ de /, '')}`,
    total_formato: formatCOP(cuota.monto),
    total_letras: montoEnLetrasCOP(cuota.monto),
    nota_redondeo: '',
    banco_nombre: EMISOR_MAURICIO.banco.nombre,
    banco_tipo: EMISOR_MAURICIO.banco.tipo,
    banco_numero: EMISOR_MAURICIO.banco.numero,
    banco_titular: EMISOR_MAURICIO.banco.titular,
    banco_identificacion: EMISOR_MAURICIO.banco.identificacion,
    nota_pila_html: '',
    año_gravable_declaracion: String(getAnioGravableDeclaracion(new Date(fechaEmision + 'T12:00:00Z'))),
  }

  // 7. Render + Drive
  const pdfBytes = await renderCuentaCobro(TEMPLATE_SLUG, payload, options.isDraft ?? false)
  let pdfDriveId: string | null = null
  let pdfDriveUrl: string | null = null
  const folderId = extractFolderIdFromUrl(negocio.carpeta_url)
  if (folderId) {
    const subId = await createDriveFolder(SUBFOLDER_CUENTAS, folderId, workspaceId)
    const fileName = `${numero} — ${empresa.razon_social ?? empresa.nombre}.pdf`
    const up = await uploadFileToDrive(pdfBytes, fileName, 'application/pdf', subId, workspaceId)
    pdfDriveId = up.fileId
    pdfDriveUrl = up.webViewLink ?? `https://drive.google.com/file/d/${up.fileId}/view`
  }

  // 8. Insertar cuenta
  const { error: insErr } = await supabase.from('cuentas_cobro_emitidas').insert({
    workspace_id: workspaceId,
    numero,
    anio,
    mes,
    empresa_id_pagador: empresa.id,
    cobros_ids: [cobroId],
    monto_total: cuota.monto,
    pdf_drive_id: pdfDriveId,
    pdf_drive_url: pdfDriveUrl,
    estado: 'emitida_pendiente_aprobacion',
    fecha_emision: fechaEmision,
    fecha_vencimiento: fechaVencimiento,
    email_destinatarios: empresa.email_fiscal ? [empresa.email_fiscal] : null,
  })
  if (insErr) return { success: false, error: `Insert cuenta: ${insErr.message}` }

  const { data: cuentaIns } = await supabase
    .from('cuentas_cobro_emitidas')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('numero', numero)
    .maybeSingle()

  return {
    success: true,
    numero,
    cuentaId: (cuentaIns as { id: string } | null)?.id ?? '',
    pdfUrl: pdfDriveUrl,
  }
}

/**
 * Emite todas las cuotas explícitas que vencen en el período (anio/mes) para el workspace.
 * Corre junto al generador uniforme; cubre solo planes con plan_cobro_cuotas.
 */
export async function emitirCuentasExplicitasPeriodo(
  supabase: SupabaseClient,
  workspaceId: string,
  anio: number,
  mes: number,
  options: { isDraft?: boolean; fechaEmisionOverride?: string } = {},
): Promise<EmitirCuotaResult[]> {
  const mesInicio = `${anio}-${String(mes).padStart(2, '0')}-01`
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  const mesFin = `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`

  const { data: cuotas } = await supabase
    .from('plan_cobro_cuotas')
    .select('id, planes_cobro!inner(activo, workspace_id)')
    .eq('planes_cobro.workspace_id', workspaceId)
    .eq('planes_cobro.activo', true)
    .gte('fecha_vencimiento', mesInicio)
    .lte('fecha_vencimiento', mesFin)

  const results: EmitirCuotaResult[] = []
  for (const q of (cuotas ?? []) as { id: string }[]) {
    results.push(await emitirCuentaDesdeCuota(supabase, q.id, options))
  }
  return results
}
