// ============================================================
// aceptacion-terminos — reglas PURAS del flujo de aceptacion por WhatsApp
// ------------------------------------------------------------
// Quien debe aceptar un documento le escribe al bot, recibe el documento y un mensaje con dos
// botones, y el toque queda como evidencia en `aceptaciones_terminos` (ver la migracion
// 20260915040000). Si acepta, se ejecutan sus acciones post-aceptacion (hoy: entregar una llave
// de API de Valida guardada en Vault). La ejecucion (base, Vault, Meta, avisos) vive en
// `aceptacion-terminos-flujo.ts`.
//
// Por que partido en dos: el webhook no se puede importar desde vitest (`wa-parse.ts` lee
// `Deno.env` al cargarse), asi que toda DECISION sale aqui, donde se prueba, y el flujo solo
// la ejecuta. Mismo corte que `handlers/registro/soporte-foto.ts`.
//
// Este modulo no lee `Deno.env`, no habla con la red y no importa nada del bot.
// ============================================================

/** Todo boton de este flujo empieza asi. Ningun otro flujo del bot usa ids con `:`. */
export const PREFIJO_BOTON = 'terminos';

/** Maximo un reenvio de los botones cada tantos minutos, por mucho que la persona escriba. */
export const MINUTOS_ENTRE_RECORDATORIOS = 10;

/** Marca de `wa_message_log.intent` y `wa_envios.intent` para todo lo de este flujo. */
export const INTENT_ACEPTACION = 'aceptacion_terminos';

export type DecisionBoton = 'acepto' | 'no_acepto';
export type EstadoAceptacion = 'pendiente' | 'aceptado' | 'rechazado' | 'expirado';
export type CalidadAceptante = 'representante_legal' | 'apoderado' | 'persona_natural' | 'autorizado';

/** Lo que el flujo lee de una fila. Espejo de las columnas que selecciona. */
export interface FilaAceptacion {
  id: string;
  workspace_id: string;
  negocio_id: string | null;
  telefono: string;
  nombre_aceptante: string;
  calidad: CalidadAceptante | string;
  empresa_nombre: string | null;
  empresa_nit: string | null;
  documento_titulo: string;
  documento_version: string;
  documento_url: string;
  documento_sha256: string;
  texto_aceptacion: string;
  estado: EstadoAceptacion | string;
  prompt_wamid: string | null;
  documento_wamid: string | null;
  reply_wamid: string | null;
  button_id: string | null;
  enviado_at: string | null;
  ultimo_intento_at: string | null;
  respondido_at: string | null;
  expira_at: string;
  created_at: string;
}

const TITULO_BOTON: Record<DecisionBoton, string> = {
  acepto: 'Acepto',
  no_acepto: 'No acepto',
};

// UUID canonico, en minusculas o mayusculas. Estricto a proposito: un id de boton que no
// cuadre no es "casi nuestro", es de otro flujo o esta alterado.
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const RE_ID_BOTON = new RegExp(`^${PREFIJO_BOTON}:(acepto|no_acepto):(${UUID})$`);

/** Id del boton: `terminos:acepto:<uuid>`. Meta admite hasta 256 caracteres; esto usa 53. */
export function idBoton(aceptacionId: string, decision: DecisionBoton): string {
  return `${PREFIJO_BOTON}:${decision}:${aceptacionId}`;
}

/** Los dos botones, en el orden en que se muestran. Titulos dentro del limite de 20 de Meta. */
export function botonesAceptacion(aceptacionId: string): Array<{ id: string; title: string }> {
  return (['acepto', 'no_acepto'] as const).map((d) => ({ id: idBoton(aceptacionId, d), title: TITULO_BOTON[d] }));
}

/** Si el id tiene el prefijo del flujo, aunque este mal formado. Sirve para no mandarlo a otro flujo. */
export function esIdDeTerminos(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(`${PREFIJO_BOTON}:`);
}

export function parsearIdBoton(id: string | null | undefined): { aceptacionId: string; decision: DecisionBoton } | null {
  if (typeof id !== 'string') return null;
  const m = RE_ID_BOTON.exec(id.trim());
  if (!m) return null;
  return { decision: m[1] as DecisionBoton, aceptacionId: m[2].toLowerCase() };
}

export function estadoPorDecision(decision: DecisionBoton): 'aceptado' | 'rechazado' {
  return decision === 'acepto' ? 'aceptado' : 'rechazado';
}

/** El toque de un boton, leido del mensaje crudo de Meta. */
export interface RespuestaBoton {
  aceptacionId: string;
  decision: DecisionBoton;
  buttonId: string;
  /** wamid del toque. Es la llave de idempotencia. */
  replyWamid: string;
  /** wamid del mensaje con botones que se toco (`context.id`). */
  contextWamid: string | null;
  /** Momento del toque segun Meta, ISO. Null si el timestamp no viene o no es valido. */
  respondidoAt: string | null;
  titulo: string | null;
}

type Obj = Record<string, unknown>;
const esObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const texto = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * Lee un toque de boton de ESTE flujo desde un elemento de `value.messages[]` del webhook.
 *
 * Forma que manda Meta (Cloud API, mensaje entrante interactivo):
 *   { from, id: "wamid...", timestamp: "1757862720", type: "interactive",
 *     context: { from, id: "wamid del mensaje con botones" },
 *     interactive: { type: "button_reply", button_reply: { id, title } } }
 *
 * Devuelve null para cualquier otra cosa: otro tipo de mensaje, una lista (`list_reply`), un
 * boton de otro flujo, un id alterado, o un mensaje sin wamid (sin wamid no hay idempotencia,
 * y un registro que no se puede deduplicar no se escribe).
 */
export function leerRespuestaBoton(msg: unknown): RespuestaBoton | null {
  if (!esObj(msg) || msg.type !== 'interactive') return null;
  const interactive = msg.interactive;
  if (!esObj(interactive) || !esObj(interactive.button_reply)) return null;
  if (interactive.type !== undefined && interactive.type !== 'button_reply') return null;

  const buttonId = texto(interactive.button_reply.id);
  const parsed = parsearIdBoton(buttonId);
  const replyWamid = texto(msg.id);
  if (!parsed || !buttonId || !replyWamid) return null;

  const contexto = esObj(msg.context) ? texto(msg.context.id) : null;
  return {
    ...parsed,
    buttonId,
    replyWamid,
    contextWamid: contexto,
    respondidoAt: epochAIso(msg.timestamp),
    titulo: texto(interactive.button_reply.title),
  };
}

/** `timestamp` de Meta (segundos epoch, como string) a ISO. Null si no es un numero razonable. */
export function epochAIso(ts: unknown): string | null {
  const n = typeof ts === 'number' ? ts : typeof ts === 'string' && /^\d+$/.test(ts) ? Number(ts) : NaN;
  // Entre 2020 y 2100: fuera de ahi no es un timestamp de Meta, es basura.
  if (!Number.isFinite(n) || n < 1_577_836_800 || n > 4_102_444_800) return null;
  return new Date(n * 1000).toISOString();
}

/** El `from` de Meta (solo digitos) a E.164 con '+'. Null si no parece un telefono. */
export function telefonoE164(from: string | null | undefined): string | null {
  const digitos = (from ?? '').replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digitos)) return null;
  return `+${digitos}`;
}

/** Pendiente y con plazo por delante. Una fila sin fecha de vencimiento legible no esta vigente. */
export function estaVigente(fila: Pick<FilaAceptacion, 'estado' | 'expira_at'>, ahora: Date): boolean {
  const vence = Date.parse(fila.expira_at);
  return fila.estado === 'pendiente' && Number.isFinite(vence) && vence > ahora.getTime();
}

/** Que hacer con un mensaje (que no es un toque de boton) de un telefono con una aceptacion pendiente. */
export interface DecisionEntrante {
  /** Que se le manda: el documento con los botones, solo los botones, o nada. */
  enviar: 'documento' | 'botones' | null;
  /** Si el mensaje sigue al flujo normal del bot despues. */
  continuar: boolean;
}

/**
 * Decide que pasa con un mensaje entrante cuando el telefono tiene una aceptacion pendiente.
 *
 * - Sin pendiente vigente: nada cambia (`continuar`).
 * - Con pendiente: si nunca se mostro, va el documento con los botones; si ya se mostro, solo
 *   los botones. En los dos casos, maximo una vez cada `minutos` (cuenta desde el ultimo
 *   INTENTO, salga bien o mal, para que un documento que no se puede enviar no se reintente
 *   con cada mensaje).
 * - `continuar` depende de si el numero esta registrado:
 *     · NO registrado: nunca sigue. La alternativa es el "no reconozco este numero", que es
 *       justo lo que no se le puede decir a quien estamos esperando que acepte.
 *     · Registrado (alguien del equipo, o una prueba interna): siempre sigue. Una aceptacion
 *       pendiente no puede tragarse el gasto que la persona acaba de mandar.
 */
export function decidirEntrante(p: {
  pendiente: Pick<FilaAceptacion, 'estado' | 'expira_at' | 'enviado_at' | 'ultimo_intento_at'> | null;
  registrado: boolean;
  ahora: Date;
  minutos?: number;
}): DecisionEntrante {
  if (!p.pendiente || !estaVigente(p.pendiente, p.ahora)) return { enviar: null, continuar: true };

  const minutos = p.minutos ?? MINUTOS_ENTRE_RECORDATORIOS;
  const ultimo = p.pendiente.ultimo_intento_at ? Date.parse(p.pendiente.ultimo_intento_at) : NaN;
  const enfriado = !Number.isFinite(ultimo) || p.ahora.getTime() - ultimo >= minutos * 60_000;

  const enviar = !enfriado ? null : p.pendiente.enviado_at ? 'botones' : 'documento';
  return { enviar, continuar: p.registrado };
}

export type RespuestaNoAplicada = 'ajena' | 'duplicado' | 'ya_respondida' | 'vencida' | 'reintentar';

/**
 * Por que un toque de boton NO cambio la fila (el UPDATE condicionado afecto cero filas).
 * Se clasifica despues de leerla, contra su estado de AHORA.
 *
 * - `ajena`: no existe, o es de otro telefono. No se revela nada de la fila.
 * - `duplicado`: el mismo toque ya quedo registrado (reintento de Meta). No se hace nada.
 * - `ya_respondida`: otro toque, sobre una fila ya respondida. La primera respuesta es la que vale.
 * - `vencida`: expirada, o pendiente con el plazo cumplido.
 * - `reintentar`: pendiente y vigente, y aun asi no se escribio (carrera o fallo transitorio).
 */
export function clasificarRespuestaNoAplicada(
  fila: Pick<FilaAceptacion, 'telefono' | 'estado' | 'reply_wamid' | 'expira_at'> | null,
  telefono: string,
  replyWamid: string,
  ahora: Date,
): RespuestaNoAplicada {
  if (!fila || fila.telefono !== telefono) return 'ajena';
  if (fila.reply_wamid && fila.reply_wamid === replyWamid) return 'duplicado';
  if (fila.estado === 'aceptado' || fila.estado === 'rechazado') return 'ya_respondida';
  if (fila.estado === 'expirado' || !estaVigente(fila, ahora)) return 'vencida';
  return 'reintentar';
}

// ── Textos ─────────────────────────────────────────────────────────────────────────────

/**
 * Fecha y hora de Bogota como "14/09/2026 a las 10:32".
 *
 * Se arma por partes y no con el literal de `es-CO`, que mete "de" entre las partes y no se
 * quita con opciones. `hourCycle: 'h23'` y no `hour12: false`: en varias versiones de ICU el
 * segundo selecciona h24 y la medianoche sale "24:05".
 */
export function fechaHoraBogota(iso: string): string {
  const fecha = new Date(iso);
  if (!Number.isFinite(fecha.getTime())) return iso;
  const partes = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(fecha);
  const p = (t: Intl.DateTimeFormatPartTypes) => partes.find((x) => x.type === t)?.value ?? '';
  return `${p('day')}/${p('month')}/${p('year')} a las ${p('hour')}:${p('minute')}`;
}

const CALIDAD_LEGIBLE: Record<string, string> = {
  representante_legal: 'representante legal',
  apoderado: 'apoderado',
  persona_natural: 'persona natural',
  autorizado: 'autorizado',
};

export function calidadLegible(calidad: string): string {
  return CALIDAD_LEGIBLE[calidad] ?? calidad.replace(/_/g, ' ');
}

function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? '';
}

/** Leyenda que acompana el archivo en WhatsApp. Meta limita el caption a 1024. */
export function leyendaDocumento(fila: Pick<FilaAceptacion, 'documento_titulo' | 'documento_version'>): string {
  return `${fila.documento_titulo} (versión ${fila.documento_version})`.slice(0, 1024);
}

/**
 * Nombre con el que llega el archivo: el titulo y la version, con la extension de la URL.
 * Sin extension legible se asume PDF, que es lo que se manda a aceptar.
 */
export function nombreArchivo(fila: Pick<FilaAceptacion, 'documento_titulo' | 'documento_version' | 'documento_url'>): string {
  let ext = 'pdf';
  try {
    const ultimo = new URL(fila.documento_url).pathname.split('/').pop() ?? '';
    const m = /\.([a-z0-9]{2,5})$/i.exec(decodeURIComponent(ultimo));
    if (m) ext = m[1].toLowerCase();
  } catch {
    // URL invalida: la base exige https, asi que esto no deberia pasar; se queda en pdf.
  }
  const base = `${fila.documento_titulo} v${fila.documento_version}`
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return `${base || 'documento'}.${ext}`;
}

/** Lo que recibe la persona despues de tocar el boton. Corto y con la hora de Colombia. */
export function mensajeConfirmacion(
  fila: Pick<FilaAceptacion, 'nombre_aceptante' | 'documento_titulo' | 'documento_version'>,
  decision: DecisionBoton,
  respondidoAt: string,
): string {
  const cuando = `${fechaHoraBogota(respondidoAt)} (hora de Colombia)`;
  const doc = `«${fila.documento_titulo}» (versión ${fila.documento_version})`;
  if (decision === 'acepto') {
    return `✅ Listo, ${primerNombre(fila.nombre_aceptante)}. Quedó registrada tu aceptación de ${doc} el ${cuando}.`;
  }
  return `Quedó registrado que no aceptas ${doc}, el ${cuando}. Ya le avisamos a quien te lo envió.`;
}

/** Respuesta a un toque sobre una fila que ya tenia respuesta. No dice nada que la persona no sepa. */
export function mensajeYaRespondida(
  fila: Pick<FilaAceptacion, 'documento_titulo' | 'estado' | 'respondido_at'>,
): string {
  const que = fila.estado === 'aceptado' ? 'que aceptaste' : 'que no aceptaste';
  const cuando = fila.respondido_at ? ` el ${fechaHoraBogota(fila.respondido_at)} (hora de Colombia)` : '';
  return `Ya teníamos registrado ${que} «${fila.documento_titulo}»${cuando}. Esa respuesta no se cambia por aquí; si necesitas hacerlo, escríbele a quien te envió el documento.`;
}

export const MENSAJE_VENCIDA =
  'Esta solicitud de aceptación ya venció. Quien te envió el documento te hará llegar una nueva.';
export const MENSAJE_AJENA =
  'No encontramos una solicitud de aceptación pendiente para este número.';
export const MENSAJE_REINTENTAR =
  'No pude registrar tu respuesta. Tócala de nuevo en un momento, por favor.';
export const MENSAJE_DOCUMENTO_EN_PREPARACION =
  'Recibimos tu mensaje. Estamos preparando el documento y en breve te lo compartimos por aquí.';

/** Aviso interno (a quien opera) de una respuesta registrada. */
export function avisoRespuesta(p: {
  fila: Pick<FilaAceptacion, 'nombre_aceptante' | 'calidad' | 'empresa_nombre' | 'empresa_nit' | 'documento_titulo' | 'documento_version' | 'telefono'>;
  decision: DecisionBoton;
  respondidoAt: string;
  negocioCodigo: string | null;
  estadoDocumento: string | null;
  acciones?: ResultadoAccion[];
}): string {
  const { fila } = p;
  const encabezado = p.decision === 'acepto' ? '✅ Aceptación registrada: ACEPTÓ' : '❌ Aceptación registrada: NO ACEPTÓ';
  const empresa = fila.empresa_nombre
    ? ` de ${fila.empresa_nombre}${fila.empresa_nit ? ` (NIT ${fila.empresa_nit})` : ''}`
    : '';
  const lineas = [
    encabezado,
    '',
    `Documento: ${fila.documento_titulo} (versión ${fila.documento_version})`,
    `Quién: ${fila.nombre_aceptante}, ${calidadLegible(fila.calidad)}${empresa}`,
    `Teléfono: ${fila.telefono}`,
    p.negocioCodigo ? `Negocio: ${p.negocioCodigo}` : null,
    `Cuándo: ${fechaHoraBogota(p.respondidoAt)} (hora de Colombia)`,
    `Entrega del documento: ${p.estadoDocumento ?? 'sin acuse de Meta'}`,
    p.estadoDocumento === 'failed' || p.estadoDocumento === 'rechazado'
      ? '⚠️ Meta reporta que el documento NO se entregó: revisa antes de dar la aceptación por buena.'
      : null,
    ...lineasAcciones(p.acciones ?? []),
  ];
  return lineas.filter((l): l is string => l !== null).join('\n');
}

// ── Acciones post-aceptacion ─────────────────────────────────────────────────────────────
// Lo que se le entrega a la persona por el mismo chat cuando toca "Acepto". Viven en
// `aceptaciones_terminos_acciones`; el secreto (si lo hay) vive en Vault y aqui nunca se ve.

export type TipoAccion = 'enviar_credencial_valida' | 'enviar_acceso_portal';

export const URL_DOCS_VALIDA = 'https://valida.metrik.com.co/docs';

/** Solo la credencial se envia hoy. El acceso al portal esta modelado y espera a que exista el portal. */
export function accionImplementada(tipo: string): tipo is 'enviar_credencial_valida' {
  return tipo === 'enviar_credencial_valida';
}

const ETIQUETA_ACCION: Record<string, string> = {
  enviar_credencial_valida: 'Llave de API de Valida',
  enviar_acceso_portal: 'Acceso a la plataforma',
};

export function etiquetaAccion(tipo: string): string {
  return ETIQUETA_ACCION[tipo] ?? tipo;
}

/**
 * Los dos mensajes de la entrega de la llave, con el texto aprobado por Mauricio. El primero lleva
 * la llave y sale solo, para que se pueda copiar entero; el segundo no lleva nada sensible.
 *
 * Para `wa_envios.preview` se llama con la llave YA enmascarada: la misma funcion arma el texto
 * real y su version publicable, asi que las dos no se pueden desalinear.
 */
export function mensajesCredencialValida(llave: string): [string, string] {
  return [
    `Esta es su llave de API de Valida: ${llave} (guárdenla en su gestor de secretos, no en el código). Documentación: ${URL_DOCS_VALIDA}`,
    'En unos minutos les damos acceso a la plataforma, desde donde podrán generar y regenerar sus llaves',
  ];
}

/**
 * Version publicable de un secreto: el prefijo (`vk_`) y 4 caracteres, nada mas. Es lo unico que
 * puede ir a consola, a `wa_envios` o al aviso interno. Un secreto demasiado corto no muestra
 * ningun caracter: con pocos, 4 ya serian media llave.
 */
export function enmascararSecreto(secreto: string): string {
  const s = (secreto ?? '').trim();
  const prefijo = /^[A-Za-z]{1,8}_/.exec(s)?.[0] ?? '';
  const resto = s.slice(prefijo.length);
  return resto.length >= 16 ? `${prefijo}${resto.slice(0, 4)}…` : `${prefijo}…`;
}

/** Como termino una accion en esta corrida. `omitida` = otro proceso ya la habia tomado. */
export interface ResultadoAccion {
  tipo: string;
  estado: 'enviada' | 'fallida' | 'pendiente' | 'omitida';
  /** Texto para el aviso interno. NUNCA el secreto: a lo sumo su version enmascarada. */
  detalle: string;
}

/** Lineas del aviso interno sobre las acciones. Vacio si no habia acciones. */
export function lineasAcciones(acciones: ResultadoAccion[]): string[] {
  if (acciones.length === 0) return [];
  const lineas = ['', 'Acciones:', ...acciones.map((a) => `• ${etiquetaAccion(a.tipo)}: ${a.estado} — ${a.detalle}`)];
  if (acciones.some((a) => a.estado === 'fallida')) {
    lineas.push('⚠️ Una acción falló y NO se reintenta sola. Si llevaba llave, la llave sigue en Vault.');
  }
  return lineas;
}

// ── Integridad del documento ─────────────────────────────────────────────────────────────

/** SHA-256 en hexadecimal minuscula. `crypto.subtle` existe igual en Deno y en Node 20. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function mismoHash(calculado: string, esperado: string): boolean {
  return calculado.trim().toLowerCase() === esperado.trim().toLowerCase();
}
