// ============================================================
// wa-webhook — Main WhatsApp Webhook (Spec 98F §1)
// Receives Meta webhook, identifies user, parses intent, routes
// ============================================================

import { getServiceClient } from '../_shared/supabase-client.ts';
import { parseMessage, getLastParseTelemetry } from '../_shared/wa-parse.ts';
import { transcribeAudio } from '../_shared/wa-transcribe.ts';
import { sendTextMessage, sendTextMessageABsuid, sendButtons, enBackground } from '../_shared/wa-respond.ts';
import { extraerEntrante, extraerStatuses } from '../_shared/wa-webhook-payload.ts';
import { verificarFirmaMeta } from '../_shared/wa-firma.ts';
import type { MensajeSinTelefono } from '../_shared/wa-webhook-payload.ts';
import {
  INTENT_SIN_TELEFONO,
  avisoSinTelefono,
  decidirSinTelefono,
  previewSinTelefono,
  variablesAvisoSinTelefono,
} from '../_shared/wa-sin-telefono.ts';
import { INTENT_DESCONOCIDO, MENSAJE_DESCONOCIDO, responderDesconocido } from '../_shared/wa-desconocido.ts';
import { getOrCreateSession, isAwaitingResponse, updateSession } from '../_shared/wa-session.ts';
import { checkInboundLimit, logMessage } from '../_shared/wa-rate-limit.ts';
import { enviarAvisoInterno } from '../_shared/wa-alerta.ts';
import { aplicarStatuses } from '../_shared/wa-envios.ts';
import type { StatusEntrega } from '../_shared/wa-envios.ts';
import { handleRegistro } from '../_shared/handlers/registro/index.ts';
import { handleConsulta } from '../_shared/handlers/consulta.ts';
import { handleActividad } from '../_shared/handlers/actividad.ts';
import { handleAyuda, handleUnclear, handleUnclearResume } from '../_shared/handlers/ayuda.ts';
import { atenderBotonTerminos, atenderPendienteTerminos } from '../_shared/aceptacion-terminos-flujo.ts';
import { atenderAvisoDatos, cerrarAviso } from '../_shared/aviso-datos-bot-flujo.ts';
import { botEquipoPermitido, MENSAJE_BOT_SIN_CLARITY } from '../_shared/wa-modulos.ts';
import { contestarNoSoportado, textoNoSoportado } from '../_shared/wa-no-soportado.ts';
import { atenderEnBandeja, rutaDelMensaje } from '../_shared/wa-bandeja.ts';
import { confirmarRecordatorio } from '../_shared/wa-recordatorios.ts';
import { esConfirmacionDeRecordatorio } from '../_shared/wa-recordatorios-reglas.ts';
import { identificarRemitente } from '../_shared/wa-identificar.ts';
import { atenderEscrito } from '../_shared/wa-interprete.ts';
import { aLetraLatina } from '../_shared/texto-latino.ts';
import { primeraVezDelMensaje } from '../_shared/wa-mensaje-unico.ts';
import { completarTexto, registrarEntrante } from '../_shared/wa-conversacion.ts';
import { atenderConAgente, atenderConAgenteOne } from '../_shared/wa-agente.ts';
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
      // `await` obligatorio: sin el, la Promise es truthy y el chequeo no rechaza nada.
      if (!(await verifySignature(body, signature))) {
        console.error('[wa-webhook] Invalid signature');
        return new Response('Invalid signature', { status: 401 });
      }

      const payload = JSON.parse(body);

      const propioPhoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

      // Acuses de entrega. Van primero y no compiten con los mensajes: un webhook trae
      // `messages` o `statuses`, nunca los dos. Antes caian en el `return 200` de abajo
      // y se perdian, que es la razon de que no se supiera si un contrato llego.
      const statuses = extraerStatuses(payload, propioPhoneNumberId);
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
      const entrante = extraerEntrante(payload, propioPhoneNumberId);
      if (!entrante) {
        return new Response('OK', { status: 200 }); // Otros eventos (plantillas, cuenta, etc.)
      }

      // Sin telefono (la persona tiene nombre de usuario de WhatsApp): sale aqui, antes de
      // `processMessage`, porque todo lo que viene despues esta indexado por telefono. Antes
      // seguia con `phone` indefinido y reventaba en `identifyUser` sin contestar ni avisar.
      if (entrante.tipo === 'sin_telefono') {
        enBackground(
          atenderSinTelefono(getServiceClient(), entrante.mensaje).catch((err) =>
            console.error('[wa-webhook] Sin telefono error:', err)
          ),
        );
        return new Response('OK', { status: 200 });
      }
      const message = entrante.mensaje;

      // La confirmacion de un recordatorio: boton de respuesta rapida de una PLANTILLA, que
      // llega como `type: 'button'` con su payload. Sale aqui y NO pasa por `processMessage`:
      // no es una conversacion con el bot, no abre sesion y no depende de que el numero este
      // registrado en `staff`. Que el payload sea nuestro se decide sin tocar la base
      // (`esConfirmacionDeRecordatorio` es puro), asi que un boton ajeno sigue su camino.
      if (message.type === 'button' && esConfirmacionDeRecordatorio(message.interactive_reply)) {
        enBackground(
          confirmarRecordatorio(getServiceClient(), message.phone, message.interactive_reply)
            .then((r) => {
              if (!r.confirmado) {
                console.warn(`[wa-webhook] confirmacion de recordatorio sin efecto: ${r.motivo}`);
              }
            })
            .catch((err) => console.error('[wa-webhook] Recordatorio error:', err)),
        );
        return new Response('OK', { status: 200 });
      }

      // Un toque de boton puede ser la aceptacion de un documento, y un texto puede ser el «acepto»
      // escrito del aviso de datos del bot: se guarda el cuerpo tal cual llego y su firma, que es lo
      // unico que permite demostrar despues que lo mando Meta. Solo en memoria: no se guarda salvo
      // que sea esa respuesta.
      if (message.type === 'interactive' || message.type === 'text') {
        message.webhook_crudo = { cuerpo: body, firma: signature };
      }

      // Meta reenvía el MISMO mensaje si no recibió el 200 a tiempo: se procesa una sola vez
      // por `wa_message_id` (ver `_shared/wa-mensaje-unico.ts`).
      if (!(await primeraVezDelMensaje(getServiceClient(), message.wa_message_id))) {
        console.log(`[wa-webhook] ${message.wa_message_id} ya se proceso: reenvio de Meta, se ignora`);
        return new Response('OK', { status: 200 });
      }

      // Process async — respond 200 immediately (Meta expects < 20s).
      // `enBackground` (waitUntil) y no un `.catch` suelto: sin el, el worker puede reciclarse a
      // mitad y lo que faltaba se pierde sin que Meta reintente, porque ya recibio su 200. Es el
      // mismo motivo por el que los acuses de arriba ya van asi.
      enBackground(
        processMessage(message).catch((err) =>
          console.error('[wa-webhook] Process error:', err)
        ),
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

/**
 * Alguien que no esta registrado le escribio al bot.
 *
 * Decision de Mauricio (2026-10-29): por este numero solo habla quien esta registrado en ONE, y el
 * numero dice de que workspace es y con que rol habla. A quien no esta registrado no se le intenta
 * clasificar ni se avisa a nadie: una sola respuesta que lo manda a su administrador o al WhatsApp
 * de MeTRIK. El mensaje queda en `wa_message_log` siempre; la respuesta sale una vez cada 24 h por
 * numero, para que veinte mensajes no sean veinte respuestas.
 */
async function atenderDesconocido(
  supabase: ReturnType<typeof getServiceClient>,
  message: IncomingMessage,
): Promise<void> {
  const preview = (message.text || '').trim() || `[${message.type}]`;

  // Se cuenta ANTES de registrar: si no, la fila recien escrita apaga su propia respuesta.
  const responder = responderDesconocido(await contarDesconocidoRecientes(supabase, message.phone));

  await logMessage(supabase, message.phone, 'inbound', undefined, INTENT_DESCONOCIDO, preview);

  if (responder) await sendTextMessage(message.phone, MENSAJE_DESCONOCIDO);
}

/** Mensajes de este numero sin registrar en las ultimas 24 h. `null` si la consulta falla. */
async function contarDesconocidoRecientes(
  supabase: ReturnType<typeof getServiceClient>,
  phone: string,
): Promise<number | null> {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('wa_message_log')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('intent', INTENT_DESCONOCIDO)
    .gte('created_at', desde);

  if (error) {
    console.error('[wa-webhook] no se pudo contar los mensajes previos del numero desconocido:', error.message);
    return null;
  }
  return count ?? 0;
}

// ============================================================
// Remitentes sin telefono (nombre de usuario de WhatsApp)
// ============================================================

/**
 * Meta mando el mensaje con BSUID y sin telefono. Las decisiones y los textos viven en
 * `wa-sin-telefono.ts`; aqui solo se lee la bitacora, se envia y se avisa.
 *
 * Los tres pasos son independientes a proposito: que Meta rechace la respuesta por BSUID no
 * puede dejar a quien opera sin aviso, y un aviso fallido no puede borrar el registro.
 */
async function atenderSinTelefono(
  supabase: ReturnType<typeof getServiceClient>,
  m: MensajeSinTelefono,
): Promise<void> {
  // Se cuenta ANTES de registrar: si no, la fila recien escrita cuenta como mensaje previo.
  const decision = decidirSinTelefono(await contarSinTelefonoRecientes(supabase, m.user_id));
  console.warn(`[wa-webhook] mensaje sin telefono de ${m.user_id} (${m.username ? `@${m.username}` : 'sin usuario'}, ${m.tipo})`);

  // El BSUID va en `phone` (texto libre en la tabla): es la unica llave que se tiene y la que
  // sirve para contar los mensajes previos de esta misma persona.
  await logMessage(supabase, m.user_id, 'inbound', undefined, INTENT_SIN_TELEFONO, previewSinTelefono(m));

  try {
    await sendTextMessageABsuid(m.user_id, decision.mensaje, { origen: 'bot', intent: INTENT_SIN_TELEFONO });
  } catch (err) {
    console.error(`[wa-webhook] no se pudo responder al BSUID ${m.user_id}:`, err);
  }

  if (!decision.avisar) return;
  const admin = (Deno.env.get('WA_ADMIN_NOTIFY_PHONE') || '').replace(/\D/g, '');
  if (!admin) {
    console.warn(`[wa-webhook] ${m.user_id} sin telefono y sin avisar: falta WA_ADMIN_NOTIFY_PHONE`);
    return;
  }
  // Mismo canal y misma salvedad que `atenderDesconocido`: sin plantilla declarada sale como
  // texto libre y Meta solo lo entrega si el admin le escribio al bot en las ultimas 24 h.
  await enviarAvisoInterno(admin, INTENT_SIN_TELEFONO, avisoSinTelefono(m), variablesAvisoSinTelefono(m));
}

/** Mensajes de este BSUID en las ultimas 24 h. `null` si la consulta falla. */
async function contarSinTelefonoRecientes(
  supabase: ReturnType<typeof getServiceClient>,
  bsuid: string,
): Promise<number | null> {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('wa_message_log')
    .select('*', { count: 'exact', head: true })
    .eq('phone', bsuid)
    .eq('intent', INTENT_SIN_TELEFONO)
    .gte('created_at', desde);
  if (error) {
    console.error('[wa-webhook] no se pudo contar los mensajes previos sin telefono:', error.message);
    return null;
  }
  return count ?? 0;
}

// ============================================================
// Core Processing Pipeline
// ============================================================

async function processMessage(message: IncomingMessage): Promise<void> {
  const supabase = getServiceClient();

  // 0. Aceptacion de terminos — toque de "Acepto" / "No acepto". Va PRIMERO, antes de identificar:
  //    quien acepta casi nunca es del equipo, y el id del boton es inequivoco (`terminos:...`), asi
  //    que ese toque no puede terminar como texto en el flujo de gastos.
  //    Por este numero solo entra MeTRIK ONE (2026-10-29): los flujos aislados que iban aqui
  //    (Cardumen, Venezuela, Customer, turismo) se apagaron y nada se clasifica antes de saber
  //    quien escribe.
  //    Si el toque es el del aviso de datos del bot, `cerrarAviso` confirma y procesa (aqui mismo,
  //    en orden) lo que la persona escribio antes de aceptar.
  if (await atenderBotonTerminos(supabase, message, {
    alResponderAviso: (fila, decision, respondidoAt) => cerrarAviso(supabase, fila, decision, respondidoAt, processMessage),
  })) return;

  // 1. Identify user by phone number
  const user = await identifyUser(supabase, message.phone);

  // 1a. Aceptacion de terminos pendiente para este telefono: se le muestra el documento con los
  //     botones (o se le recuerdan). ANTES del "no reconozco este numero", porque quien tiene que
  //     aceptar casi nunca es del equipo; y tambien para numeros registrados, que en ese caso
  //     siguen al flujo normal (ver `decidirEntrante`).
  if (await atenderPendienteTerminos(supabase, message, !!user)) return;

  if (!user) {
    await atenderDesconocido(supabase, message);
    return;
  }

  // Bloqueo de todo ONE (`_shared/texto-latino.ts`): lo que el equipo escribe al bot (gastos,
  // contactos, datos de negocios) entra con los dobles cirílicos/griegos ya latinos.
  if (message.text) message.text = aLetraLatina(message.text);

  // 1a-aviso. Aviso de datos del bot (opt-in por workspace: `config_extra.aviso_datos_bot`, que llega en
  //     la misma lectura que identifica al remitente). Dueño, miembro o colaborador que no haya aceptado
  //     la versión vigente: el mensaje se RETIENE sin procesar y se le muestra el aviso. Va antes del
  //     intérprete, la bandeja, el módulo, la transcripción y el parser: nada retenido llega a Gemini.
  //     Apagado, no hace ni una consulta. Ver `_shared/aviso-datos-bot.ts`.
  if (await atenderAvisoDatos(supabase, user, message, processMessage)) return;

  // 1a-nosop. Lo que el bot no lee (video, sticker, tarjeta de contacto): antes se perdía en silencio. Se dice que no se
  //     puede leer y qué sí recibe (foto o PDF del soporte). En un workspace con la bandeja sigue callado, como antes.
  //     Ver `_shared/wa-no-soportado.ts`.
  if (message.type === 'no_soportado') {
    await logMessage(supabase, message.phone, 'inbound', user.workspace_id, 'no_soportado', `[${message.tipo_meta ?? 'desconocido'}]`).catch(() => {});
    if (contestarNoSoportado(user, message) && botEquipoPermitido(user.modulos)) {
      await sendTextMessage(message.phone, textoNoSoportado(message.tipo_meta));
    }
    return;
  }

  // 1a-conv. La conversación completa (`wa_conversacion`, ver `_shared/wa-conversacion.ts`): solo en los workspaces con
  //     la bandeja o el bot conversacional configurado, y solo DESPUÉS del aviso de datos (lo retenido no se guarda).
  //     Fuera de esos workspaces no hace ni una consulta. Se escribe aunque el agente esté apagado.
  await registrarEntrante(supabase, user, message);

  // 1a-agente. El núcleo conversacional (opt-in por workspace: `config_extra.bot_conversacional.agente`, que llega en la
  //     misma lectura que identifica al remitente). Prendido, atiende lo del equipo con el modelo y sus herramientas; las
  //     escrituras solo con un toque. Apagado, no hace ni una consulta y todo sigue como hoy. Ver `_shared/wa-agente.ts`.
  if (await atenderConAgente(supabase, user, message)) return;

  // 1a-int. Intérprete conversacional (opt-in por workspace: `config_extra.bot_conversacional`, que
  //     llega en la misma lectura que identifica al remitente). Un escrito libre del equipo pasa por UN
  //     llamado al modelo que entiende y un validador que decide; si atiende, termina aquí. Apagado, o
  //     ante cualquier falla, devuelve `atendido: false` sin tocar la base y todo sigue exactamente
  //     como hoy. Reenvíos, botones, audio y fotos nunca pasan. Ver `_shared/wa-interprete.ts`.
  if ((await atenderEscrito(supabase, user, message)).atendido) return;

  // 1a-bandeja. Bandeja de solicitudes (opt-in por workspace: `modules.bandeja_solicitudes_wa`).
  //     Lo que un comercial reenvia o dicta queda guardado COMPLETO y agrupado por entrega, y NO
  //     pasa por Gemini ni por el flujo de gastos. Va antes de la puerta de Clarity porque es su
  //     propia llave, y antes del tope de 30 mensajes por hora porque una sola conversacion
  //     reenviada puede pasar de 30 y la bandeja no gasta parser. Con la llave apagada no hace
  //     ni una consulta: todo sigue exactamente como antes. Reglas en `_shared/wa-bandeja-reglas.ts`.
  //     Con la llave encendida manda la bandeja: solo van al bot «gasto …», «bot …» (sin la palabra
  //     «bot») y lo que contesta una conversación del bot a medias.
  const bandeja = await rutaDelMensaje(supabase, user, message);
  if (bandeja.atendido) return;
  if (bandeja.ruta === 'bandeja' && bandeja.config) {
    await atenderEnBandeja(supabase, user, message, bandeja.config);
    return;
  }
  if (bandeja.textoParaElBot) message.text = bandeja.textoParaElBot;

  // 1b. Modulo. Todo lo que sigue (gastos, contactos, actividad de negocios, numeros, cartera, y
  //     la transcripcion y el parseo con Gemini) es de Clarity. Va despues de la aceptacion de
  //     terminos, que no depende del modulo (es como un cliente de Valida API recibe su llave),
  //     y antes de gastar un solo token. Ver `_shared/wa-modulos.ts`.
  if (!botEquipoPermitido(user.modulos)) {
    await sendTextMessage(message.phone, MENSAJE_BOT_SIN_CLARITY);
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

  // 3.2 Modo agente de ONE (2026-10-21, por defecto en todo workspace sin la bandeja; ver `_shared/wa-agente.ts`): el
  //     núcleo conversacional con el dominio ONE (gastos con soporte, actividades, contactos, consultas). Nada se escribe
  //     sin el toque sobre un resumen con código · empresa — nombre. Va después de las puertas del módulo, la suscripción
  //     y el tope. Si no puede correr, devuelve false y sigue el bot de siempre (transcripción, parser, máquina de
  //     estados). Apagado: `bot_conversacional.agente = false` en el workspace, o el secreto `AGENTE_ONE=off`.
  if (await atenderConAgenteOne(supabase, user, message)) return;

  // 3.5 Transcribe audio before any processing
  if (message.type === 'audio' && message.audio_id) {
    const result = await transcribeAudio(message.audio_id);
    if (!result.text) {
      if (result.error) console.error(`[wa-webhook] Audio transcription failed: ${result.error}`);
      await sendTextMessage(message.phone, 'No alcancé a entender el audio. ¿Lo puedes escribir?');
      return;
    }
    message.text = result.text;
    await completarTexto(supabase, message.wa_message_id, result.text);
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
    sendButtons: async (body: string, btns: Array<{ id: string; title: string }>) => { await sendButtons(message.phone, body, btns); },
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
    sendButtons: async (body: string, btns: Array<{ id: string; title: string }>) => { await sendButtons(message.phone, body, btns); },
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
  // La logica vive en `_shared/wa-identificar.ts` (probada en `wa-identificar.test.ts`).
  return identificarRemitente(supabase, phone);
}

// ============================================================
// Meta Webhook Helpers
// ============================================================

async function procesarStatuses(statuses: StatusEntrega[]): Promise<void> {
  await aplicarStatuses(getServiceClient(), statuses);
}

// La logica vive en `_shared/wa-firma.ts` (pura y probada). Aqui solo se leen las variables.
function verifySignature(body: string, signature: string | null): Promise<boolean> {
  return verificarFirmaMeta(body, signature, Deno.env.get('WHATSAPP_APP_SECRET'), {
    saltarFirma: Deno.env.get('WA_WEBHOOK_SKIP_FIRMA') === '1',
  });
}
