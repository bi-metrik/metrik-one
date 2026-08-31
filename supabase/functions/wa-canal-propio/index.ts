// ============================================================
// wa-canal-propio — Webhook del canal de WhatsApp PROPIO de MeTRIK
// (numero corporativo via Coexistence, app de Meta DEDICADA)
//
// Spec: docs/specs/2026-08-20_canal-whatsapp-propio-metrik.md
//
// SEPARADO de wa-webhook a proposito (decision 6 de la spec): el
// numero corporativo vive en otra app y otra WABA, y su trafico
// NUNCA debe pasar por el codigo que atiende clientes. Por eso esta
// funcion no importa nada de _shared ni reutiliza el ruteo del bot.
//
// Alcance de esta version: RECIBIR y VALIDAR. Nada se persiste.
// El Gate 0 (regla de ingesta, owner Emilio) todavia no esta escrito:
// hasta que exista esa regla firmada, ningun contenido de mensaje
// toca disco. Ver procesarEventoValido() para el punto de extension.
//
// Secretos requeridos en Supabase (los configura Mauricio ANTES del
// deploy — no hay fallback ni bypass de desarrollo):
//   WA_CANAL_PROPIO_VERIFY_TOKEN — handshake GET de verificacion
//   WA_CANAL_PROPIO_APP_SECRET   — firma HMAC-SHA256 del POST
//
// Regla dura de telemetria: PROHIBIDO loguear el cuerpo del mensaje,
// ni siquiera truncado. Solo wa_id hasheado, tipo de mensaje y, cuando
// exista clasificador, su veredicto. Antipatron a NO repetir: el
// receptor de FunnelChat (funnelchat/route.ts en la app Next) registra
// el body crudo ANTES de validar — aqui la firma va primero y un
// rechazo no deja rastro del contenido.
// ============================================================

// ------------------------------------------------------------
// Tipos minimos del payload de Cloud API (solo lo que se lee).
// ------------------------------------------------------------

interface WebhookMessage {
  from?: string; // wa_id del remitente
  type?: string; // text | audio | image | document | location | ...
}

interface WebhookStatus {
  recipient_id?: string;
  status?: string; // sent | delivered | read | failed
}

interface WebhookChange {
  field?: string; // el unico suscrito debe ser "messages" (Gate 0 tecnico)
  value?: {
    messages?: WebhookMessage[];
    statuses?: WebhookStatus[];
  };
}

interface WebhookEntry {
  changes?: WebhookChange[];
}

interface WebhookPayload {
  object?: string;
  entry?: WebhookEntry[];
}

// ------------------------------------------------------------
// Servidor
// ------------------------------------------------------------

Deno.serve(async (req) => {
  // --- GET: handshake de verificacion de Meta ---
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const esperado = Deno.env.get('WA_CANAL_PROPIO_VERIFY_TOKEN');
    if (!esperado) {
      // Sin el secreto configurado no se acepta ningun handshake.
      console.error('[wa-canal-propio] WA_CANAL_PROPIO_VERIFY_TOKEN no configurado — handshake rechazado');
      return new Response('Forbidden', { status: 403 });
    }

    if (mode === 'subscribe' && token !== null && igualdadConstante(token, esperado)) {
      console.log('[wa-canal-propio] Handshake de verificacion OK');
      return new Response(challenge ?? '', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // --- POST: eventos del webhook ---
  if (req.method === 'POST') {
    // La firma se valida sobre el cuerpo CRUDO, antes de parsear,
    // loguear o procesar cualquier cosa.
    const body = await req.text();
    const firmaValida = await verificarFirma(body, req.headers.get('x-hub-signature-256'));
    if (!firmaValida) {
      // Sin rastro del contenido: solo el hecho del rechazo.
      console.error('[wa-canal-propio] Firma invalida — POST rechazado');
      return new Response('Invalid signature', { status: 401 });
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      // Firma valida pero cuerpo no parseable: 200 para que Meta no
      // reintente en bucle. Nunca se loguea el cuerpo.
      console.error('[wa-canal-propio] Payload no parseable (firma valida)');
      return new Response('OK', { status: 200 });
    }

    await registrarTelemetria(payload);
    await procesarEventoValido(payload);

    return new Response('OK', { status: 200 });
  }

  return new Response('Method not allowed', { status: 405 });
});

// ------------------------------------------------------------
// Firma HMAC-SHA256 (X-Hub-Signature-256)
// ------------------------------------------------------------

async function verificarFirma(body: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get('WA_CANAL_PROPIO_APP_SECRET');
  if (!secret) {
    // Sin secreto se rechaza TODO. Deliberadamente no hay bypass de
    // desarrollo: este webhook recibe trafico de un numero personal y
    // el lado seguro de un control es frenar.
    console.error('[wa-canal-propio] WA_CANAL_PROPIO_APP_SECRET no configurado — se rechaza todo POST');
    return false;
  }
  if (!header || !header.startsWith('sha256=')) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const esperada = aHex(new Uint8Array(mac));
  const recibida = header.slice('sha256='.length).toLowerCase();

  return igualdadConstante(esperada, recibida);
}

function aHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Comparacion en tiempo constante para no filtrar por timing en que
// posicion difieren dos cadenas (firma o verify token).
function igualdadConstante(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// ------------------------------------------------------------
// Telemetria SIN cuerpos de mensaje
// ------------------------------------------------------------

// El wa_id se hashea con HMAC-SHA256 llaveado por el app secret (no un
// SHA-256 pelado: un telefono tiene poca entropia y un hash sin llave se
// revierte por fuerza bruta). Truncado a 12 hex: suficiente para
// correlacionar eventos del mismo remitente en los logs sin identificarlo.
async function hashWaId(waId: string): Promise<string> {
  const secret = Deno.env.get('WA_CANAL_PROPIO_APP_SECRET') ?? '';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(waId));
  return aHex(new Uint8Array(mac)).slice(0, 12);
}

async function registrarTelemetria(payload: WebhookPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const field = change.field ?? 'desconocido';

      if (field !== 'messages') {
        // Con el Gate 0 tecnico bien configurado (solo `messages`
        // suscrito, sin `history` ni `smb_message_echoes`) esto no
        // deberia ocurrir. Si aparece, es senal de que la suscripcion
        // de la app cambio: solo se registra el nombre del campo.
        console.warn(`[wa-canal-propio] Campo no esperado en la suscripcion: ${field}`);
        continue;
      }

      for (const msg of change.value?.messages ?? []) {
        const hash = msg.from ? await hashWaId(msg.from) : 'sin_wa_id';
        // Solo: remitente hasheado + tipo. Nunca el texto ni media.
        // Cuando exista el clasificador (alcance B, modo sombra), su
        // veredicto se agrega a ESTA linea — nada mas.
        console.log(`[wa-canal-propio] mensaje wa_id=${hash} tipo=${msg.type ?? 'desconocido'}`);
      }

      for (const st of change.value?.statuses ?? []) {
        const hash = st.recipient_id ? await hashWaId(st.recipient_id) : 'sin_wa_id';
        console.log(`[wa-canal-propio] status wa_id=${hash} estado=${st.status ?? 'desconocido'}`);
      }
    }
  }
}

// ------------------------------------------------------------
// Punto de extension — Gate 0 pendiente
// ------------------------------------------------------------

// Aqui entra la regla de ingesta cuando Emilio la firme. El orden que ya
// define la spec (§4 del dimensionamiento tecnico):
//   1. Match primero, persistir despues: wa_id contra `contactos`.
//   2. Sin match y sin clasificacion comercial → descartar SIN escribir
//      a disco (responder 200 y nada mas).
//   3. `contacts[0].profile.name` es dato personal: que se guarde o no
//      lo decide Emilio, no este codigo.
//   4. Clasificador (alcance B) en modo sombra: clasifica y registra su
//      veredicto en la telemetria, sin disparar nada.
// Hasta entonces: no-op deliberado. Recibir y validar es todo el alcance.
async function procesarEventoValido(_payload: WebhookPayload): Promise<void> {
  // Intencionalmente vacio — ver comentario de arriba.
}
