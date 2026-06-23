// ============================================================
// wa-webhook — Main WhatsApp Webhook (Spec 98F §1)
// Receives Meta webhook, identifies user, parses intent, routes
// ============================================================

import { getServiceClient } from '../_shared/supabase-client.ts';
import { parseMessage, getLastParseTelemetry } from '../_shared/wa-parse.ts';
import { transcribeAudio } from '../_shared/wa-transcribe.ts';
import { sendTextMessage, sendButtons, sendCtaUrl } from '../_shared/wa-respond.ts';
import { getOrCreateSession, isAwaitingResponse, updateSession } from '../_shared/wa-session.ts';
import { isCardumenChatTrigger, hasOpenCardumenChat, startCardumenChat, continueCardumenChat } from '../_shared/cardumen/index.ts';
import { checkInboundLimit, logMessage } from '../_shared/wa-rate-limit.ts';
import { handleRegistro } from '../_shared/handlers/registro/index.ts';
import { handleConsulta } from '../_shared/handlers/consulta.ts';
import { handleActividad } from '../_shared/handlers/actividad.ts';
import { handleAyuda, handleUnclear, handleUnclearResume } from '../_shared/handlers/ayuda.ts';
import type { HandlerContext, IncomingMessage, Intent, WaUser } from '../_shared/types.ts';
import { OPERATOR_ALLOWED_INTENTS, CONTADOR_ALLOWED_INTENTS, READ_ONLY_ALLOWED_INTENTS } from '../_shared/types.ts';

Deno.serve(async (req) => {
  // --- GET: Webhook verification ---
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === Deno.env.get('WHATSAPP_VERIFY_TOKEN')) {
      console.log('[wa-webhook] Verification OK');
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // --- POST: Incoming messages ---
  if (req.method === 'POST') {
    try {
      // Verify HMAC signature
      const body = await req.text();
      const signature = req.headers.get('x-hub-signature-256');
      if (!verifySignature(body, signature)) {
        console.error('[wa-webhook] Invalid signature');
        return new Response('Invalid signature', { status: 401 });
      }

      const payload = JSON.parse(body);

      // Extract message from Meta webhook format
      const message = extractMessage(payload);
      if (!message) {
        return new Response('OK', { status: 200 }); // Status updates, etc.
      }

      // Process async — respond 200 immediately (Meta expects < 20s)
      processMessage(message).catch((err) =>
        console.error('[wa-webhook] Process error:', err)
      );

      return new Response('OK', { status: 200 });
    } catch (err) {
      console.error('[wa-webhook] Error:', err);
      return new Response('OK', { status: 200 }); // Always 200 for Meta
    }
  }

  return new Response('Method not allowed', { status: 405 });
});

// ============================================================
// Core Processing Pipeline
// ============================================================

async function processMessage(message: IncomingMessage): Promise<void> {
  const supabase = getServiceClient();

  // 0a. Cardumen — Flow completado: guardar la respuesta y agradecer. Va PRIMERO (participantes ≠ usuarios ONE).
  if (message.type === 'flow_response') {
    await storeCardumenFlowResponse(supabase, message.phone, message.flow_response || '');
    await sendTextMessage(message.phone, '🐟 ¡Gracias! Tu historia ya forma parte del cardumen.');
    return;
  }

  // 0b. CardumenChat — AISLAMIENTO TOTAL. Si hay una conversacion Cardumen ABIERTA para este telefono,
  //     TODO mensaje (texto o audio) va al entrevistador y retorna ANTES de cualquier logica de ONE.
  //     Un audio (u otro mensaje) en medio de Cardumen NUNCA debe caer en el flujo de gastos/intents.
  if (await hasOpenCardumenChat(supabase, message.phone)) {
    let texto = message.text || '';
    if (message.type === 'audio' && message.audio_id) {
      const result = await transcribeAudio(message.audio_id);
      if (!result.text) {
        await sendTextMessage(message.phone, 'No alcancé a entender el audio. ¿Me lo puedes escribir o repetir?');
        return;
      }
      texto = result.text;
    }
    if (!texto.trim()) {
      await sendTextMessage(message.phone, 'Por ahora respóndeme con un mensaje de texto o de voz, por favor.');
      return;
    }
    await continueCardumenChat(supabase, message.phone, texto);
    return;
  }

  // 0c. Cardumen — disparadores PÚBLICOS por palabra clave (solo si NO hay conversacion abierta).
  //     El usuario escribió la palabra → ventana de servicio 24h (mensaje gratis).
  if (message.type === 'text' && isCardumenChatTrigger(message.text)) {
    await startCardumenChat(supabase, message.phone);
    return;
  }
  if (message.type === 'text' && isCardumenFlowTrigger(message.text)) {
    await sendCardumenFlow(message.phone);
    return;
  }
  if (message.type === 'text' && isCardumenTrigger(message.text)) {
    await sendCardumenLink(message.phone);
    return;
  }
  if (message.type === 'text' && isTurismoTrigger(message.text)) {
    await sendTurismoLink(message.phone);
    return;
  }

  // 1. Identify user by phone number
  const user = await identifyUser(supabase, message.phone);
  if (!user) {
    await sendTextMessage(message.phone,
      'Hola, no reconozco este número todavía.\n\nSi aún no tienes cuenta, puedes crearla en metrikone.co. Si ya usas MéTRIK ONE, pídele a tu admin que registre este número en Configuración → Equipo.');
    return;
  }

  // 2. Check subscription (WhatsApp only for Pro+)
  if (!['active_pro_plus', 'trial'].includes(user.subscription_status)) {
    await sendTextMessage(message.phone,
      'El bot de WhatsApp está disponible en el plan Pro+. Puedes activarlo desde la app cuando quieras.');
    return;
  }

  // 3. Rate limit check (D97)
  const allowed = await checkInboundLimit(supabase, message.phone);
  if (!allowed) {
    await sendTextMessage(message.phone,
      'Vas muy rápido, dame un momento. Espera unos minutos y volvemos.');
    return;
  }

  // 3.5 Transcribe audio before any processing
  if (message.type === 'audio' && message.audio_id) {
    const result = await transcribeAudio(message.audio_id);
    if (!result.text) {
      if (result.error) console.error(`[wa-webhook] Audio transcription failed: ${result.error}`);
      await sendTextMessage(message.phone, 'No alcancé a entender el audio. ¿Lo puedes escribir?');
      return;
    }
    message.text = result.text;
    // Echo so user can verify what was understood
    await sendTextMessage(message.phone, `_${result.text}_`);
    console.log(`[wa-webhook] Audio transcribed: "${result.text.slice(0, 100)}"`);
  }

  // 4. Get or create session
  const session = await getOrCreateSession(supabase, message.phone, user.workspace_id);

  // 5. Check if user is responding to a multi-step flow
  if (isAwaitingResponse(session)) {
    // Log inbound (no parser telemetry — session response skips parseMessage)
    await logMessage(supabase, message.phone, 'inbound', user.workspace_id, undefined, message.text);
    await handleSessionResponse(supabase, user, message, session);
    return;
  }

  // 6. Parse message with Gemini (phone as bucket key for A/B canary)
  //    Inject last_context so Gemini can resolve anaphora ("ese", "el primero", "ahí")
  const parsed = await parseMessage(
    message.text,
    message.phone,
    session.context?.last_context,
  );
  const parseTelemetry = getLastParseTelemetry();
  console.log(`[wa-webhook] Intent: ${parsed.intent} (${parsed.confidence}) via ${parseTelemetry.parser_source}${parseTelemetry.gemini_model ? ` [${parseTelemetry.gemini_model}]` : ''} for ${message.phone}`);

  // Log inbound with full parser telemetry
  await logMessage(
    supabase,
    message.phone,
    'inbound',
    user.workspace_id,
    parsed.intent,
    message.text,
    parseTelemetry,
  );

  // 7. Check role-based permissions (D99)
  // owner + admin have full access — no restriction
  const restrictedRoles: Record<string, Intent[]> = {
    operator: OPERATOR_ALLOWED_INTENTS,
    supervisor: OPERATOR_ALLOWED_INTENTS,
    contador: CONTADOR_ALLOWED_INTENTS,
    read_only: READ_ONLY_ALLOWED_INTENTS,
  };
  const allowedIntents = restrictedRoles[user.role];
  if (allowedIntents && !allowedIntents.includes(parsed.intent)) {
    if (user.role === 'contador') {
      await sendTextMessage(message.phone,
        'Tu rol es de consulta. Para registrar movimientos pídele apoyo a tu admin.');
    } else if (user.role === 'read_only') {
      await sendTextMessage(message.phone,
        'Tu rol es de solo lectura. Avísale a tu admin si necesitas hacer cambios.');
    } else {
      await sendTextMessage(message.phone,
        'Con tu rol solo puedes registrar gastos y actividades de tus negocios.');
    }
    return;
  }

  // 8. Inject original message text into parsed fields as metadata
  parsed.fields.mensaje_original = message.text;

  // 9. Build handler context
  const ctx: HandlerContext = {
    user,
    message,
    session,
    parsed,
    supabase,
    sendMessage: (text: string) => sendTextMessage(message.phone, text),
    sendOptions: (body: string, options: string[]) => {
      const numbered = options.map((opt, i) => `${i + 1}️⃣ ${opt}`).join('\n');
      return sendTextMessage(message.phone, `${body}\n\n${numbered}\n\nResponde con el número.`);
    },
    sendButtons: (body: string, btns: Array<{ id: string; title: string }>) => sendButtons(message.phone, body, btns),
    updateSession: async (state, context) => {
      await updateSession(supabase, session.id, state, context);
      // Sync in-memory session so subsequent reads see updated data
      (session as any).state = state;
      if (context) {
        (session as any).context = { ...(session as any).context, ...context };
      }
    },
  };

  // 9. Route to handler
  await routeToHandler(ctx);
}

// ============================================================
// Cardumen — disparador de estudio conversacional (SenseMaker)
// ============================================================

// Palabras clave que abren el cuestionario Cardumen. Coincidencia exacta (normalizada),
// para no chocar con los flujos de ONE. Ajustable sin tocar la lógica.
const CARDUMEN_KEYWORDS = ['cardumen'];
const CARDUMEN_APP_URL = 'https://cardumen-app-delta.vercel.app';
const CARDUMEN_ESTUDIO = 'fede';

function isCardumenTrigger(text: string): boolean {
  const t = (text || '').trim().toLowerCase().replace(/[!¡.,]/g, '');
  return CARDUMEN_KEYWORDS.includes(t);
}

// --- Variante Flow (in-chat, sin navegador) ---
const CARDUMEN_FLOW_KEYWORDS = ['cardumenflow', 'cardumen flow'];
function isCardumenFlowTrigger(text: string): boolean {
  const t = (text || '').trim().toLowerCase().replace(/[!¡.,]/g, '');
  return CARDUMEN_FLOW_KEYWORDS.includes(t);
}

async function sendCardumenFlow(phone: string): Promise<void> {
  const flowId = Deno.env.get('CARDUMEN_FLOW_ID');
  if (!flowId) {
    await sendTextMessage(phone, 'El cuestionario por Flow todavía no está publicado. Vuelve a intentar en un momento.');
    console.warn('[wa-webhook] CARDUMEN_FLOW_ID no configurado');
    return;
  }
  const mode = (Deno.env.get('CARDUMEN_FLOW_MODE') as 'draft' | 'published') || 'published';
  // flow_token = número del participante → liga la respuesta a esta conversación.
  await sendFlow(
    phone,
    '🐟 *Cardumen*\n\nGracias por sumar tu historia. Toca el botón para responder — todo ocurre aquí dentro de WhatsApp y es confidencial.',
    'Responder',
    flowId,
    `wa:${phone}`,
    'CONSENT',
    mode,
  );
  console.log(`[wa-webhook] Cardumen Flow (${mode}) enviado a ${phone}`);
}

async function storeCardumenFlowResponse(
  supabase: ReturnType<typeof getServiceClient>,
  phone: string,
  responseJson: string,
): Promise<void> {
  let data: Record<string, unknown> = {};
  try { data = responseJson ? JSON.parse(responseJson) : {}; } catch { /* deja vacío */ }
  // Guardamos el payload crudo del Flow; el mapeo fino al schema FEDE (regiones→percentX/Y) lo hace el pipeline.
  const payload = { source: 'flow', collection_mode: 'event_live', raw: data };
  const { error } = await supabase.from('cardumen_respuestas').insert({
    estudio: Deno.env.get('CARDUMEN_ESTUDIO') || 'fede',
    token: phone,
    lang: 'es',
    payload,
  });
  if (error) console.error('[wa-webhook] Error guardando respuesta Flow:', error.message);
}

// --- Estudio Turismo / La Araucanía (mini-web) ---
const TURISMO_KEYWORDS = ['turismo', 'araucania', 'araucanía'];
function isTurismoTrigger(text: string): boolean {
  const t = (text || '').trim().toLowerCase().replace(/[!¡.,]/g, '');
  return TURISMO_KEYWORDS.includes(t);
}
async function sendTurismoLink(phone: string): Promise<void> {
  const token = encodeURIComponent(phone);
  const url = `${CARDUMEN_APP_URL}/turismo.html?token=${token}&estudio=turismo`;
  await sendCtaUrl(
    phone,
    '🐟 *La Araucanía*\n\nGracias por sumar tu historia sobre hacer negocios en la región. Toca el botón para compartirla — toma unos minutos y es confidencial.',
    'Compartir historia',
    url,
  );
  console.log(`[wa-webhook] Turismo link enviado a ${phone}`);
}

async function sendCardumenLink(phone: string): Promise<void> {
  // token = número del participante → liga el envío del formulario a esta conversación.
  const token = encodeURIComponent(phone);
  const url = `${CARDUMEN_APP_URL}/?token=${token}&estudio=${CARDUMEN_ESTUDIO}`;
  // Botón CTA → abre el In-App Browser (sin salir de WhatsApp) en números habilitados.
  // Un link de texto plano abriría el navegador externo.
  await sendCtaUrl(
    phone,
    '🐟 *Cardumen*\n\nGracias por sumar tu historia. Toca el botón para compartirla — toma pocos minutos y es confidencial.',
    'Abrir cuestionario',
    url,
  );
  console.log(`[wa-webhook] Cardumen CTA enviado a ${phone}`);
}

// ============================================================
// Handler Routing
// ============================================================

async function routeToHandler(ctx: HandlerContext): Promise<void> {
  const { intent } = ctx.parsed;

  switch (intent) {
    // Registro
    case 'GASTO':
    case 'CONTACTO_NUEVO':
      await handleRegistro(ctx);
      break;

    // Actividad (log a activity_log de un negocio)
    case 'ACTIVIDAD':
      await handleActividad(ctx);
      break;

    // Consulta
    case 'ESTADO_NEGOCIOS':
    case 'MIS_NUMEROS':
    case 'CARTERA':
      await handleConsulta(ctx);
      break;

    // Utilitarios
    case 'AYUDA':
      await handleAyuda(ctx);
      break;

    case 'UNCLEAR':
    default:
      await handleUnclear({ ...ctx, parsed: { ...ctx.parsed, intent: 'UNCLEAR' } });
  }
}

// ============================================================
// Multi-step Session Response Handler
// ============================================================

async function handleSessionResponse(
  supabase: ReturnType<typeof getServiceClient>,
  user: WaUser,
  message: IncomingMessage,
  session: ReturnType<typeof getOrCreateSession> extends Promise<infer T> ? T : never,
): Promise<void> {
  const ctx: HandlerContext = {
    user,
    message,
    session: session as any,
    parsed: { intent: (session as any).context?.intent || 'UNCLEAR', confidence: 1, fields: {} },
    supabase,
    sendMessage: (text: string) => sendTextMessage(message.phone, text),
    sendOptions: (body: string, options: string[]) => {
      const numbered = options.map((opt, i) => `${i + 1}️⃣ ${opt}`).join('\n');
      return sendTextMessage(message.phone, `${body}\n\n${numbered}\n\nResponde con el número.`);
    },
    sendButtons: (body: string, btns: Array<{ id: string; title: string }>) => sendButtons(message.phone, body, btns),
    updateSession: async (state, context) => {
      await updateSession(supabase, (session as any).id, state, context);
      (session as any).state = state;
      if (context) {
        (session as any).context = { ...(session as any).context, ...context };
      }
    },
  };

  const pendingAction = (session as any).context?.pending_action;

  // Route to the appropriate handler based on pending action
  if (['W01', 'W06'].includes(pendingAction)) {
    await handleRegistro(ctx);
  } else if (pendingAction === 'WAC') {
    await handleActividad(ctx);
  } else if (pendingAction === 'WUC') {
    await handleUnclearResume(ctx);
  } else if (['W14', 'W15', 'W16', 'W17', 'W19'].includes(pendingAction)) {
    await handleConsulta(ctx);
  } else {
    // Unknown state — ask user to start over
    await sendTextMessage(message.phone, 'Perdí el hilo. Cuéntame de nuevo qué necesitas.');
    await updateSession(supabase, (session as any).id, 'completed');
  }
}

// ============================================================
// User Identification
// ============================================================

async function identifyUser(
  supabase: ReturnType<typeof getServiceClient>,
  phone: string,
): Promise<WaUser | null> {
  // Normalize phone (remove +, spaces, etc.)
  const normalized = phone.replace(/[\s+\-()]/g, '');

  // 1. Check if phone belongs to a workspace owner (via RPC — strips non-digits for matching)
  const { data: staffRows } = await supabase.rpc('wa_identify_user', { p_phone: normalized });
  const staffMatch = staffRows?.[0];

  if (staffMatch) {
    // Get workspace subscription info
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('subscription_status')
      .eq('id', staffMatch.workspace_id)
      .single();

    // Map the profile role from the DB: owner, admin, operator, supervisor, contador, read_only
    // wa_identify_user RPC returns es_principal (bool) and optionally role
    let role: import('../_shared/types.ts').UserRole = 'operator';
    if (staffMatch.es_principal) {
      role = 'owner';
    } else if (staffMatch.role) {
      // Trust the role from the profiles table if RPC returns it
      const validRoles = ['owner', 'admin', 'operator', 'supervisor', 'contador', 'read_only'];
      role = validRoles.includes(staffMatch.role) ? staffMatch.role : 'operator';
    }

    return {
      workspace_id: staffMatch.workspace_id,
      phone: normalized,
      name: staffMatch.full_name,
      role,
      user_id: staffMatch.user_id || undefined,
      subscription_status: workspace?.subscription_status || 'trial',
    };
  }

  // 2. Check if phone belongs to a WA collaborator (also flexible matching)
  const { data: collabMatch } = await supabase
    .from('wa_collaborators')
    .select('id, workspace_id, name, phone, role')
    .or(`phone.eq.${normalized},phone.eq.+${normalized}`)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (collabMatch) {
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('subscription_status')
      .eq('id', collabMatch.workspace_id)
      .single();

    // Map collaborator role — wa_collaborators may have a 'role' column
    const validRoles = ['owner', 'admin', 'operator', 'supervisor', 'contador', 'read_only'];
    const collabRole: import('../_shared/types.ts').UserRole =
      collabMatch.role && validRoles.includes(collabMatch.role) ? collabMatch.role : 'operator';

    return {
      workspace_id: collabMatch.workspace_id,
      phone: normalized,
      name: collabMatch.name,
      role: collabRole,
      collaborator_id: collabMatch.id,
      subscription_status: workspace?.subscription_status || 'trial',
    };
  }

  return null;
}

// ============================================================
// Meta Webhook Helpers
// ============================================================

function extractMessage(payload: any): IncomingMessage | null {
  try {
    const entry = payload?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages?.[0]) return null;

    // Ignore messages sent to other phone numbers (e.g. Mi Bolsillo)
    const receivedPhoneNumberId = value?.metadata?.phone_number_id;
    const ownPhoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    if (ownPhoneNumberId && receivedPhoneNumberId && receivedPhoneNumberId !== ownPhoneNumberId) {
      console.log(`[wa-webhook] Ignoring message for phone_number_id ${receivedPhoneNumberId} (not ours: ${ownPhoneNumberId})`);
      return null;
    }

    const msg = value.messages[0];
    const phone = msg.from;

    if (msg.type === 'text') {
      return {
        phone,
        text: msg.text.body,
        type: 'text',
        timestamp: msg.timestamp,
      };
    }

    if (msg.type === 'image') {
      return {
        phone,
        text: msg.image?.caption || '',
        type: 'image',
        image_id: msg.image?.id,
        timestamp: msg.timestamp,
      };
    }

    if (msg.type === 'audio') {
      return {
        phone,
        text: '',
        type: 'audio',
        audio_id: msg.audio?.id,
        timestamp: msg.timestamp,
      };
    }

    if (msg.type === 'interactive') {
      // Flow completado → llega como nfm_reply con response_json (datos del cuestionario Cardumen).
      if (msg.interactive?.type === 'nfm_reply' || msg.interactive?.nfm_reply) {
        return {
          phone,
          text: '',
          type: 'flow_response',
          flow_response: msg.interactive?.nfm_reply?.response_json || '',
          timestamp: msg.timestamp,
        };
      }
      const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
      return {
        phone,
        text: reply?.title || reply?.id || '',
        type: 'interactive',
        interactive_reply: reply?.id,
        timestamp: msg.timestamp,
      };
    }

    // Unsupported message type
    return null;
  } catch {
    return null;
  }
}

async function verifySignature(body: string, signature: string | null): Promise<boolean> {
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET');
  if (!appSecret) {
    // In production, missing secret is a security error — reject the request
    const isProduction = !!Deno.env.get('DENO_DEPLOYMENT_ID') || Deno.env.get('NODE_ENV') === 'production';
    if (isProduction) {
      console.error('[wa-webhook] WHATSAPP_APP_SECRET not set in production — rejecting request');
      return false;
    }
    // In local dev, allow without verification (for testing)
    console.warn('[wa-webhook] WHATSAPP_APP_SECRET not set — skipping verification (dev only)');
    return true;
  }
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const computed = 'sha256=' + Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return computed === signature;
}
