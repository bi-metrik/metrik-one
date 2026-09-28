// ============================================================
// Bandeja de solicitudes por WhatsApp — las reglas, sin I/O
// ------------------------------------------------------------
// Para que un comercial reenvíe al bot la conversación con su cliente y quede guardada
// COMPLETA en ONE, agrupada por entrega. Diseño: proyectos/trappvel/clarity/docs/diseno/
// motor-solicitud-viaje.md, §2 (pasos 2 a 4) y §3 (paso 1, ingesta).
//
// Aquí vive lo que se decide; `wa-bandeja.ts` solo lo ejecuta. Motivo: nada que importe
// `wa-parse.ts` o lea `Deno.env` al cargarse se puede colectar desde vitest, y el defecto
// que importa (a dónde va un mensaje) es justo el que hay que poder probar.
//
// Lo que NO decide este módulo: agrupar y deduplicar. Eso lo hace la base en UNA sentencia
// (`wa_bandeja_registrar_mensaje`, migración 20260925200000), porque Meta manda cada mensaje
// reenviado en un webhook aparte y varios llegan a la vez: una decisión tomada en TypeScript
// sobre una lectura previa abriría dos entregas para la misma ráfaga.
// ============================================================

/** Llave de función en `workspaces.modules` (catálogo: `src/lib/modulos/catalogo.ts`). */
export const LLAVE_BANDEJA = 'bandeja_solicitudes_wa';

/** Lo que el workspace puede ajustar en `config_extra.bandeja_solicitudes`. */
export interface ConfigBandeja {
  /** Minutos sin mensajes nuevos tras los cuales la entrega se cierra sola. */
  ventanaMinutos: number;
  /** Palabras que, escritas solas, cierran la entrega en el acto. */
  palabrasCierre: string[];
  /**
   * Primeras palabras que mandan un mensaje escrito al bot de siempre (gastos, consultas)
   * aunque la bandeja esté encendida. Solo aplica a lo que NO viene reenviado.
   */
  prefijosBot: string[];
  /** Horas durante las cuales el primer mensaje escrito cuenta como respuesta a «¿de qué cliente es?». */
  horasRespuestaCliente: number;
}

export const CONFIG_BANDEJA_POR_DEFECTO: ConfigBandeja = {
  ventanaMinutos: 5,
  palabrasCierre: ['listo'],
  prefijosBot: ['gasto'],
  horasRespuestaCliente: 24,
};

/** ¿Tiene el workspace la bandeja encendida? Solo `true` literal: nace apagada. */
export function bandejaActiva(modules: Record<string, unknown> | null | undefined): boolean {
  return modules?.[LLAVE_BANDEJA] === true;
}

function entero(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) return def;
  return n;
}

function listaDePalabras(v: unknown, def: string[]): string[] {
  if (!Array.isArray(v)) return def;
  const limpias = v.filter((x): x is string => typeof x === 'string').map(normalizar).filter(Boolean);
  return limpias.length ? limpias : def;
}

/**
 * Lee `config_extra.bandeja_solicitudes`. Un valor ausente o mal escrito cae al default en
 * vez de romper: un número de minutos imposible no puede dejar a la bandeja sin cerrar.
 * Los mismos topes (1..120 min) los aplica la función SQL que cierra por inactividad.
 */
export function leerConfigBandeja(configExtra: unknown): ConfigBandeja {
  const d = CONFIG_BANDEJA_POR_DEFECTO;
  const raw = (configExtra as { bandeja_solicitudes?: Record<string, unknown> } | null)?.bandeja_solicitudes;
  if (!raw || typeof raw !== 'object') return { ...d };
  return {
    ventanaMinutos: entero(raw.ventana_minutos, 1, 120, d.ventanaMinutos),
    palabrasCierre: listaDePalabras(raw.palabras_cierre, d.palabrasCierre),
    prefijosBot: listaDePalabras(raw.prefijos_bot, d.prefijosBot),
    horasRespuestaCliente: entero(raw.horas_respuesta_cliente, 1, 168, d.horasRespuestaCliente),
  };
}

/** Minúsculas, sin tildes, sin puntuación de los bordes, espacios colapsados. */
export function normalizar(texto: string): string {
  return (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s¡!¿?.,;:]+|[\s¡!¿?.,;:]+$/g, '');
}

/** La palabra de cierre tiene que venir SOLA: «listo, el cliente es X» no cierra. */
export function esPalabraCierre(texto: string, palabras: string[]): boolean {
  const t = normalizar(texto);
  return t.length > 0 && palabras.includes(t);
}

/** ¿El mensaje escrito empieza con un prefijo del bot? «gasto 20000 taxi» sí; «gastos del hotel» no. */
export function empiezaConPrefijoBot(texto: string, prefijos: string[]): boolean {
  // «Gasto: 45.000» también: la primera palabra se corta en espacio o puntuación.
  const primera = normalizar(texto).split(/[\s:;,.!?]+/)[0] ?? '';
  return primera.length > 0 && prefijos.includes(primera);
}

export type Ruta = 'bandeja' | 'bot';

export interface EntradaRuta {
  /** `workspaces.modules` del remitente. */
  modules: Record<string, unknown> | null | undefined;
  config: ConfigBandeja;
  tipo: string;
  texto: string;
  reenviado: boolean;
  /** Hay una conversación del bot a medias (p. ej. un gasto esperando la foto del soporte). */
  sesionBotEsperando: boolean;
}

/**
 * A dónde va un mensaje de un remitente YA identificado. Orden de las reglas:
 *
 *   1. bandeja apagada en su workspace → el bot de siempre (nada cambia para nadie más);
 *   2. reenviado → bandeja, siempre: un reenvío es por definición material de una solicitud,
 *      y ni siquiera un gasto a medias puede tragárselo;
 *   3. conversación del bot a medias → el bot, para no romper un gasto que espera su foto;
 *   4. escrito empezando por un prefijo del bot («gasto …») → el bot;
 *   5. todo lo demás → bandeja.
 *
 * La regla 5 es la que hace que las notas de voz y los pantallazos del comercial no terminen
 * leídos como gastos, que es lo que pasaría hoy con `business: true`.
 */
export function decidirRuta(e: EntradaRuta): Ruta {
  if (!bandejaActiva(e.modules)) return 'bot';
  if (e.reenviado) return 'bandeja';
  if (e.sesionBotEsperando) return 'bot';
  if (e.tipo === 'text' && empiezaConPrefijoBot(e.texto, e.config.prefijosBot)) return 'bot';
  return 'bandeja';
}

/** Lo que la base contesta al registrar un mensaje (`wa_bandeja_registrar_mensaje`). */
export type AccionRegistro =
  | 'duplicado'          // Meta reintentó un mensaje ya guardado: no se hace nada
  | 'abrir'              // primer mensaje: nace una entrega
  | 'agregar'            // entra a la entrega abierta
  | 'cerrar'             // palabra de cierre con entrega abierta: se cierra y se pregunta
  | 'cierre_sin_abierta' // palabra de cierre sin nada que cerrar
  | 'respuesta_cliente'; // la respuesta a «¿de qué cliente es?»

/** Qué le dice el bot al comercial después de registrar. `null` = nada (la regla general). */
export function respuestaTrasRegistro(accion: AccionRegistro): 'pregunta' | 'nada_pendiente' | 'anotado' | null {
  switch (accion) {
    case 'cerrar': return 'pregunta';
    case 'cierre_sin_abierta': return 'nada_pendiente';
    case 'respuesta_cliente': return 'anotado';
    default: return null;
  }
}

/** La única pregunta que hace la bandeja mientras no exista el paso de entendimiento. */
export function textoPreguntaCliente(nMensajes: number): string {
  const n = Math.max(0, Math.trunc(nMensajes));
  return `Recibí ${n} ${n === 1 ? 'mensaje' : 'mensajes'}. ¿De qué cliente es?`;
}

export const TEXTO_NADA_PENDIENTE = 'No tengo mensajes pendientes por agrupar.';
export const TEXTO_ANOTADO = 'Anotado.';

export type OrigenCuerpo = 'texto' | 'pie_de_foto' | 'transcripcion' | 'interactivo' | 'ubicacion';

/**
 * El texto que se guarda como cuerpo, según el tipo. El audio NO se resuelve aquí (hay que
 * transcribirlo): para `audio` devuelve `null` y quien llama pone la transcripción.
 */
export function cuerpoDelMensaje(m: {
  type: string;
  text: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
}): { cuerpo: string | null; origen: OrigenCuerpo | null } {
  const t = (m.text || '').trim();
  switch (m.type) {
    case 'text': return { cuerpo: m.text || '', origen: 'texto' };
    case 'image': return t ? { cuerpo: m.text, origen: 'pie_de_foto' } : { cuerpo: null, origen: null };
    case 'interactive': return { cuerpo: t || null, origen: t ? 'interactivo' : null };
    case 'location': {
      const l = m.location;
      if (!l) return { cuerpo: null, origen: null };
      const etiqueta = l.name || l.address;
      return { cuerpo: etiqueta ? `${etiqueta} (${l.latitude},${l.longitude})` : `${l.latitude},${l.longitude}`, origen: 'ubicacion' };
    }
    default: return { cuerpo: null, origen: null };
  }
}

/** `timestamp` de Meta (epoch en segundos, como texto) → ISO. Sin él, `null` (la base pone now()). */
export function fechaDeMeta(timestamp: string | undefined): string | null {
  if (!timestamp || !/^\d+$/.test(timestamp)) return null;
  return new Date(Number(timestamp) * 1000).toISOString();
}
