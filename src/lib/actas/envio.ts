// ============================================================
// Actas — envio del acta por email via Resend
//
// Patron copiado de src/lib/email/send-cuenta-cobro.ts: mismo fetch a
// api.resend.com, mismo manejo de error (res.ok + parseo del error de
// Resend), misma persistencia del resultado (resend_id + enviado_at +
// estado='enviada') despues de un envio exitoso.
//
// MODO_ENVIO_DEFAULT = 'revision' (decision de Mauricio, no se repregunta):
// la primera semana las actas se mandan SOLO a el como vista previa. En
// 'produccion' se manda a los participantes reales del evento de Calendar.
//
// Config-driven: no hay workspace resuelto por reunion en esta iteracion (ver
// el comentario de workspace_id en la migracion 20260824163717), asi que el
// modo de envio no puede leerse de `workspaces.config_extra` — vive como
// constante top-level. El dia que exista un workspace por reunion, este es el
// punto donde entra ese config_extra.
//
// Server-only.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CandidataActa } from './seleccion'
import type { ActaGenerada } from './generacion'

export type ModoEnvio = 'revision' | 'produccion'

export const MODO_ENVIO_DEFAULT: ModoEnvio = 'revision'

const FROM_ACTAS = 'MéTRIK · Actas <actas@metrikone.co>'
const REPLY_TO_MAURICIO = 'mauricio.moreno@metrik.com.co'
const DESTINATARIO_REVISION = 'mauricio.moreno@metrik.com.co'
const PREFIJO_BORRADOR = '[BORRADOR] '

export type EnviarActaResult =
  | { success: true; resend_id: string }
  | { success: false; error: string }

function destinatarios(candidata: CandidataActa, modoEnvio: ModoEnvio): string[] {
  if (modoEnvio === 'revision') return [DESTINATARIO_REVISION]
  return candidata.reunion.participantes
    .filter((p) => !p.esUnoMismo)
    .map((p) => p.email)
}

function formatFechaLetras(iso: string): string {
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ]
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} de ${meses[m - 1]} de ${y}`
}

/**
 * `fecha_reunion` en la tabla es DATE puro (YYYY-MM-DD), en dia calendario de
 * BOGOTA. No se puede leer con `new Date(iso).getDate()`: esos getters
 * reportan segun la zona horaria LOCAL del runtime (en Vercel, UTC), no la del
 * offset que trae el ISO original — para una reunion tarde en la noche
 * Bogota (ej. 20:00 -05:00 = 01:00 UTC del dia siguiente) eso devolveria el
 * dia equivocado. Se desplaza el instante UTC por el offset de Bogota y se
 * leen los componentes UTC del resultado, mismo criterio que usa
 * `listarReunionesDelDia` en calendario.ts.
 */
export function fechaReunionISO(inicioISO: string, offsetHoras = -5): string {
  const t = new Date(inicioISO).getTime()
  const bogota = new Date(t + offsetHoras * 3600 * 1000)
  const y = bogota.getUTCFullYear()
  const m = String(bogota.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(bogota.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dia}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function buildActaEmailHtml(args: {
  titulo: string
  fechaLetras: string
  resumen: string
  decisiones: string[]
  compromisos: { responsable: string; tarea: string; fecha_limite: string | null }[]
  modoEnvio: ModoEnvio
}): string {
  const decisionesHtml = args.decisiones.length
    ? `<ul style="margin:0;padding-left:18px;">${args.decisiones
        .map((d) => `<li style="margin:0 0 6px 0;">${escapeHtml(d)}</li>`)
        .join('')}</ul>`
    : `<p style="margin:0;color:#6B7280;">No se registraron decisiones formales.</p>`

  const porResponsable = new Map<string, { tarea: string; fecha_limite: string | null }[]>()
  for (const c of args.compromisos) {
    const lista = porResponsable.get(c.responsable) ?? []
    lista.push({ tarea: c.tarea, fecha_limite: c.fecha_limite })
    porResponsable.set(c.responsable, lista)
  }

  const compromisosHtml = porResponsable.size
    ? [...porResponsable.entries()]
        .map(
          ([responsable, tareas]) => `
        <div style="margin:0 0 14px 0;">
          <div style="font-size:13px;font-weight:600;color:#1A1A1A;margin:0 0 4px 0;">${escapeHtml(responsable)}</div>
          <ul style="margin:0;padding-left:18px;">
            ${tareas
              .map(
                (t) =>
                  `<li style="margin:0 0 4px 0;">${escapeHtml(t.tarea)}${
                    t.fecha_limite ? ` <span style="color:#6B7280;">— ${escapeHtml(t.fecha_limite)}</span>` : ''
                  }</li>`,
              )
              .join('')}
          </ul>
        </div>`,
        )
        .join('')
    : `<p style="margin:0;color:#6B7280;">No se registraron compromisos concretos.</p>`

  const avisoRevision =
    args.modoEnvio === 'revision'
      ? `<tr><td style="padding:12px 32px 0 32px;">
          <div style="background:#FEF3C7;border-radius:6px;padding:10px 12px;font-size:12px;color:#92400E;">
            Borrador en modo revision: este correo solo te llega a ti, no a los participantes reales.
          </div>
        </td></tr>`
      : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Acta — ${escapeHtml(args.titulo)}</title>
</head>
<body style="margin:0;padding:0;background:#F5F4F2;font-family:'Helvetica Neue',Arial,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F4F2;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#FFFFFF;border-radius:8px;overflow:hidden;border:1px solid #E5E7EB;">
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <div style="font-size:22px;font-weight:700;letter-spacing:0.5px;color:#1A1A1A;">MéTRIK</div>
              <div style="height:2px;width:48px;background:#10B981;margin-top:4px;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 4px 32px;">
              <h1 style="margin:0;font-size:18px;font-weight:600;color:#1A1A1A;">${escapeHtml(args.titulo)}</h1>
              <div style="font-size:13px;color:#6B7280;margin-top:2px;">${args.fechaLetras}</div>
            </td>
          </tr>
          ${avisoRevision}
          <tr>
            <td style="padding:16px 32px 4px 32px;">
              <h2 style="margin:0 0 6px 0;font-size:13px;font-weight:600;color:#059669;text-transform:uppercase;letter-spacing:0.5px;">Resumen</h2>
              <p style="margin:0;font-size:14px;line-height:1.6;">${escapeHtml(args.resumen)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 4px 32px;">
              <h2 style="margin:0 0 6px 0;font-size:13px;font-weight:600;color:#059669;text-transform:uppercase;letter-spacing:0.5px;">Decisiones</h2>
              <div style="font-size:14px;line-height:1.6;">${decisionesHtml}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 20px 32px;">
              <h2 style="margin:0 0 10px 0;font-size:13px;font-weight:600;color:#059669;text-transform:uppercase;letter-spacing:0.5px;">Compromisos</h2>
              <div style="font-size:14px;line-height:1.5;">${compromisosHtml}</div>
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

/**
 * Envia el acta por email y, si el envio fue exitoso, persiste
 * resend_id + enviado_at + estado='enviada' en la fila `actaId` de
 * actas_generadas. NO valida estado previo — el caller (el cron) es quien
 * decide cuando llamar esto, igual que send-cuenta-cobro.ts.
 */
export async function enviarActa(
  supabase: SupabaseClient,
  actaId: string,
  candidata: CandidataActa,
  acta: ActaGenerada,
  modoEnvio: ModoEnvio = MODO_ENVIO_DEFAULT,
): Promise<EnviarActaResult> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return { success: false, error: 'RESEND_API_KEY no configurada' }

  const dest = destinatarios(candidata, modoEnvio)
  if (dest.length === 0) {
    return { success: false, error: 'Sin destinatarios: la reunion no tiene participantes externos' }
  }

  const titulo = candidata.reunion.titulo ?? candidata.transcripcion.titulo ?? 'Reunion sin titulo'
  const fechaLetras = formatFechaLetras(fechaReunionISO(candidata.reunion.inicio))

  const html = buildActaEmailHtml({
    titulo,
    fechaLetras,
    resumen: acta.resumen,
    decisiones: acta.decisiones,
    compromisos: acta.compromisos,
    modoEnvio,
  })

  const subjectBase = `Acta — ${titulo} — ${fechaLetras}`
  const subject = modoEnvio === 'revision' ? `${PREFIJO_BORRADOR}${subjectBase}` : subjectBase

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_ACTAS,
      to: dest,
      reply_to: REPLY_TO_MAURICIO,
      subject,
      html,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return {
      success: false,
      error: `Resend rechazo el envio (${res.status}): ${(err as { message?: string }).message ?? res.statusText}`,
    }
  }

  const body = (await res.json()) as { id?: string }
  const resendId = body.id ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (supabase as any)
    .from('actas_generadas')
    .update({
      resend_id: resendId,
      enviado_at: new Date().toISOString(),
      estado: 'enviada',
    })
    .eq('id', actaId)

  if (updErr) {
    return { success: false, error: `Email enviado pero no se pudo persistir estado: ${updErr.message}` }
  }

  return { success: true, resend_id: resendId ?? '' }
}
