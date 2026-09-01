// Edge function — recibe alertas de servicios internos MeTRIK (Valida, etc.)
// y las envia por WhatsApp usando las credenciales del bot MeTRIK ONE.
//
// Auth: Bearer header con secret compartido (WA_NOTIFY_INTERNAL_SECRET).
// Body: { to, source?, y UNA de las dos formas de mandar }
//   - texto libre:  { text: string }            solo entrega dentro de la ventana de 24h
//   - plantilla:    { template: { name, language?, components? } }   entrega siempre
//
// La forma `template` existe para que los envios de plantilla dejen de hacerse a mano
// contra la Graph API. Los que salian asi no quedaban registrados en ninguna parte: el
// contrato de TERMOTECH SAS (2026-08-31) fue uno. Por aqui quedan en `wa_envios` con su
// acuse, y la respuesta devuelve el `wa_message_id` para poder consultarlo despues.
//
// Patron: en lugar de duplicar credenciales WA en cada producto, los productos
// internos (Valida) llaman a esta edge function. Asi credenciales viven solo en ONE.

import { sendTextMessage, sendTemplate } from '../_shared/wa-respond.ts';
import type { TemplateComponent } from '../_shared/wa-respond.ts';

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

  let body: {
    to?: string;
    text?: string;
    source?: string;
    template?: { name?: string; language?: string; components?: TemplateComponent[] };
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const plantilla = body.template?.name;
  if (!body.to || (!body.text && !plantilla)) {
    return new Response(
      JSON.stringify({ error: 'missing_fields', required: ['to', 'text | template.name'] }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const phone = body.to.replace(/\D/g, '');
  const source = body.source || 'internal';

  try {
    if (plantilla) {
      const waMessageId = await sendTemplate(
        phone,
        plantilla,
        body.template?.language || 'es',
        body.template?.components || [],
        { origen: 'template', intent: source },
      );
      // Un null aqui no es un detalle: Meta rechazo la plantilla y el destinatario no
      // recibio nada. Se devuelve 502 para que el que llama se entere en el momento.
      if (!waMessageId) {
        return new Response(
          JSON.stringify({ error: 'template_rejected', detail: 'Meta no acepto la plantilla', sent_to: phone }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ ok: true, sent_to: phone, wa_message_id: waMessageId, template: plantilla }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    await sendTextMessage(phone, `[${source}] ${body.text}`, { origen: 'interno', intent: source });
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
