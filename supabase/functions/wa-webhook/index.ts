// ============================================================
// wa-webhook — Main WhatsApp Webhook (Spec 98F §1)
// Receives Meta webhook, identifies user, parses intent, routes
// ============================================================

import { getServiceClient } from '../_shared/supabase-client.ts';
import { parseMessage, getLastParseTelemetry } from '../_shared/wa-parse.ts';
import { transcribeAudio } from '../_shared/wa-transcribe.ts';
import { sendTextMessage, sendButtons, sendCtaUrl, sendFlow, enBackground } from '../_shared/wa-respond.ts';
import { getOrCreateSession, isAwaitingResponse, updateSession } from '../_shared/wa-session.ts';
import { resolverEstudioChat, hasOpenCardumenChat, startCardumenChat, continueCardumenChat } from '../_shared/cardumen/index.ts';
import { isVeTrigger, hasOpenVeChat, startVeChat, continueVeChat } from '../_shared/venezuela/index.ts';
import { resolverCustomerTrigger, hasOpenCustomerChat, startCustomerChat, continueCustomerChat } from '../_shared/customer/index.ts';
import { checkInboundLimit, logMessage } from '../_shared/wa-rate-limit.ts';
import { enviarAvisoInterno } from '../_shared/wa-alerta.ts';
import { aplicarStatuses } from '../_shared/wa-envios.ts';
import type { StatusEntrega } from '../_shared/wa-envios.ts';
import { handleRegistro } from '../_shared/handlers/registro/index.ts';
import { handleConsulta } from '../_shared/handlers/consulta.ts';
import { handleActividad } from '../_shared/handlers/actividad.ts';
import { handleAyuda, handleUnclear, handleUnclearResume } from '../_shared/handlers/ayuda.ts';
import type { BotSession, HandlerContext, IncomingMessage, Intent, WaUser } from '../_shared/types.ts';
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

      // Acuses de entrega. Van primero y no compiten con los mensajes: un webhook trae
      // `messages` o `statuses`, nunca los dos. Antes caian en el `return 200` de abajo
      // y se perdian, que es la razon de que no se supiera si un contrato llego.
      const statuses = extractStatuses(payload);
      if (statuses.length > 0) {
        // `enBackground` y no un `.catch` suelto: sin `waitUntil` el worker puede
        // reciclarse a mitad y el acuse se pierde, que es justo lo que paso con
        // meta-leads-webhook (18 de 153 leads). Un acuse perdido devuelve el agujero.
        enBackground(
          procesarStatuses(statuses).catch((err) =>
            console.error('[wa-webhook] Status error:', err)
          ),
        );
        return new Response('OK', { status: 200 });
      }

      // Extract message from Meta webhook format
      const message = extractMessage(payload);
      if (!message) {
        return new Response('OK', { status: 200 }); // Otros eventos (plantillas, cuenta, etc.)
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
// Numeros que no reconocemos
// ============================================================

/** Marca con la que estas conversaciones quedan buscables en `wa_message_log`. */
const INTENT_DESCONOCIDO = 'numero_desconocido';

/**
 * Alguien que no esta registrado le escribio al bot.
 *
 * Antes solo se le contestaba "no te reconozco" y ahi moria: el mensaje no se guardaba y
 * nadie se enteraba. Si un cliente responde por WhatsApp a un contrato o a un cobro, cae
 * justo por aca, y su respuesta se perdia.
 *
 * Dos cosas, en este orden: queda registrado SIEMPRE, y se avisa a quien pueda contestar.
 */
async function atenderDesconocido(
  supabase: ReturnType<typeof getServiceClient>,
  message: IncomingMessage,
): Promise<void> {
  const preview = (message.text || '').trim() || `[${message.type}]`;

  // Se decide ANTES de insertar: si se consulta despues, la fila recien escrita apaga
  // su propio aviso y no se notifica nunca.
  const avisar = !(await avisoReciente(supabase, message.phone));

  await logMessage(supabase, message.phone, 'inbound', undefined, INTENT_DESCONOCIDO, preview);

  await sendTextMessage(message.phone,
    'Hola, no reconozco este número todavía.\n\nSi aún no tienes cuenta, puedes crearla en metrikone.co. Si ya usas MéTRIK ONE, pídele a tu admin que registre este número en Configuración → Equipo.');

  if (!avisar) return;

  const admin = (Deno.env.get('WA_ADMIN_NOTIFY_PHONE') || '').replace(/\D/g, '');
  if (!admin) {
    console.warn(`[wa-webhook] ${message.phone} no reconocido y sin avisar: falta WA_ADMIN_NOTIFY_PHONE`);
    return;
  }

  // Pasa por el resolvedor de plantillas: si `WA_ALERT_TEMPLATES` declara una para este
  // intent, sale como plantilla y llega con la ventana de 24 h cerrada. Si no, sale como
  // texto libre — o sea como hoy — y Meta lo entrega solo si el admin le escribio al bot
  // en las ultimas 24 h. El rechazo (131047) queda en `wa_envios` con su codigo.
  //
  // Ojo con la ventana de quien: la abre el ADMIN al escribirle al bot, no el desconocido
  // que disparo el aviso. Que el desconocido acabe de escribir no habilita nada aqui.
  await enviarAvisoInterno(
    admin,
    INTENT_DESCONOCIDO,
    `📵 Un número no registrado le escribió al bot.\n\nDe: +${message.phone}\nDice: ${preview.slice(0, 200)}\n\nNo hay a quién enrutarlo. Si es un cliente, contéstale desde tu WhatsApp.`,
    { telefono: `+${message.phone}`, mensaje: preview.slice(0, 200) },
  );
}

/** True si a este numero ya se le abrio un aviso en las ultimas 24h. Evita que un spammer
 *  con veinte mensajes se convierta en veinte notificaciones. */
async function avisoReciente(
  supabase: ReturnType<typeof getServiceClient>,
  phone: string,
): Promise<boolean> {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('wa_message_log')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('intent', INTENT_DESCONOCIDO)
    .gte('created_at', desde);

  // Si la consulta falla se avisa igual: perder un aviso es peor que repetirlo.
  if (error) {
    console.error('[wa-webhook] no se pudo revisar el aviso previo:', error.message);
    return false;
  }
  return (count ?? 0) > 0;
}

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

  // 0a-ve. Voz de Venezuela — AISLAMIENTO TOTAL (mismo patron que CardumenChat). Si hay una conversacion
  //     de escucha ABIERTA para este telefono, TODO mensaje (texto o audio) va al motor Gemini de escucha
  //     y retorna ANTES de cualquier logica de ONE. Estudio aparte: estado en ve_chat_sessions.
  if (await hasOpenVeChat(supabase, message.phone)) {
    let texto = message.text || '';
    if (message.type === 'audio' && message.audio_id) {
      const result = await transcribeAudio(message.audio_id);
      if (!result.text) {
        await sendTextMessage(message.phone, 'No alcancé a entender el audio. ¿Me lo puedes escribir o repetir?');
        return;
      }
      texto = result.text;
    }
    if (message.type === 'location' && message.location) {
      const loc = message.location;
      const etiqueta = loc.name || loc.address;
      const textoUbic = etiqueta ? `(Comparto mi ubicación: ${etiqueta})` : '(Comparto mi ubicación actual por WhatsApp.)';
      await continueVeChat(supabase, message.phone, textoUbic, message.wa_message_id, loc);
      return;
    }
    if (!texto.trim()) {
      await sendTextMessage(message.phone, 'Por ahora respóndeme con un mensaje de texto o de voz, por favor.');
      return;
    }
    await continueVeChat(supabase, message.phone, texto, message.wa_message_id);
    return;
  }
  // 0a-ve trigger. Palabra clave publica "venezuela" abre la conversacion de escucha (solo si no hay una abierta).
  if (message.type === 'text' && isVeTrigger(message.text)) {
    await startVeChat(supabase, message.phone, message.wa_message_id, message.bot_phone);
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
    await continueCardumenChat(supabase, message.phone, texto, message.wa_message_id);
    return;
  }

  // 0c. Cardumen — disparadores PÚBLICOS por palabra clave (solo si NO hay conversacion abierta).
  //     El usuario escribió la palabra → ventana de servicio 24h (mensaje gratis).
  //     La palabra resuelve QUE estudio se abre (catálogo `cardumen_estudio_triggers`), así que
  //     varios estudios conviven. Si no resuelve ninguno, cae a la palabra fija de siempre.
  if (message.type === 'text') {
    const estudioChat = await resolverEstudioChat(supabase, message.text);
    if (estudioChat) {
      await startCardumenChat(supabase, message.phone, estudioChat, message.wa_message_id);
      return;
    }
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

  // 0d. Customer service — AISLAMIENTO TOTAL, mismo patron que Cardumen y Venezuela.
  //     Quien escribe aqui NO es del equipo: es un cliente final de un cliente nuestro.
  //     Por eso va ANTES de identificar staff — si cayera despues, el numero de una
  //     persona desconocida entraria al flujo de gastos/intents de ONE.
  //     OPT-IN: solo responde a workspaces con config_extra.wa_customer_bot.
  if (await hasOpenCustomerChat(supabase, message.phone)) {
    let texto = message.text || '';
    if (message.type === 'audio' && message.audio_id) {
      const result = await transcribeAudio(message.audio_id);
      if (!result.text) {
        await sendTextMessage(message.phone, 'No alcancé a entender el audio. ¿Me lo puedes escribir?');
        return;
      }
      texto = result.text;
    }
    if (!texto.trim()) {
      await sendTextMessage(message.phone, 'Por ahora respóndeme con un mensaje de texto o de voz, por favor.');
      return;
    }
    await continueCustomerChat(supabase, message.phone, texto, message.wa_message_id);
    return;
  }

  // 0e. Customer service — disparador por palabra clave (solo si NO hay conversacion abierta).
  //     El disparador lo define cada workspace en su config; se resuelve contra la base.
  if (message.type === 'text' && message.text) {
    const cs = await resolverCustomerTrigger(supabase, message.text);
    if (cs) {
      await startCustomerChat(supabase, message.phone, cs.workspaceId, cs.config, message.wa_message_id);
      return;
    }
  }

  // 1. Identify user by phone number
  const user = await identifyUser(supabase, message.phone);
  if (!user) {
    await atenderDesconocido(supabase, message);
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
      session.state = state;
      if (context) {
        session.context = { ...session.context, ...context };
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
  session: BotSession,
): Promise<void> {
  const ctx: HandlerContext = {
    user,
    message,
    session,
    parsed: { intent: session.context?.intent || 'UNCLEAR', confidence: 1, fields: {} },
    supabase,
    sendMessage: (text: string) => sendTextMessage(message.phone, text),
    sendOptions: (body: string, options: string[]) => {
      const numbered = options.map((opt, i) => `${i + 1}️⃣ ${opt}`).join('\n');
      return sendTextMessage(message.phone, `${body}\n\n${numbered}\n\nResponde con el número.`);
    },
    sendButtons: (body: string, btns: Array<{ id: string; title: string }>) => sendButtons(message.phone, body, btns),
    updateSession: async (state, context) => {
      await updateSession(supabase, session.id, state, context);
      session.state = state;
      if (context) {
        session.context = { ...session.context, ...context };
      }
    },
  };

  const pendingAction = session.context?.pending_action ?? '';

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
    await updateSession(supabase, session.id, 'completed');
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

// Forma del webhook de Meta, limitada a lo que extractMessage lee. Los campos
// base (from/id/timestamp/type) van obligatorios porque el codigo ya los asume;
// lo que depende del tipo de mensaje va opcional y se lee con `?.`.
type MetaMensaje = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id?: string; caption?: string };
  audio?: { id?: string };
  interactive?: {
    type?: string;
    nfm_reply?: { response_json?: string };
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
};

// Acuse de entrega de un mensaje que MeTRIK mando. Llega por el mismo webhook que los
// mensajes entrantes, en `value.statuses` en vez de `value.messages`.
type MetaStatus = {
  id?: string;            // wamid del mensaje NUESTRO al que se refiere
  status?: string;        // sent | delivered | read | failed
  timestamp?: string;     // epoch en segundos, como string
  recipient_id?: string;  // telefono del destinatario
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

type MetaWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        messages?: MetaMensaje[];
        statuses?: MetaStatus[];
      };
    }>;
  }>;
};

/** Los unicos que la tabla `wa_envios` acepta. Ver el CHECK de la migracion 20260901000003. */
const STATUS_CONOCIDOS = ['sent', 'delivered', 'read', 'failed'];

/**
 * Saca los acuses de entrega del payload.
 *
 * Recorre TODAS las entries y changes, no solo la primera: Meta agrupa varios acuses en
 * un mismo webhook cuando salieron varios mensajes seguidos (un texto largo se parte en
 * chunks y cada chunk trae el suyo). Quedarse con `[0]`, como hace `extractMessage` para
 * los mensajes entrantes, perderia el resto en silencio.
 */
function extractStatuses(payload: MetaWebhookPayload): StatusEntrega[] {
  const salida: StatusEntrega[] = [];
  const propio = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  try {
    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        if (!value?.statuses?.length) continue;

        // Mismo criterio que extractMessage: lo que sea de otro numero (Mi Bolsillo) no es nuestro.
        const recibido = value?.metadata?.phone_number_id;
        if (propio && recibido && recibido !== propio) continue;

        for (const st of value.statuses) {
          if (!st?.id || !st?.status) continue;
          // La tabla acota los estados con un CHECK. Un valor que Meta agregue manana
          // haria fallar el insert entero, asi que aqui se filtra y se deja dicho en el
          // log: mejor un acuse que no se entiende visible, que un error de constraint.
          if (!STATUS_CONOCIDOS.includes(st.status)) {
            console.warn(`[wa-webhook] status desconocido de Meta: ${st.status} (${st.id})`);
            continue;
          }
          const err = st.errors?.[0];
          salida.push({
            waMessageId: st.id,
            status: st.status,
            statusAt: st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : undefined,
            phone: st.recipient_id,
            errorCode: err?.code,
            errorTitle: err?.title ?? err?.message,
          });
        }
      }
    }
  } catch (err) {
    console.error('[wa-webhook] no se pudieron leer los statuses:', err);
  }
  return salida;
}

async function procesarStatuses(statuses: StatusEntrega[]): Promise<void> {
  await aplicarStatuses(getServiceClient(), statuses);
}

function extractMessage(payload: MetaWebhookPayload): IncomingMessage | null {
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
    const botPhone = value?.metadata?.display_phone_number; // numero del bot (para compartir su contacto)

    if (msg.type === 'text' && msg.text) {
      return {
        phone,
        text: msg.text.body,
        type: 'text',
        wa_message_id: msg.id,
        bot_phone: botPhone,
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
        wa_message_id: msg.id,
        bot_phone: botPhone,
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

    if (msg.type === 'location' && msg.location) {
      return {
        phone,
        text: '',
        type: 'location',
        location: {
          latitude: msg.location.latitude,
          longitude: msg.location.longitude,
          name: msg.location.name,
          address: msg.location.address,
        },
        wa_message_id: msg.id,
        bot_phone: botPhone,
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
