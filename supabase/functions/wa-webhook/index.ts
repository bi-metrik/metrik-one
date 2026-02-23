// ============================================================
// wa-webhook — Main WhatsApp Webhook (Spec 98F §1)
// Receives Meta webhook, identifies user, parses intent, routes
// ============================================================

import { getServiceClient } from '../_shared/supabase-client.ts';
import { parseMessage } from '../_shared/wa-parse.ts';
import { sendTextMessage } from '../_shared/wa-respond.ts';
import { getOrCreateSession, isAwaitingResponse, updateSession } from '../_shared/wa-session.ts';
import { checkInboundLimit, logMessage } from '../_shared/wa-rate-limit.ts';
import { handleRegistro } from '../_shared/handlers/registro.ts';
import { handleAccion } from '../_shared/handlers/accion.ts';
import { handleConsulta } from '../_shared/handlers/consulta.ts';
import { handleNovedad } from '../_shared/handlers/novedad.ts';
import type { HandlerContext, IncomingMessage, Intent, WaUser, COLLABORATOR_ALLOWED_INTENTS as _ } from '../_shared/types.ts';
import { COLLABORATOR_ALLOWED_INTENTS } from '../_shared/types.ts';

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

  // 1. Identify user by phone number
  const user = await identifyUser(supabase, message.phone);
  if (!user) {
    await sendTextMessage(message.phone,
      '❌ No te tengo registrado. Pídele a tu jefe que te agregue en la app.');
    return;
  }

  // 2. Check subscription (WhatsApp only for Pro+)
  if (!['active_pro_plus', 'trial'].includes(user.subscription_status)) {
    await sendTextMessage(message.phone,
      '⚠️ WhatsApp Bot solo está disponible en el plan Pro+. Actualiza tu plan en la app.');
    return;
  }

  // 3. Rate limit check (D97)
  const allowed = await checkInboundLimit(supabase, message.phone);
  if (!allowed) {
    await sendTextMessage(message.phone,
      '⚠️ Has enviado muchos mensajes. Espera unos minutos o usa la app.');
    return;
  }

  // Log inbound message
  await logMessage(supabase, message.phone, 'inbound', user.workspace_id, undefined, message.text);

  // 4. Get or create session
  const session = await getOrCreateSession(supabase, message.phone, user.workspace_id);

  // 5. Check if user is responding to a multi-step flow
  if (isAwaitingResponse(session)) {
    await handleSessionResponse(supabase, user, message, session);
    return;
  }

  // 6. Parse message with Gemini
  const parsed = await parseMessage(message.text);
  console.log(`[wa-webhook] Intent: ${parsed.intent} (${parsed.confidence}) for ${message.phone}`);

  // 7. Check collaborator permissions (D99)
  if (user.role === 'collaborator' && !COLLABORATOR_ALLOWED_INTENTS.includes(parsed.intent)) {
    // Special message for collaborators trying manual HORAS
    if (parsed.intent === 'HORAS') {
      await sendTextMessage(message.phone,
        '⏱️ Las horas se registran con el timer.\n\nEscribe *iniciar en [proyecto]* para empezar y *parar* cuando termines.');
    } else {
      await sendTextMessage(message.phone,
        '❌ No tienes permiso para esta acción. Solo puedes registrar gastos, iniciar timer y notas de tus proyectos.');
    }
    return;
  }

  // 8. Build handler context
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
    updateSession: (state, context) => updateSession(supabase, session.id, state, context),
  };

  // 9. Route to handler
  await routeToHandler(ctx);
}

// ============================================================
// Handler Routing
// ============================================================

async function routeToHandler(ctx: HandlerContext): Promise<void> {
  const { intent } = ctx.parsed;

  switch (intent) {
    // Registro
    case 'GASTO_DIRECTO':
    case 'GASTO_OPERATIVO':
    case 'HORAS':
    case 'TIMER_INICIAR':
    case 'TIMER_PARAR':
    case 'TIMER_ESTADO':
    case 'COBRO':
    case 'CONTACTO_NUEVO':
    case 'SALDO_BANCARIO':
      await handleRegistro(ctx);
      break;

    // Acción
    case 'OPP_GANADA':
    case 'OPP_PERDIDA':
    case 'AYUDA':
    case 'UNCLEAR':
      await handleAccion(ctx);
      break;

    // Consulta
    case 'ESTADO_PROYECTO':
    case 'ESTADO_PIPELINE':
    case 'MIS_NUMEROS':
    case 'CARTERA':
    case 'INFO_CONTACTO':
      await handleConsulta(ctx);
      break;

    // Novedad
    case 'NOTA_OPORTUNIDAD':
    case 'NOTA_PROYECTO':
      await handleNovedad(ctx);
      break;

    default:
      await handleAccion({ ...ctx, parsed: { ...ctx.parsed, intent: 'UNCLEAR' } });
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
    updateSession: (state, context) => updateSession(supabase, (session as any).id, state, context),
  };

  const pendingAction = (session as any).context?.pending_action;

  // Route to the appropriate handler based on pending action
  if (['W01', 'W02', 'W03', 'W03T', 'W04', 'W06', 'W32'].includes(pendingAction)) {
    await handleRegistro(ctx);
  } else if (['W22', 'W23', 'W24'].includes(pendingAction)) {
    await handleAccion(ctx);
  } else if (['W14', 'W15', 'W16', 'W17', 'W19'].includes(pendingAction)) {
    await handleConsulta(ctx);
  } else if (['W09', 'W11'].includes(pendingAction)) {
    await handleNovedad(ctx);
  } else {
    // Unknown state — ask user to start over
    await sendTextMessage(message.phone, 'Parece que algo se perdió. Escríbeme de nuevo qué necesitas.');
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

    return {
      workspace_id: staffMatch.workspace_id,
      phone: normalized,
      name: staffMatch.full_name,
      role: staffMatch.es_principal ? 'owner' : 'collaborator',
      subscription_status: workspace?.subscription_status || 'trial',
    };
  }

  // 2. Check if phone belongs to a WA collaborator (also flexible matching)
  const { data: collabMatch } = await supabase
    .from('wa_collaborators')
    .select('id, workspace_id, name, phone')
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

    return {
      workspace_id: collabMatch.workspace_id,
      phone: normalized,
      name: collabMatch.name,
      role: 'collaborator',
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

    if (msg.type === 'interactive') {
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
    console.warn('[wa-webhook] WHATSAPP_APP_SECRET not set — skipping verification');
    return true; // Allow in dev
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
