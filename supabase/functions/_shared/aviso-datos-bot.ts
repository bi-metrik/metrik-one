// ============================================================
// aviso-datos-bot — reglas PURAS de la puerta del aviso de datos del bot
// ------------------------------------------------------------
// Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-05-aviso-datos-primer-mensaje.md
//
// Si el workspace tiene `config_extra.aviso_datos_bot.activo = true`, nadie del workspace (dueño,
// miembro o colaborador de `wa_collaborators`) usa el bot sin haber aceptado la version vigente del
// aviso. Lo que escribe antes de aceptar se RETIENE sin procesar (no se transcribe, no va a Gemini,
// no toca bandeja ni negocios) y se procesa en orden cuando acepta.
//
// La constancia es una fila de `aceptaciones_terminos` (canal whatsapp) con `aviso_datos_version`:
// el mismo documento + botones + evidencia del flujo de aceptacion de terminos.
// La ejecucion vive en `aviso-datos-bot-flujo.ts`. Este modulo no lee `Deno.env` ni habla con la red.
// ============================================================

import type { IncomingMessage } from './types.ts';

/** Marca de `wa_message_log.intent` y `wa_envios.intent` de todo lo de la puerta. */
export const INTENT_AVISO_DATOS = 'aviso_datos_bot';

/** Cada cuanto, como maximo, se le recuerda el aviso a quien sigue escribiendo sin aceptar. */
export const MINUTOS_RECORDATORIO_AVISO = 2;

/** Tope de mensajes retenidos por solicitud. Lo que pase de aqui no se guarda (se le pide reenviarlo). */
export const MAX_RETENIDOS = 50;

/** Vigencia de la URL firmada del PDF: un poco mas que los 7 dias de la solicitud. */
export const SEGUNDOS_URL_DOCUMENTO = 8 * 24 * 60 * 60;

/** `texto` va de cuerpo del mensaje con botones: Meta lo limita a 1024. */
export const MAX_TEXTO = 1024;
export const MAX_VERSION = 40;

export interface ConfigAvisoDatos {
  documentoVersionId: string;
  texto: string;
  version: string;
}

export type LecturaConfig =
  | { estado: 'apagado' }
  | { estado: 'invalido'; motivo: string }
  | { estado: 'activo'; config: ConfigAvisoDatos };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lee `config_extra.aviso_datos_bot`. Forma esperada:
 *
 *   { "activo": true, "documento_version_id": "<uuid>", "texto": "…", "version": "v1" }
 *
 * - Sin la llave, o con `activo` distinto de `true` (literal): `apagado`. El bot sigue como hoy.
 * - `activo: true` con lo demas mal: `invalido`. La puerta NO deja pasar (falla cerrada): con el
 *   aviso encendido, un error de configuracion no puede convertirse en procesar sin aceptacion.
 */
export function leerConfigAvisoDatos(raw: unknown): LecturaConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { estado: 'apagado' };
  const c = raw as Record<string, unknown>;
  if (c.activo !== true) return { estado: 'apagado' };

  const id = typeof c.documento_version_id === 'string' ? c.documento_version_id.trim() : '';
  if (!UUID.test(id)) return { estado: 'invalido', motivo: 'documento_version_id no es un uuid' };

  const texto = typeof c.texto === 'string' ? c.texto.trim() : '';
  if (!texto) return { estado: 'invalido', motivo: 'falta texto' };
  if (texto.length > MAX_TEXTO) return { estado: 'invalido', motivo: `texto de ${texto.length} caracteres (tope ${MAX_TEXTO})` };

  const version = typeof c.version === 'string' ? c.version.trim() : '';
  if (!version) return { estado: 'invalido', motivo: 'falta version' };
  if (version.length > MAX_VERSION) return { estado: 'invalido', motivo: `version de mas de ${MAX_VERSION} caracteres` };

  return { estado: 'activo', config: { documentoVersionId: id.toLowerCase(), texto, version } };
}

/**
 * La respuesta ESCRITA al aviso. Solo frases exactas (sin tildes, mayusculas ni puntuacion):
 * «acepto», «sí acepto», «no acepto». Un «ok» o un «sí» suelto no es una aceptacion: para eso
 * estan los botones.
 */
export function respuestaEscrita(texto: string | null | undefined): 'acepto' | 'no_acepto' | null {
  const t = (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (['acepto', 'si acepto', 'yo acepto'].includes(t)) return 'acepto';
  if (['no acepto', 'yo no acepto'].includes(t)) return 'no_acepto';
  return null;
}

/** Lo que la puerta lee de una fila del aviso. */
export interface FilaAviso {
  id: string;
  estado: string;
  enviado_at: string | null;
  ultimo_intento_at: string | null;
  expira_at: string;
  created_at: string;
  reply_wamid?: string | null;
  /** Aceptacion revocada: ya no vale y la puerta vuelve a pedir el aviso. */
  revocada_at?: string | null;
}

export type DecisionPuerta =
  /** Acepto la version vigente: el mensaje sigue como hoy. */
  | { accion: 'pasar' }
  /** Es la misma respuesta escrita que ya quedo registrada (reintento de Meta): no se hace nada. */
  | { accion: 'duplicado' }
  /** Hay una solicitud vigente ya mostrada y esto es la respuesta escrita. */
  | { accion: 'responder'; fila: FilaAviso; decision: 'acepto' | 'no_acepto' }
  /** Hay una solicitud vigente: se retiene y se recuerda (con enfriamiento). */
  | { accion: 'retener'; fila: FilaAviso; vencidas: string[] }
  /** No hay solicitud vigente (nunca, rechazada o vencida): se crea, se retiene y se muestra. */
  | { accion: 'crear'; vencidas: string[] };

/**
 * Que hacer con un mensaje de alguien del workspace, dadas sus filas del aviso de la version
 * vigente (`pendiente` o `aceptado`; las rechazadas y vencidas no cuentan: despues de un «No
 * acepto», si vuelve a escribir, se le muestra el aviso otra vez). Una aceptada con `revocada_at`
 * tampoco cuenta: revocada, se pide de nuevo.
 */
export function decidirPuerta(p: {
  filas: FilaAviso[];
  texto: string | null | undefined;
  ahora: Date;
  wamid?: string | null;
}): DecisionPuerta {
  // Meta reintenta el «acepto» escrito que ya se registro: sin esto, el reintento pasaria la puerta
  // (ya acepto) y el bot procesaria «acepto» como un mensaje.
  if (p.wamid && p.filas.some((f) => f.reply_wamid === p.wamid)) return { accion: 'duplicado' };
  if (p.filas.some((f) => f.estado === 'aceptado' && !f.revocada_at)) return { accion: 'pasar' };

  const pendientes = p.filas.filter((f) => f.estado === 'pendiente');
  const vigente = pendientes.find((f) => vigenteAviso(f, p.ahora)) ?? null;
  const vencidas = pendientes.filter((f) => f !== vigente && !vigenteAviso(f, p.ahora)).map((f) => f.id);

  if (!vigente) return { accion: 'crear', vencidas };

  const decision = respuestaEscrita(p.texto);
  // Una respuesta escrita solo vale si el aviso YA se mostro: aceptar lo que no se ha visto no es
  // aceptar nada.
  if (decision && vigente.enviado_at) return { accion: 'responder', fila: vigente, decision };
  return { accion: 'retener', fila: vigente, vencidas };
}

function vigenteAviso(f: Pick<FilaAviso, 'estado' | 'expira_at'>, ahora: Date): boolean {
  const vence = Date.parse(f.expira_at);
  return f.estado === 'pendiente' && Number.isFinite(vence) && vence > ahora.getTime();
}

/**
 * Si el mensaje se guarda para procesarlo despues. La respuesta al aviso («acepto», «no acepto»)
 * no se guarda: no es contenido para el bot, es la respuesta a la puerta.
 */
export function seRetiene(message: Pick<IncomingMessage, 'type' | 'text'>): boolean {
  if (message.type === 'text' && respuestaEscrita(message.text)) return false;
  return true;
}

/**
 * El mensaje que se guarda: lo que el bot necesita para procesarlo despues, SIN el cuerpo crudo
 * del webhook (trae la firma y todo el sobre de Meta) ni el elemento crudo de `messages[]`.
 */
export function mensajeParaRetener(message: IncomingMessage): Record<string, unknown> {
  const { webhook_crudo: _crudo, meta_mensaje: _meta, ...resto } = message;
  return resto as unknown as Record<string, unknown>;
}

/** El `timestamp` de Meta (segundos epoch) como numero, o null. */
export function metaTs(ts: string | undefined): number | null {
  if (!ts || !/^\d{9,11}$/.test(ts)) return null;
  return Number(ts);
}

/** El mensaje guardado, de vuelta a la forma que entiende `processMessage`. Null si no se deja leer. */
export function mensajeRetenido(raw: unknown, phone: string): IncomingMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const tipos = ['text', 'image', 'audio', 'interactive', 'button', 'location'];
  if (typeof m.type !== 'string' || !tipos.includes(m.type)) return null;
  // El telefono es el de la fila, no el del JSON: nunca se procesa a nombre de otro.
  return { ...(m as unknown as IncomingMessage), phone, text: typeof m.text === 'string' ? m.text : '' };
}

/** La version del documento que se muestra. Espejo de las columnas que se leen. */
export interface VersionDocumento {
  id: string;
  titulo: string;
  version: string;
  pdf_bucket: string;
  pdf_path: string;
  pdf_sha256: string;
  texto_sha256: string | null;
  vigente_desde: string;
  vigente_hasta: string | null;
}

/** Vigente hoy (fecha de Bogota, `YYYY-MM-DD`). Fuera de vigencia no se muestra: la puerta falla cerrada. */
export function versionVigente(doc: Pick<VersionDocumento, 'vigente_desde' | 'vigente_hasta'>, hoy: string): boolean {
  if (!doc.vigente_desde || doc.vigente_desde > hoy) return false;
  return !doc.vigente_hasta || doc.vigente_hasta >= hoy;
}

/** Nombre con el que queda la constancia. La columna no admite vacio. */
export function nombreAceptante(nombre: string | null | undefined): string {
  const n = (nombre ?? '').trim();
  return n ? n.slice(0, 200) : 'Usuario del bot';
}

// ── Textos ─────────────────────────────────────────────────────────────────────────────

export const MENSAJE_ACEPTADO = '✅ Gracias. Quedó registrada tu aceptación.';
export const MENSAJE_ACEPTADO_CON_RETENIDOS = '✅ Gracias. Quedó registrada tu aceptación. Ya proceso lo que me enviaste.';
// Texto revisado por Vera (2026-10-05): va tal cual.
export const MENSAJE_RECHAZADO =
  'Quedó registrado que no aceptas el aviso. No procesé lo que enviaste. Si tienes usuario en MéTRIK ONE, puedes seguir registrando tu trabajo desde el navegador; si no, habla con el administrador de tu empresa. Si cambias de opinión, escríbeme de nuevo y te muestro el aviso.';
export const MENSAJE_FALLA =
  'En este momento no puedo atender tu mensaje. No lo procesé; inténtalo de nuevo en unos minutos.';
export const MENSAJE_TOPE_RETENIDOS =
  'Ya guardé varios mensajes tuyos y este no lo pude guardar. Acepta el aviso de arriba y reenvíamelo, por favor.';
export const MENSAJE_AVISO_VENCIDO =
  'Ese aviso ya venció. Escríbeme de nuevo y te lo muestro para que lo puedas aceptar.';
export const MENSAJE_AVISO_ANTERIOR =
  'Ese botón es de un aviso anterior. Escríbeme cualquier mensaje y te muestro el aviso vigente para que lo puedas aceptar.';
