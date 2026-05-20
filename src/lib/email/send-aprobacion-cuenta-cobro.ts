/**
 * Notificación a Mauricio cuando una cuenta de cobro queda pendiente de aprobación.
 *
 * Complementa la notificación in-app (ya emitida por generarCuentasCobroPeriodo).
 * Email simple con deep link al módulo /cobros-recurrentes.
 */

import { formatCOP } from '@/lib/cobros/format'

const FROM_NOTIFY = 'MéTRIK ONE <noreply@metrikone.co>'
const NOTIFY_TO = 'mauricio.moreno@metrik.com.co'

type AprobacionPayload = {
  workspaceSlug: string
  numero: string
  empresaNombre: string
  montoTotal: number
}

export async function enviarEmailAprobacionPendiente(
  payload: AprobacionPayload,
): Promise<{ success: boolean; error?: string }> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return { success: false, error: 'RESEND_API_KEY no configurada' }

  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? 'metrikone.co'
  const deepLink = `https://${payload.workspaceSlug}.${baseDomain}/cobros-recurrentes`

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Cuenta pendiente de aprobación</title></head>
<body style="margin:0;padding:0;background:#F5F4F2;font-family:'Helvetica Neue',Arial,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#FFFFFF;border-radius:8px;border:1px solid #E5E7EB;">
        <tr><td style="padding:24px 28px 4px 28px;">
          <div style="font-size:20px;font-weight:700;color:#1A1A1A;">MéTRIK ONE</div>
          <div style="height:2px;width:42px;background:#10B981;margin-top:4px;"></div>
        </td></tr>
        <tr><td style="padding:12px 28px 0 28px;">
          <h1 style="margin:0;font-size:17px;font-weight:600;">Cuenta de cobro pendiente de aprobación</h1>
        </td></tr>
        <tr><td style="padding:8px 28px 0 28px;font-size:14px;line-height:1.6;color:#1A1A1A;">
          <p style="margin:0 0 10px 0;">La cuenta <strong>${payload.numero}</strong> está lista para tu revisión.</p>
          <p style="margin:0 0 10px 0;">Pagador: <strong>${payload.empresaNombre}</strong><br/>Monto: <strong>${formatCOP(payload.montoTotal)}</strong></p>
          <p style="margin:18px 0 0 0;">
            <a href="${deepLink}" style="display:inline-block;padding:11px 22px;background:#10B981;color:#FFFFFF;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Revisar y aprobar</a>
          </p>
        </td></tr>
        <tr><td style="padding:18px 28px 22px 28px;border-top:1px solid #E5E7EB;margin-top:18px;font-size:11px;color:#6B7280;">
          MéTRIK ONE · ${payload.workspaceSlug}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_NOTIFY,
      to: [NOTIFY_TO],
      subject: `[ONE · ${payload.workspaceSlug}] Cuenta ${payload.numero} pendiente de aprobación`,
      html,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { success: false, error: `Resend ${res.status}: ${(err as { message?: string }).message ?? res.statusText}` }
  }

  return { success: true }
}
