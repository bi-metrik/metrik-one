// ============================================================
// Acuses de Resend — verificacion de firma Svix y traduccion del evento a una
// escritura sobre `avisos_cliente`.
//
// Modulo PURO a proposito: no lee `Deno.env`, no toca la red y no conoce
// Supabase. Asi lo puede ejercitar vitest desde node (`npm test`) y lo puede
// importar tambien el backfill de `scripts/`, que corre en node. La regla que
// decide que se escribe vive UNA sola vez: si el webhook y el backfill tuvieran
// cada uno su copia, el historico y lo que llegue en vivo quedarian con dos
// criterios distintos, que es justo lo que este frente viene a cerrar.
//
// Todo lo que usa (crypto.subtle, atob, TextEncoder) es global en Deno y en
// Node 18+, asi que el mismo archivo corre en los dos runtimes sin imports.
// ============================================================

// ── Firma Svix ───────────────────────────────────────────────────────────────
//
// ⚠️ Svix NO es el mismo HMAC que Meta, y confundirlos deja el webhook
// rechazando todo. Tres diferencias, verificadas contra
// https://docs.svix.com/receiving/verifying-payloads/how-manual (leido el
// 2026-09-09):
//
//   1. Lo que se firma NO es el cuerpo: es `${svix-id}.${svix-timestamp}.${body}`.
//   2. La clave NO es el secreto en texto: es el secreto DECODIFICADO de base64,
//      quitandole el prefijo `whsec_`. Firmar con el texto del secreto produce
//      una firma que nunca coincide.
//   3. La firma viaja en base64, no en hex, y el header trae una LISTA separada
//      por espacios (`v1,<b64> v1,<b64> v2,<b64>`). Basta que UNA de version v1
//      coincida. Comparar contra el header entero falla en cuanto Svix rote
//      claves, que es justo cuando conviene que siga entrando.
//
// El cuerpo tiene que ser el texto CRUDO. Parsear el JSON y volver a
// serializarlo cambia un espacio y tumba la firma.

/** Lo que la ventana de tiempo de Svix tolera, en segundos.
 *
 * Es el mismo valor que aplica la libreria oficial (`WEBHOOK_TOLERANCE_IN_SECONDS
 * = 5 * 60`), y Resend recomienda esa libreria como forma canonica de verificar
 * sus webhooks. Eso es lo que hace seguro el valor: si Svix reusara el timestamp
 * original en los reintentos, TODO cliente que use la libreria oficial perderia
 * cada reintento posterior a 5 minutos. Se deja configurable por quien llama
 * para no tener que redesplegar si algun dia se descubre lo contrario, y el
 * rechazo por ventana se reporta con una razon PROPIA (`timestamp_fuera_de_ventana`)
 * y no mezclado con "firma invalida": si esto llegara a pasar, el log lo dice
 * con todas las letras en vez de parecer un ataque. */
export const TOLERANCIA_SEGUNDOS = 5 * 60;

export type RazonFirma =
  | 'sin_secreto'
  | 'sin_cabeceras'
  | 'timestamp_invalido'
  | 'timestamp_fuera_de_ventana'
  | 'sin_firma_valida';

export type ResultadoFirma = { ok: true } | { ok: false; razon: RazonFirma };

export type CabecerasSvix = {
  id: string | null;
  timestamp: string | null;
  firma: string | null;
};

/**
 * Lee las cabeceras de Svix aceptando los DOS prefijos.
 *
 * `svix-*` es el default; `webhook-*` es el mismo juego con marca blanca, que
 * Svix habilita a sus clientes Professional y Enterprise. Resend hoy manda
 * `svix-*`, pero el dia que lo cambie el webhook empezaria a devolver 401 sin
 * que nada en el codigo hubiera cambiado. Aceptar los dos cuesta tres lineas.
 */
export function leerCabecerasSvix(headers: Headers): CabecerasSvix {
  const leer = (nombre: string) =>
    headers.get(`svix-${nombre}`) ?? headers.get(`webhook-${nombre}`);
  return {
    id: leer('id'),
    timestamp: leer('timestamp'),
    firma: leer('signature'),
  };
}

/**
 * Verifica la firma Svix del cuerpo crudo.
 *
 * Un secreto ausente NO autoriza: devuelve `sin_secreto` y el llamador rechaza.
 * No hay atajo de desarrollo a proposito — este webhook cambia el estado de un
 * aviso al cliente, y una puerta abierta "solo en dev" es una puerta.
 */
export async function verificarFirmaSvix(opts: {
  secreto: string | undefined | null;
  cabeceras: CabecerasSvix;
  cuerpo: string;
  ahoraMs: number;
  toleranciaSegundos?: number;
}): Promise<ResultadoFirma> {
  const { secreto, cabeceras, cuerpo, ahoraMs } = opts;
  const tolerancia = opts.toleranciaSegundos ?? TOLERANCIA_SEGUNDOS;

  if (!secreto) return { ok: false, razon: 'sin_secreto' };
  const { id, timestamp, firma } = cabeceras;
  if (!id || !timestamp || !firma) return { ok: false, razon: 'sin_cabeceras' };

  const segundos = Number(timestamp);
  if (!Number.isFinite(segundos) || !/^\d+$/.test(timestamp.trim())) {
    return { ok: false, razon: 'timestamp_invalido' };
  }
  // La ventana se mira en las DOS direcciones: un timestamp del futuro tambien
  // es un intento de replay con el reloj corrido.
  const desfase = Math.abs(ahoraMs / 1000 - segundos);
  if (desfase > tolerancia) return { ok: false, razon: 'timestamp_fuera_de_ventana' };

  const esperada = await firmarContenido(secreto, `${id}.${timestamp}.${cuerpo}`);

  // El header es una lista separada por espacios. Se recorren TODAS las entradas
  // v1 y se compara en tiempo constante; una sola coincidencia alcanza.
  let valida = false;
  for (const entrada of firma.split(' ')) {
    const [version, valor] = entrada.split(',', 2);
    if (version !== 'v1' || !valor) continue;
    // Sin corto circuito: se siguen recorriendo todas para que el tiempo de la
    // respuesta no diga en que posicion estaba la firma buena.
    if (igualesEnTiempoConstante(valor, esperada)) valida = true;
  }
  return valida ? { ok: true } : { ok: false, razon: 'sin_firma_valida' };
}

async function firmarContenido(secreto: string, contenido: string): Promise<string> {
  const clave = await crypto.subtle.importKey(
    'raw',
    bytesDelSecreto(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const firma = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(contenido));
  return base64DeBytes(new Uint8Array(firma));
}

/** `whsec_MfKQ9r8G...` → los bytes de `MfKQ9r8G...` decodificado de base64.
 *
 * El buffer se reserva explicito en vez de `new Uint8Array(n)` porque el `lib`
 * de Deno tipa ese constructor como `Uint8Array<ArrayBufferLike>` y
 * `crypto.subtle.importKey` exige `ArrayBuffer` a secas: sin esto, `deno check`
 * falla con un TS2769 que no dice nada del problema real. */
function bytesDelSecreto(secreto: string): Uint8Array<ArrayBuffer> {
  const limpio = secreto.trim();
  const sinPrefijo = limpio.startsWith('whsec_') ? limpio.slice('whsec_'.length) : limpio;
  const binario = atob(sinPrefijo);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function base64DeBytes(bytes: Uint8Array): string {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

/**
 * Comparacion en tiempo constante.
 *
 * Se acumula el XOR de todos los bytes en vez de cortar en la primera
 * diferencia: con un `===` el tiempo de respuesta filtra cuantos caracteres del
 * principio acerto quien lo intenta, y con eso una firma se puede adivinar
 * byte a byte. Las cadenas de distinto largo devuelven false, pero recorriendo
 * igual la mas larga.
 */
function igualesEnTiempoConstante(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let acumulado = a.length === b.length ? 0 : 1;
  for (let i = 0; i < max; i++) {
    acumulado |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return acumulado === 0;
}

// ── El evento de Resend, traducido ───────────────────────────────────────────
//
// Forma del payload verificada contra
// https://resend.com/docs/webhooks/emails/bounced.md (leido el 2026-09-09):
//   { type, created_at, data: { email_id, to, subject, bounce?: { type, subType,
//     message, diagnosticCode } } }
//
// `created_at` de la RAIZ es cuando ocurrio el evento; el `created_at` que va
// DENTRO de `data` es cuando se creo el correo, o sea el envio. Escribir ese
// segundo en `entregado_at` fecharia la entrega en el momento del envio.

export type Acuse =
  | { clase: 'entregado'; emailId: string; ocurridoEn: string }
  | { clase: 'rebotado'; emailId: string; ocurridoEn: string; motivo: string }
  | { clase: 'queja'; emailId: string; ocurridoEn: string };

export type LecturaAcuse =
  | { ok: true; acuse: Acuse }
  | { ok: false; razon: string };

/** Los tres eventos que este webhook aplica. El resto se ignora con 200. */
const CLASE_POR_TIPO: Record<string, Acuse['clase']> = {
  'email.delivered': 'entregado',
  'email.bounced': 'rebotado',
  'email.complained': 'queja',
};

export function interpretarAcuse(payload: unknown, ahoraISO: string): LecturaAcuse {
  if (!payload || typeof payload !== 'object') return { ok: false, razon: 'payload_invalido' };
  const raiz = payload as Record<string, unknown>;
  const tipo = typeof raiz.type === 'string' ? raiz.type : '';
  const clase = CLASE_POR_TIPO[tipo];
  if (!clase) return { ok: false, razon: `tipo_no_manejado:${tipo || 'sin_tipo'}` };

  const data = (raiz.data && typeof raiz.data === 'object' ? raiz.data : {}) as Record<string, unknown>;
  const emailId = typeof data.email_id === 'string' ? data.email_id.trim() : '';
  if (!emailId) return { ok: false, razon: 'sin_email_id' };

  const ocurridoEn = fechaValida(raiz.created_at) ?? ahoraISO;

  if (clase === 'rebotado') {
    return { ok: true, acuse: { clase, emailId, ocurridoEn, motivo: motivoDeRebote(data.bounce) } };
  }
  return { ok: true, acuse: { clase, emailId, ocurridoEn } };
}

function fechaValida(valor: unknown): string | null {
  if (typeof valor !== 'string' || !valor.trim()) return null;
  const t = Date.parse(valor);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Tope del motivo. `motivo` es texto libre, pero un diagnostico de Gmail trae
 *  parrafo y enlace de ayuda: sin tope, la columna deja de poder leerse de un
 *  vistazo, que es para lo unico que sirve. */
export const MOTIVO_MAX = 300;

/**
 * `rebote_permanente: <diagnostico>` / `rebote_transitorio: <diagnostico>`.
 *
 * El prefijo es la parte ACCIONABLE y es lo que separa dos trabajos distintos:
 * un buzon lleno (`Transient`) se puede reintentar mas tarde y no hay nada que
 * corregir; una cuenta que no existe (`Permanent`) exige ir a corregir la
 * direccion. Por eso el tipo va delante y no enterrado en el texto.
 *
 * ⚠️ El diagnostico va COMO LLEGA, solo con los espacios normalizados y cortado
 * al tope. Recortar por heuristica el prefijo `smtp; 550 5.1.1` dejaria el texto
 * mas bonito y borraria el codigo SMTP, que es justo lo que distingue "buzon
 * lleno" de "cuenta inexistente" cuando el resto de la frase es generico. Se
 * prefiere ilegible-pero-completo antes que legible-y-mutilado.
 *
 * ⚠️ `type` llega como `Permanent` o como `Transient`/`Temporary` segun el
 * proveedor de abajo: la documentacion de Resend dice `Temporary` y los rebotes
 * reales medidos en SOENA el 2026-09-09 dicen `Transient`. Se aceptan los dos.
 * Un `type` que no sea ninguno de esos NO se clasifica como transitorio por
 * descarte: cae a `rebote` a secas, porque afirmar "se puede reintentar" sobre
 * algo que no sabemos es exactamente la clase de default silencioso que ya
 * costo caro en este repo.
 */
export function motivoDeRebote(bounce: unknown): string {
  const b = (bounce && typeof bounce === 'object' ? bounce : {}) as Record<string, unknown>;
  const tipo = typeof b.type === 'string' ? b.type.trim().toLowerCase() : '';
  const prefijo = tipo === 'permanent'
    ? 'rebote_permanente'
    : tipo === 'transient' || tipo === 'temporary'
      ? 'rebote_transitorio'
      : 'rebote';

  const diagnostico = normalizar(primerDiagnostico(b));
  if (!diagnostico) return prefijo;
  const completo = `${prefijo}: ${diagnostico}`;
  return completo.length <= MOTIVO_MAX ? completo : `${completo.slice(0, MOTIVO_MAX - 1)}…`;
}

/** Precedencia: la respuesta SMTP cruda, despues el mensaje del proveedor,
 *  despues el subtipo. La primera es la unica que viene del servidor que
 *  rechazo; las otras dos son el resumen de Resend. */
function primerDiagnostico(b: Record<string, unknown>): string {
  const codigos = b.diagnosticCode;
  if (Array.isArray(codigos)) {
    const primero = codigos.find((c) => typeof c === 'string' && c.trim());
    if (typeof primero === 'string') return primero;
  } else if (typeof codigos === 'string' && codigos.trim()) {
    return codigos;
  }
  if (typeof b.message === 'string' && b.message.trim()) return b.message;
  if (typeof b.subType === 'string' && b.subType.trim()) return b.subType;
  return '';
}

function normalizar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

// ── La escritura ─────────────────────────────────────────────────────────────
//
// ⚠️⚠️ Aqui vive la idempotencia y el orden, y viven EN LA CONDICION del update,
// no en un `if` previo. Svix garantiza entrega "al menos una vez" y NO garantiza
// orden (lo dice su documentacion, y los reintentos van hasta 10 h despues), asi
// que:
//
//   · Un `delivered` que llegue DESPUES de un `bounced` no puede devolver la
//     fila a `enviado`. Se resuelve de raiz: `delivered` no escribe `estado`,
//     escribe `entregado_at`. Nunca compiten por la misma columna.
//   · Reprocesar el mismo evento dos veces tiene que dar el mismo resultado. Las
//     tres guardas lo garantizan sin leer antes: la segunda pasada no encuentra
//     fila que actualizar.
//
// Y hay un caso que parece raro y es el normal: `delivered` PRIMERO y `bounced`
// despues. `delivered` significa que el servidor de correo del destinatario
// acepto el mensaje; el buzon puede devolverlo minutos despues. Por eso el
// rebote NO borra `entregado_at`: las dos cosas pasaron, y una fila que diga
// "entregado a las 10:00, rebotado a las 10:02" es la descripcion correcta.
export type Guarda =
  | { columna: 'entregado_at' | 'queja_at'; modo: 'es_nulo' }
  | { columna: 'estado'; modo: 'igual_a'; valor: string };

export type Actualizacion = {
  /** Columnas a escribir. Se compara por clave en las pruebas: que `entregado`
   *  y `queja` NO traigan `estado` es la parte que hay que poder afirmar. */
  set: Record<string, string>;
  guarda: Guarda;
};

export function actualizacionDeAcuse(acuse: Acuse): Actualizacion {
  switch (acuse.clase) {
    case 'entregado':
      return {
        set: { entregado_at: acuse.ocurridoEn },
        // Se conserva la PRIMERA entrega: un reintento del mismo evento no
        // corre la fecha, y un `delivered` posterior a un rebote tampoco.
        guarda: { columna: 'entregado_at', modo: 'es_nulo' },
      };
    case 'rebotado':
      return {
        set: { estado: 'rebotado', motivo: acuse.motivo },
        // Solo una fila `enviado` pasa a `rebotado`. Cubre tres cosas de una:
        // (a) la segunda entrega del mismo rebote no hace nada; (b) una fila
        // `omitido` o `fallido` no se puede pisar — de hecho esas ni siquiera
        // tienen `proveedor_id`; (c) si llegaran dos rebotes distintos para el
        // mismo correo, manda el PRIMERO, que es el que el servidor emitio.
        guarda: { columna: 'estado', modo: 'igual_a', valor: 'enviado' },
      };
    case 'queja':
      return {
        // Una queja NO cambia `estado`: el correo SI llego, y por eso se puede
        // marcar como spam. Degradarlo a `rebotado` diria que no llego, que es
        // falso, y borraria la unica diferencia entre los dos problemas.
        set: { queja_at: acuse.ocurridoEn },
        guarda: { columna: 'queja_at', modo: 'es_nulo' },
      };
  }
}

// ── Reconstruccion desde `GET /emails/{id}` (solo el backfill) ───────────────
//
// El webhook trae el evento; el historico hay que ir a buscarlo, y lo unico que
// Resend expone por email es `last_event` (documentado en
// https://resend.com/docs/api-reference/emails/retrieve-email.md y
// https://resend.com/docs/dashboard/emails/manage-emails, leidos el 2026-09-09).
//
// ⚠️ TRES LIMITES QUE EL BACKFILL NO PUEDE SALTAR, y por eso se declaran aqui:
//
//   1. `last_event` es el ULTIMO evento, no la historia. Un correo entregado y
//      despues marcado como spam solo dice `complained`: su `entregado_at` no se
//      puede reponer. El webhook, en cambio, ve los dos.
//   2. No viene la FECHA del evento. El backfill usa la del envio como
//      aproximacion, y quien lo corre tiene que saberlo — por eso `ocurridoEn`
//      entra por parametro y esta funcion no inventa ninguno.
//   3. En un rebote no viene el diagnostico SMTP ni el `type`. Por eso el motivo
//      reconstruido es distinguible a simple vista de uno en vivo: este empieza
//      por `rebote:` y el del webhook por `rebote_permanente:` o
//      `rebote_transitorio:`.
export const MOTIVO_REBOTE_RECONSTRUIDO =
  'rebote: reconstruido de Resend (last_event=bounced), sin diagnostico SMTP';

/**
 * Traduce el `last_event` de un correo al acuse equivalente, o `null` si ese
 * evento no dice nada sobre la entrega.
 *
 * `opened` y `clicked` cuentan como entrega: no se puede abrir un correo que no
 * llego, y son eventos ESTRICTAMENTE posteriores a `delivered`. Sin esta linea,
 * cualquier correo que el cliente haya abierto quedaria sin `entregado_at` — que
 * es justo el caso de los que mejor salieron.
 *
 * ⚠️ `suppressed` devuelve `null` A PROPOSITO, y no porque no importe: significa
 * que Resend acepto el POST y despues NO lo envio, porque la direccion estaba en
 * la lista de supresion. La fila diria `enviado` sobre un correo que no salio.
 * No se mapea aqui porque el vocabulario de `estado` no tiene un lugar para eso
 * y elegirle uno a ojo seria inventar; el backfill lo CUENTA aparte para que la
 * decision la tome una persona con el numero delante.
 */
export function acuseDesdeLastEvent(
  lastEvent: string | null | undefined,
  emailId: string,
  ocurridoEn: string,
): Acuse | null {
  switch ((lastEvent ?? '').trim().toLowerCase()) {
    case 'delivered':
    case 'opened':
    case 'clicked':
      return { clase: 'entregado', emailId, ocurridoEn };
    case 'bounced':
      return { clase: 'rebotado', emailId, ocurridoEn, motivo: MOTIVO_REBOTE_RECONSTRUIDO };
    case 'complained':
      return { clase: 'queja', emailId, ocurridoEn };
    // sent, queued, scheduled, delivery_delayed, failed, canceled, suppressed:
    // ninguno afirma que el correo llego ni que reboto.
    default:
      return null;
  }
}
