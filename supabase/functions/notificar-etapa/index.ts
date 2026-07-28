// Edge function — avisa por CORREO cuando un negocio entra a una etapa marcada
// para avisar.
//
// POR QUE UNA EDGE FUNCTION Y NO UN CAMBIO EN `cambiarEtapaNegocio`:
//   1. El motor de avance de etapa es territorio de otra sesión de trabajo (S1).
//      Un trigger de base de datos captura el cambio SIN tocar ese archivo.
//   2. Un trigger cubre TODOS los caminos: la UI, el motor de routing, un salto
//      automático de etapa, un backfill por SQL. Enganchar en el código habría
//      cubierto solo el camino que se enganchó.
//   3. La RESEND_API_KEY vive en los secretos de la edge function, no en SQL.
//
// Quién dispara esto: el trigger `trg_avisar_entrada_etapa` sobre `negocios`,
// vía pg_net (mismo patrón que los crons de wa-alerts).
//
// La notificación IN-APP ya la creó el trigger. Esto es el refuerzo por correo:
// el comercial puede estar sin la plataforma abierta.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const FROM = 'MéTRIK ONE <noreply@metrikone.co>';

type Payload = { negocio_id: string };

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const expected = Deno.env.get('NOTIFICAR_ETAPA_SECRET');
  if (!expected) return json({ error: 'server_misconfigured', detail: 'NOTIFICAR_ETAPA_SECRET' }, 500);

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ') || auth.slice(7).trim() !== expected) {
    return json({ error: 'unauthorized' }, 401);
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'server_misconfigured', detail: 'RESEND_API_KEY' }, 500);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!body?.negocio_id) return json({ error: 'negocio_id requerido' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Qué negocio, en qué etapa, con qué copy ────────────────────────────────
  const { data: negocio } = await supabase
    .from('negocios')
    .select('id, codigo, nombre, workspace_id, etapa_actual_id, workspaces(slug)')
    .eq('id', body.negocio_id)
    .maybeSingle();

  if (!negocio) return json({ error: 'negocio_no_encontrado' }, 404);

  const { data: etapa } = await supabase
    .from('etapas_negocio')
    .select('nombre, config_extra')
    .eq('id', negocio.etapa_actual_id)
    .maybeSingle();

  const aviso = (etapa?.config_extra as Record<string, unknown> | null)?.avisar_al_entrar as
    | { email?: boolean; titulo?: string; mensaje?: string }
    | undefined;

  // Sin config de aviso o con el correo apagado -> nada que hacer (la
  // notificación in-app ya se creó igual).
  if (!aviso?.email) return json({ ok: true, skipped: 'sin_aviso_email' });

  // ── A quién: el responsable del stage de la etapa ──────────────────────────
  const { data: destinatarios } = await supabase.rpc('destinatarios_negocio', {
    p_negocio_id: negocio.id,
  });

  const profileIds = ((destinatarios ?? []) as Array<{ profile_id: string }>)
    .map((d) => d.profile_id)
    .filter(Boolean);

  if (profileIds.length === 0) return json({ ok: true, skipped: 'sin_destinatarios' });

  // El email vive en auth.users, no en profiles.
  const correos: string[] = [];
  for (const pid of profileIds) {
    const { data: user } = await supabase.auth.admin.getUserById(pid);
    const email = user?.user?.email;
    if (email) correos.push(email);
  }
  if (correos.length === 0) return json({ ok: true, skipped: 'sin_correos' });

  // ── El correo ──────────────────────────────────────────────────────────────
  const slug = (negocio.workspaces as { slug?: string } | null)?.slug ?? '';
  const baseDomain = Deno.env.get('BASE_DOMAIN') ?? 'metrikone.co';
  const link = `https://${slug}.${baseDomain}/negocios/${negocio.id}`;
  const etiqueta = negocio.codigo ? `${negocio.codigo} — ${negocio.nombre}` : negocio.nombre;

  const titulo = aviso.titulo ?? `${negocio.nombre} llegó a ${etapa?.nombre ?? 'una etapa nueva'}`;
  const mensaje = (aviso.mensaje ?? 'Este negocio pasó a tu etapa y espera tu gestión.')
    .replaceAll('{negocio}', negocio.nombre ?? '')
    .replaceAll('{codigo}', negocio.codigo ?? '')
    .replaceAll('{etapa}', etapa?.nombre ?? '');

  const html = `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#F5F4F2;font-family:Helvetica,Arial,sans-serif;color:#1A1A1A">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">${escapar(etapa?.nombre ?? '')}</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">${escapar(titulo)}</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151">${escapar(mensaje)}</p>
    <p style="margin:0 0 22px;font-size:13px;color:#6B7280">Negocio: <strong style="color:#1A1A1A">${escapar(etiqueta ?? '')}</strong></p>
    <a href="${link}" style="display:inline-block;background:#10B981;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">Abrir el negocio</a>
    <p style="margin:24px 0 0;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:14px">Enviado por MéTRIK ONE</p>
  </div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: correos, subject: titulo, html }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('[notificar-etapa] Resend falló:', res.status, detail);
    return json({ error: 'envio_fallido', status: res.status }, 502);
  }

  return json({ ok: true, enviados: correos.length });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** El copy es configurable por workspace: se escapa antes de entrar al HTML. */
function escapar(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
