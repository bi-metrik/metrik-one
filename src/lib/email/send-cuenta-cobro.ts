/**
 * Envío de cuenta de cobro al cliente vía Resend.
 *
 * Adjunta el PDF descargado desde Drive y mantiene branding MeTRIK.
 * From: facturacion@metrikone.co · Reply-To: mauricio.moreno@metrik.com.co
 *
 * Marca en cuentas_cobro_emitidas:
 *   - email_resend_id (id del envío)
 *   - email_enviado_at (ahora)
 *   - estado → 'enviada'
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { downloadDriveFile, getAccessToken } from '@/lib/google-drive'
import { formatCOP } from '@/lib/cobros/format'

const FROM_FACTURACION = 'MéTRIK · Facturación <facturacion@metrikone.co>'
const REPLY_TO_MAURICIO = 'mauricio.moreno@metrik.com.co'
const BCC_MAURICIO = 'mauricio.moreno@metrik.com.co'

type CuentaCobroParaEnvio = {
  id: string
  numero: string
  monto_total: number
  pdf_drive_id: string | null
  email_destinatarios: string[] | null
  fecha_vencimiento: string
  workspace_id: string
  empresa_id_pagador: string
  planilla_pila_id: string | null
  anio: number
  mes: number
}

type PlanillaPilaParaAdjunto = {
  id: string
  file_drive_id: string
}

/**
 * Resuelve la planilla PILA del periodo de la cuenta.
 * Prioridad: planilla_pila_id explícito → fallback por (workspace, anio, mes).
 * Si se resuelve por fallback, persiste el enlace en la cuenta.
 * Devuelve null si no hay planilla cargada (envío continúa sin adjunto).
 */
async function resolverPilaParaEnvio(
  supabase: SupabaseClient,
  cuenta: CuentaCobroParaEnvio,
): Promise<PlanillaPilaParaAdjunto | null> {
  if (cuenta.planilla_pila_id) {
    const { data } = await supabase
      .from('planillas_pila_periodo')
      .select('id, file_drive_id')
      .eq('id', cuenta.planilla_pila_id)
      .maybeSingle()
    return (data as PlanillaPilaParaAdjunto | null) ?? null
  }

  const { data } = await supabase
    .from('planillas_pila_periodo')
    .select('id, file_drive_id')
    .eq('workspace_id', cuenta.workspace_id)
    .eq('anio', cuenta.anio)
    .eq('mes', cuenta.mes)
    .maybeSingle()
  const pila = (data as PlanillaPilaParaAdjunto | null) ?? null

  if (pila) {
    await supabase
      .from('cuentas_cobro_emitidas')
      .update({ planilla_pila_id: pila.id })
      .eq('id', cuenta.id)
  }

  return pila
}

/**
 * Lee metadata (name, mimeType) de un archivo en Drive — para preservar
 * el filename real del PILA al adjuntarlo (puede ser PDF o imagen).
 */
async function getDriveFileMetadata(
  fileId: string,
  workspaceId: string,
): Promise<{ name: string; mimeType: string }> {
  const token = await getAccessToken(workspaceId)
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    throw new Error(`Drive metadata fetch fallo (${res.status})`)
  }
  return (await res.json()) as { name: string; mimeType: string }
}

type EmpresaPagadora = {
  nombre: string
  razon_social: string | null
  contacto_nombre: string | null
}

export type EnviarCuentaCobroResult =
  | { success: true; resend_id: string }
  | { success: false; error: string }

function buildClienteEmailHtml(args: {
  empresaNombre: string
  contactoNombre: string | null
  numero: string
  monto: number
  fechaVencimientoLetras: string
}): string {
  const saludo = args.contactoNombre
    ? `Hola ${args.contactoNombre},`
    : `Buen día,`

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Cuenta de cobro ${args.numero}</title>
</head>
<body style="margin:0;padding:0;background:#F5F4F2;font-family:'Helvetica Neue',Arial,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F4F2;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FFFFFF;border-radius:8px;overflow:hidden;border:1px solid #E5E7EB;">
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <div style="font-size:22px;font-weight:700;letter-spacing:0.5px;color:#1A1A1A;">MéTRIK</div>
              <div style="height:2px;width:48px;background:#10B981;margin-top:4px;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 8px 32px;">
              <h1 style="margin:0;font-size:18px;font-weight:600;color:#1A1A1A;">Cuenta de cobro ${args.numero}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 16px 32px;font-size:14px;line-height:1.6;color:#1A1A1A;">
              <p style="margin:0 0 12px 0;">${saludo}</p>
              <p style="margin:0 0 12px 0;">Adjunto encontrarás la cuenta de cobro <strong>${args.numero}</strong> correspondiente al acuerdo vigente con <strong>${args.empresaNombre}</strong>.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;width:100%;">
                <tr>
                  <td style="padding:10px 12px;background:#F5F4F2;border-radius:6px;font-size:13px;color:#6B7280;">Valor</td>
                  <td style="padding:10px 12px;background:#F5F4F2;border-radius:6px;text-align:right;font-size:15px;font-weight:600;color:#059669;">${formatCOP(args.monto)}</td>
                </tr>
                <tr><td style="height:6px;" colspan="2"></td></tr>
                <tr>
                  <td style="padding:10px 12px;background:#F5F4F2;border-radius:6px;font-size:13px;color:#6B7280;">Vencimiento</td>
                  <td style="padding:10px 12px;background:#F5F4F2;border-radius:6px;text-align:right;font-size:14px;color:#1A1A1A;">${args.fechaVencimientoLetras}</td>
                </tr>
              </table>
              <p style="margin:0 0 12px 0;">Los datos para el pago están detallados en el documento adjunto.</p>
              <p style="margin:0 0 4px 0;">Cualquier inquietud puedes responder a este correo.</p>
              <p style="margin:16px 0 0 0;">Gracias,<br/>Brallan Mauricio Moreno Guzmán</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 24px 32px;border-top:1px solid #E5E7EB;font-size:11px;color:#6B7280;">
              Powered by MéTRIK · <a href="https://www.metrik.com.co" style="color:#6B7280;text-decoration:underline;">www.metrik.com.co</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function formatFechaVencimientoLetras(iso: string): string {
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ]
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} de ${meses[m - 1]} de ${y}`
}

/**
 * Envía la cuenta de cobro al cliente (email_destinatarios) con PDF adjunto.
 * NO valida estado — el caller (server action) gatea quién puede llamar y cuándo.
 * Asume que la cuenta ya está aprobada (estado='aprobada_lista_envio').
 *
 * Side effects:
 *   - Marca email_resend_id + email_enviado_at + estado='enviada'
 */
export async function enviarCuentaCobroEmail(
  supabase: SupabaseClient,
  cuentaId: string,
): Promise<EnviarCuentaCobroResult> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return { success: false, error: 'RESEND_API_KEY no configurada' }

  // 1. Leer cuenta + empresa
  const { data: cuenta, error: cErr } = await supabase
    .from('cuentas_cobro_emitidas')
    .select('id, numero, monto_total, pdf_drive_id, email_destinatarios, fecha_vencimiento, workspace_id, empresa_id_pagador, planilla_pila_id, anio, mes')
    .eq('id', cuentaId)
    .maybeSingle()

  if (cErr || !cuenta) {
    return { success: false, error: `Cuenta ${cuentaId} no encontrada` }
  }

  const c = cuenta as unknown as CuentaCobroParaEnvio

  if (!c.email_destinatarios || c.email_destinatarios.length === 0) {
    return { success: false, error: 'La cuenta no tiene email_destinatarios configurados' }
  }

  if (!c.pdf_drive_id) {
    return { success: false, error: 'La cuenta no tiene PDF en Drive (pdf_drive_id null)' }
  }

  const { data: empresa } = await supabase
    .from('empresas')
    .select('nombre, razon_social, contacto_nombre')
    .eq('id', c.empresa_id_pagador)
    .maybeSingle()

  const emp = (empresa ?? null) as EmpresaPagadora | null
  const empresaNombre = emp?.razon_social ?? emp?.nombre ?? 'cliente'
  const contactoNombre = emp?.contacto_nombre ?? null

  // 2. Descargar PDF desde Drive (con workspace para resolver OAuth si aplica)
  let pdfBytes: Buffer
  try {
    pdfBytes = await downloadDriveFile(c.pdf_drive_id, c.workspace_id)
  } catch (err) {
    return { success: false, error: `No se pudo descargar PDF de Drive: ${err instanceof Error ? err.message : String(err)}` }
  }

  const pdfBase64 = pdfBytes.toString('base64')
  const filename = `${c.numero} — ${empresaNombre}.pdf`

  const attachments: Array<{ filename: string; content: string }> = [
    { filename, content: pdfBase64 },
  ]

  // 3. PILA del periodo (opcional — si no hay, se envía sin adjunto adicional)
  const pila = await resolverPilaParaEnvio(supabase, c)
  if (pila) {
    try {
      const [pilaBytes, pilaMeta] = await Promise.all([
        downloadDriveFile(pila.file_drive_id, c.workspace_id),
        getDriveFileMetadata(pila.file_drive_id, c.workspace_id),
      ])
      attachments.push({
        filename: pilaMeta.name,
        content: pilaBytes.toString('base64'),
      })
    } catch (err) {
      console.error(
        `[send-cuenta-cobro] No se pudo adjuntar PILA ${pila.id} de cuenta ${c.numero}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  // 4. Email HTML
  const html = buildClienteEmailHtml({
    empresaNombre,
    contactoNombre,
    numero: c.numero,
    monto: c.monto_total,
    fechaVencimientoLetras: formatFechaVencimientoLetras(c.fecha_vencimiento),
  })

  // 5. Enviar vía Resend
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_FACTURACION,
      to: c.email_destinatarios,
      bcc: [BCC_MAURICIO],
      reply_to: REPLY_TO_MAURICIO,
      subject: `Cuenta de cobro ${c.numero} — ${empresaNombre}`,
      html,
      attachments,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return {
      success: false,
      error: `Resend rechazó el envío (${res.status}): ${(err as { message?: string }).message ?? res.statusText}`,
    }
  }

  const body = (await res.json()) as { id?: string }
  const resendId = body.id ?? null

  // 5. Persistir estado
  const { error: updErr } = await supabase
    .from('cuentas_cobro_emitidas')
    .update({
      email_resend_id: resendId,
      email_enviado_at: new Date().toISOString(),
      estado: 'enviada',
    })
    .eq('id', cuentaId)

  if (updErr) {
    return { success: false, error: `Email enviado pero no se pudo persistir estado: ${updErr.message}` }
  }

  return { success: true, resend_id: resendId ?? '' }
}
