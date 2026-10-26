// ============================================================
// El correo interno de ONE al equipo — una sola plantilla
// ------------------------------------------------------------
// La usan `notificar-etapa` (un negocio entró a tu etapa) y `avisar-asignacion` (te dejaron como responsable de un
// negocio, 2026-10-16). Mauricio pidió que el aviso de asignación fuera «el mismo correo que ya usan los avisos de
// etapa»: mismo remitente, mismo formato y el mismo botón al negocio. Puro: sin Deno ni red.
// ============================================================

/** El remitente de los correos internos de ONE. */
export const REMITENTE_INTERNO = 'MéTRIK ONE <noreply@metrikone.co>';

export function escaparHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/**
 * El HTML del correo: la línea de arriba (`antetitulo`: la etapa, o «Responsable asignado»), el título, el mensaje, el
 * negocio y el botón «Abrir el negocio». Todo el texto se escapa aquí. Pura.
 */
export function htmlCorreoInterno(p: { antetitulo: string; titulo: string; mensaje: string; etiqueta: string; link: string }): string {
  return `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#F5F4F2;font-family:Helvetica,Arial,sans-serif;color:#1A1A1A">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">${escaparHtml(p.antetitulo)}</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">${escaparHtml(p.titulo)}</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151">${escaparHtml(p.mensaje)}</p>
    <p style="margin:0 0 22px;font-size:13px;color:#6B7280">Negocio: <strong style="color:#1A1A1A">${escaparHtml(p.etiqueta)}</strong></p>
    <a href="${p.link}" style="display:inline-block;background:#10B981;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">Abrir el negocio</a>
    <p style="margin:24px 0 0;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:14px">Enviado por MéTRIK ONE</p>
  </div>
</body></html>`;
}

// ── El envío (Resend) ────────────────────────────────────────────────────────

/** El destino de los avisos internos de los asistentes (Mauricio, 2026-10-26). */
export const CORREO_MAURICIO = 'mauricio.moreno@metrik.com.co';

export interface CorreoInterno {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Resend no manda dos veces el mismo correo con la misma llave (24 h). */
  idempotencyKey: string;
}

/** `status`: el HTTP de Resend cuando respondió (409 = esa llave ya se usó: el correo ya salió o está saliendo). */
export type ResultadoCorreo = { ok: true } | { ok: false; error: string; status?: number };
export type EnvioCorreo = (m: CorreoInterno) => Promise<ResultadoCorreo>;

/** Un `pre` con el texto plano escapado: el mismo contenido en las dos versiones del correo. Pura. */
export function htmlDeTexto(texto: string): string {
  return `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#F5F4F2;font-family:Helvetica,Arial,sans-serif;color:#1A1A1A">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:24px">
    <pre style="margin:0;white-space:pre-wrap;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.55">${escaparHtml(texto)}</pre>
    <p style="margin:20px 0 0;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:12px">Enviado por MéTRIK ONE</p>
  </div>
</body></html>`;
}

/** Manda un correo interno por Resend. Nunca lanza. */
export async function enviarCorreoInterno(
  m: CorreoInterno, o: { llave?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<ResultadoCorreo> {
  try {
    const llave = o.llave ?? Deno.env.get('RESEND_API_KEY') ?? '';
    if (!llave) return { ok: false, error: 'sin RESEND_API_KEY' };
    const f = o.fetch ?? ((u: RequestInfo | URL, i?: RequestInit) => globalThis.fetch(u, i));
    const res = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${llave}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
      body: JSON.stringify({ from: REMITENTE_INTERNO, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 8_000),
    });
    if (res.ok) return { ok: true };
    const detalle = (await res.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ');
    return { ok: false, error: `Resend respondió ${res.status}${detalle ? `: ${detalle}` : ''}`, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
