// ============================================================
// wa-parse-test — Endpoint de pruebas para el parser
// Lean: solo corre parseMessage + devuelve telemetría.
// NO escribe en DB, NO envía mensajes WhatsApp, NO toca sesiones.
// Auth: Bearer token vía env WA_STRESS_TOKEN (obligatorio en prod).
// ============================================================

import { parseMessage, getLastParseTelemetry } from '../_shared/wa-parse.ts';
import type { LastContext } from '../_shared/types.ts';

interface TestRequest {
  text: string;
  bucket_key?: string;
  last_context?: LastContext;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Auth: bearer token
  const expectedToken = Deno.env.get('WA_STRESS_TOKEN');
  if (!expectedToken) {
    console.error('[wa-parse-test] WA_STRESS_TOKEN not set — rejecting');
    return json({ error: 'server_not_configured' }, 503);
  }
  const auth = req.headers.get('authorization') || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (provided !== expectedToken) {
    return json({ error: 'unauthorized' }, 401);
  }

  // Parse body
  let body: TestRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!body.text || typeof body.text !== 'string') {
    return json({ error: 'missing_text' }, 400);
  }

  // Run parser (optionally with injected last_context for anaphora tests)
  const t0 = Date.now();
  const parsed = await parseMessage(body.text, body.bucket_key, body.last_context);
  const telemetry = getLastParseTelemetry();
  const totalMs = Date.now() - t0;

  return json({
    intent: parsed.intent,
    confidence: parsed.confidence,
    fields: parsed.fields,
    telemetry,
    total_latency_ms: totalMs,
  });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
