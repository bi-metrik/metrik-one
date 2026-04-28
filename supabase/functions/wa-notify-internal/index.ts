// Edge function — recibe alertas de servicios internos MeTRIK (Valida, etc.)
// y las envia por WhatsApp usando las credenciales del bot MeTRIK ONE.
//
// Auth: Bearer header con secret compartido (WA_NOTIFY_INTERNAL_SECRET).
// Body: { to: string, text: string, source?: string }
//
// Patron: en lugar de duplicar credenciales WA en cada producto, los productos
// internos (Valida) llaman a esta edge function. Asi credenciales viven solo en ONE.

import { sendTextMessage } from '../_shared/wa-respond.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Auth con secret compartido
  const auth = req.headers.get('authorization');
  const expected = Deno.env.get('WA_NOTIFY_INTERNAL_SECRET');
  if (!expected) {
    return new Response(JSON.stringify({ error: 'server_misconfigured', detail: 'WA_NOTIFY_INTERNAL_SECRET no configurado' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!auth?.startsWith('Bearer ') || auth.slice(7).trim() !== expected) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { to?: string; text?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.to || !body.text) {
    return new Response(JSON.stringify({ error: 'missing_fields', required: ['to', 'text'] }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const phone = body.to.replace(/\D/g, '');
  const sourceTag = body.source ? `[${body.source}]` : '[internal]';
  const finalText = `${sourceTag} ${body.text}`;

  try {
    await sendTextMessage(phone, finalText);
    return new Response(JSON.stringify({ ok: true, sent_to: phone }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'send_failed',
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
