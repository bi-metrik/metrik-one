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

  const cfgEtapa = etapa?.config_extra as Record<string, unknown> | null;

  const avisoRaw = cfgEtapa?.avisar_al_entrar as
    | { email?: boolean; activo?: boolean; titulo?: string; mensaje?: string; areas?: string[] }
    | undefined;
  // `activo: false` apaga el aviso interno conservando su texto (ver la migración
  // 20260813000001). Ausente = encendido, que es como se comportó siempre.
  const aviso = avisoRaw?.activo === false ? undefined : avisoRaw;

  const avisoCliente = cfgEtapa?.avisar_al_cliente as
    | { email?: boolean; titulo?: string; mensaje?: string }
    | undefined;

  // Dos destinos independientes. Si ninguno pide correo no hay nada que hacer (la
  // notificación in-app del equipo ya la creó el trigger).
  const quiereInterno = aviso?.email === true;
  const quiereCliente = avisoCliente?.email === true;
  if (!quiereInterno && !quiereCliente) return json({ ok: true, skipped: 'sin_aviso_email' });

  // ── El aviso al CLIENTE ────────────────────────────────────────────────────
  // Se despacha antes que el interno porque es el que el cliente está esperando, y
  // porque un fallo del interno no puede dejarlo sin su aviso.
  let clienteEnviado: string | null = null;
  let clienteOmitido: string | null = null;
  if (quiereCliente) {
    const r = await enviarAlCliente(supabase, resendKey, negocio, etapa?.nombre ?? '', avisoCliente!);
    clienteEnviado = r.enviadoA;
    clienteOmitido = r.omitidoPor;
  }

  if (!quiereInterno) {
    return json({ ok: true, cliente: clienteEnviado, cliente_omitido: clienteOmitido });
  }

  // ── A quién ────────────────────────────────────────────────────────────────
  // Dos modos, y el correo TIENE que resolver igual que el trigger o la campana
  // y el correo le llegarían a personas distintas:
  //   · `areas` declarado -> a todo el staff de esas áreas (pendiente de equipo).
  //     Se reparte por `staff_areas` SIN mirar el rol, igual que
  //     `crear_notificacion_equipo`: quien lleva un área con rol `admin` en vez de
  //     `supervisor` también tiene que enterarse.
  //   · sin `areas` -> comportamiento original: el responsable del stage.
  let profileIds: string[] = [];

  if (Array.isArray(aviso.areas) && aviso.areas.length > 0) {
    const { data: staffRows } = await supabase
      .from('staff')
      .select('id, profile_id')
      .eq('workspace_id', negocio.workspace_id)
      .not('profile_id', 'is', null);

    const staff = (staffRows ?? []) as Array<{ id: string; profile_id: string }>;
    if (staff.length > 0) {
      const { data: areaRows } = await supabase
        .from('staff_areas')
        .select('staff_id')
        .in('staff_id', staff.map((s) => s.id))
        .in('area', aviso.areas);

      const conArea = new Set(((areaRows ?? []) as Array<{ staff_id: string }>).map((a) => a.staff_id));
      profileIds = [...new Set(staff.filter((s) => conArea.has(s.id)).map((s) => s.profile_id))];
    }
  } else {
    const { data: destinatarios } = await supabase.rpc('destinatarios_negocio', {
      p_negocio_id: negocio.id,
    });

    profileIds = ((destinatarios ?? []) as Array<{ profile_id: string }>)
      .map((d) => d.profile_id)
      .filter(Boolean);
  }

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

  return json({ ok: true, enviados: correos.length, cliente: clienteEnviado, cliente_omitido: clienteOmitido });
});


/**
 * Aviso de avance al CLIENTE.
 *
 * Sale desde el correo de MeTRIK (somos el operador de la plataforma) pero el mensaje
 * habla de parte del workspace: quien contrató el trámite es cliente de SOENA y no
 * conoce a MeTRIK. Por eso el nombre del workspace encabeza el correo y el `reply_to`
 * apunta a su gente: si el cliente responde —y va a responder— tiene que caer donde
 * alguien lo lee, no en un buzón nuestro.
 *
 * Nunca lleva enlace a la plataforma: el cliente no tiene cuenta.
 *
 * El destinatario lo resuelve `email_cliente_negocio` en la base, que es la unica
 * definicion de "cual es el correo de este cliente" (contacto -> RUT).
 */
async function enviarAlCliente(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  resendKey: string,
  // deno-lint-ignore no-explicit-any
  negocio: any,
  etapaNombre: string,
  cfg: { titulo?: string; mensaje?: string },
): Promise<{ enviadoA: string | null; omitidoPor: string | null }> {
  const { data: email } = await supabase.rpc('email_cliente_negocio', { p_negocio_id: negocio.id });
  if (!email || typeof email !== 'string') {
    // Sin correo no se inventa un destinatario. Queda en el log para que el equipo
    // pueda pedirle el dato al cliente.
    console.warn('[notificar-etapa] sin correo de cliente:', negocio.codigo);
    return { enviadoA: null, omitidoPor: 'sin_correo' };
  }

  const { data: ws } = await supabase
    .from('workspaces')
    .select('nombre, config_extra')
    .eq('id', negocio.workspace_id)
    .maybeSingle();

  const marca = (ws?.nombre as string | undefined)?.trim() || 'tu proveedor';
  // A dónde contesta el cliente. Sin esto la respuesta muere en un buzón de MeTRIK.
  const replyTo = (ws?.config_extra as { email_respuesta?: string } | null)?.email_respuesta;

  const titulo = (cfg.titulo ?? 'Tu tramite avanzo')
    .replaceAll('{etapa}', etapaNombre)
    .replaceAll('{codigo}', negocio.codigo ?? '');
  const cuerpo = (cfg.mensaje ?? 'Te contamos que tu tramite paso a la etapa "{etapa}". Cualquier duda, responde a este correo.')
    .replaceAll('{etapa}', etapaNombre)
    .replaceAll('{codigo}', negocio.codigo ?? '')
    .replaceAll('{negocio}', negocio.nombre ?? '');

  const html = `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#F5F4F2;font-family:Helvetica,Arial,sans-serif;color:#1A1A1A">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">${escapar(marca)}</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">${escapar(titulo)}</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151">${escapar(cuerpo)}</p>
    ${negocio.codigo ? `<p style="margin:0 0 22px;font-size:13px;color:#6B7280">Radicado: <strong style="color:#1A1A1A">${escapar(negocio.codigo)}</strong></p>` : ''}
    <p style="margin:24px 0 0;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:14px">
      Recibes este aviso porque ${escapar(marca)} gestiona un tramite a tu nombre.
      Si no quieres recibirlos, responde a este correo y lo damos de baja.
    </p>
  </div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${marca} (via MeTRIK) <noreply@metrikone.co>`,
      to: [email],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: titulo,
      html,
    }),
  });

  if (!res.ok) {
    console.error('[notificar-etapa] Resend fallo con el cliente:', res.status, await res.text());
    return { enviadoA: null, omitidoPor: `resend_${res.status}` };
  }
  return { enviadoA: email, omitidoPor: null };
}

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
