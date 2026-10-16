// Edge function — avisa por CORREO a la persona que quedó como responsable de un negocio.
//
// Lo pidió Mauricio en la reunión con Trappvel del 2026-10-16: al crear un viaje desde WhatsApp el bot pregunta quién lo
// lleva, y esa persona tiene que enterarse. El aviso sale desde CUALQUIER camino de asignación (el bot, la asignación a
// mano en ONE, la automática por etapa, un script), así que lo dispara un trigger y no el código de cada camino:
//
//   · `trg_avisar_asignacion_responsable` (AFTER INSERT en `negocio_responsables`) crea la notificación de la campanita y
//     llama aquí por pg_net, con el mismo secreto de `notificar-etapa` (NOTIFICAR_ETAPA_SECRET).
//   · Esta función manda el correo, con la plantilla de los avisos de etapa (`_shared/correo-interno.ts`).
//
// No se avisa a quien se asignó a sí misma (el trigger ya no llama, y aquí se vuelve a revisar), ni a un staff inactivo,
// ni por un negocio que ya no está abierto. Una función aparte y no un modo de `notificar-etapa` a propósito: si el
// trigger llegara a la base antes del deploy, una función que no existe devuelve 404; una `notificar-etapa` vieja leería
// el `negocio_id` como una entrada a etapa y repetiría el aviso de esa etapa AL CLIENTE.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { htmlCorreoInterno, REMITENTE_INTERNO } from '../_shared/correo-interno.ts';
import { textoAvisoAsignacion } from '../_shared/aviso-asignacion.ts';

// Sin el `Database` generado (ver `notificar-etapa`): el `any` es el ESQUEMA, no el cliente.
// deno-lint-ignore no-explicit-any
type Supabase = SupabaseClient<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Payload = { negocio_id?: string; staff_id?: string; asignado_por?: string | null };

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const esperado = Deno.env.get('NOTIFICAR_ETAPA_SECRET');
  if (!esperado) return json({ error: 'server_misconfigured', detail: 'NOTIFICAR_ETAPA_SECRET' }, 500);
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ') || auth.slice(7).trim() !== esperado) return json({ error: 'unauthorized' }, 401);

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'server_misconfigured', detail: 'RESEND_API_KEY' }, 500);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!body?.negocio_id || !body?.staff_id) return json({ error: 'negocio_id y staff_id requeridos' }, 400);

  const supabase: Supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: negocio } = await supabase.from('negocios')
    .select('id, codigo, nombre, estado, workspace_id, workspaces(slug)').eq('id', body.negocio_id).maybeSingle();
  if (!negocio) return json({ error: 'negocio_no_encontrado' }, 404);
  if ((negocio.estado ?? 'abierto') !== 'abierto') return json({ ok: true, skipped: 'negocio_no_abierto' });

  // La persona, dentro del workspace del negocio (el trigger ya lo exigió; se vuelve a mirar: la llamada es asíncrona).
  const { data: staff } = await supabase.from('staff').select('id, profile_id, full_name, is_active')
    .eq('id', body.staff_id).eq('workspace_id', negocio.workspace_id).maybeSingle();
  if (!staff || staff.is_active !== true || !staff.profile_id) return json({ ok: true, skipped: 'staff_no_disponible' });
  if (body.asignado_por && body.asignado_por === staff.profile_id) return json({ ok: true, skipped: 'se_asigno_a_si_misma' });

  // Sigue siendo responsable (si la quitaron en el intervalo, no se le avisa de algo que ya no lleva).
  const { data: fila } = await supabase.from('negocio_responsables').select('rol')
    .eq('negocio_id', negocio.id).eq('staff_id', staff.id).maybeSingle();
  if (!fila) return json({ ok: true, skipped: 'ya_no_es_responsable' });

  // El email vive en auth.users, no en profiles.
  const { data: user } = await supabase.auth.admin.getUserById(staff.profile_id);
  const correo = user?.user?.email;
  if (!correo) return json({ ok: true, skipped: 'sin_correo' });

  let quienAsigna: string | null = null;
  if (body.asignado_por) {
    const { data: autor } = await supabase.from('staff').select('full_name')
      .eq('profile_id', body.asignado_por).eq('workspace_id', negocio.workspace_id).maybeSingle();
    quienAsigna = (autor?.full_name as string | null | undefined) ?? null;
  }

  const t = textoAvisoAsignacion({ codigo: negocio.codigo, nombre: negocio.nombre, rol: (fila.rol as string | null) ?? null, quienAsigna });
  const slug = (negocio.workspaces as { slug?: string } | null)?.slug ?? '';
  const link = `https://${slug}.${Deno.env.get('BASE_DOMAIN') ?? 'metrikone.co'}/negocios/${negocio.id}`;
  const html = htmlCorreoInterno({ antetitulo: 'Responsable asignado', titulo: t.titulo, mensaje: t.mensaje, etiqueta: t.etiqueta, link });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: REMITENTE_INTERNO, to: [correo], subject: t.titulo, html }),
  });
  if (!res.ok) {
    console.error('[avisar-asignacion] Resend falló:', res.status, await res.text());
    return json({ error: 'envio_fallido', status: res.status }, 502);
  }
  return json({ ok: true, enviados: 1 });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
