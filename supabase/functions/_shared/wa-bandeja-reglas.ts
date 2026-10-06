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
import { leerHibrido } from './wa-hibrido.ts';

export const LLAVE_BANDEJA = 'bandeja_solicitudes_wa';

/** Lo que el workspace puede ajustar en `config_extra.bandeja_solicitudes`. */
export interface ConfigBandeja {
  /** Minutos sin mensajes nuevos tras los cuales la entrega se cierra sola. */
  ventanaMinutos: number;
  /** Palabras que, escritas solas, cierran la entrega en el acto. */
  palabrasCierre: string[];
  /**
   * Primeras palabras que mandan un mensaje escrito al bot de siempre (gastos, consultas)
   * aunque la bandeja esté encendida. Solo aplica a lo que NO viene reenviado. Incluye los
   * `prefijosConsulta`.
   */
  prefijosBot: string[];
  /**
   * Prefijos de CONSULTA al bot de siempre («bot ¿cuánto vendimos en septiembre?»): mandan el
   * escrito al bot como `prefijosBot` y además se quitan antes de que el bot lo lea. Con la
   * bandeja encendida, todo lo escrito va a la bandeja (prueba en vivo del 2026-10-01): esta es la
   * puerta para preguntarle algo al bot. `config_extra.bandeja_solicitudes.prefijos_consulta`.
   */
  prefijosConsulta: string[];
  /** Horas durante las cuales el primer mensaje escrito cuenta como respuesta a «¿de qué cliente es?». */
  horasRespuestaCliente: number;
  /**
   * Cuántos viajes puede traer una entrega (encargo 2026-10-01, varios viajes en simultáneo):
   *   · `uno` (default): como siempre, la entrega es un viaje;
   *   · `encabezado`: un escrito corto que nombra un viaje («Carolina», «T1 26 9», «nuevo Luisa»)
   *     fija el viaje de todo lo que sigue (manda el encabezado; decisión de Mauricio, 2026-10-01).
   *     Una tanda sin encabezados es un viaje y se pregunta como en `uno`. Con encabezados, el bot
   *     muestra el reparto y NO carga nada hasta el «sí».
   */
  modoViajes: ModoViajes;
  /** `siempre` (default y único en uso hasta que el QA y el uso real digan otra cosa) | `si_duda`. */
  confirmar: 'siempre' | 'si_duda';
  /**
   * Minutos durante los cuales el último viaje que el bot cargó, mostró o nombró con un remitente sigue «en foco»: una
   * pregunta o un dato sin referencia va a ese viaje (conversación con memoria, 2026-10-05). `minutos_foco`.
   */
  minutosFoco: number;
  /** Horas que dura vigente un encabezado. */
  horasCajaActiva: number;
  /**
   * El bot híbrido (2026-10-06): `config_extra.bot_conversacional.hibrido`. Prendido, las preguntas que esperan una
   * elección son puntos de decisión (`wa-decision.ts`); apagado (por defecto), todo sigue como antes.
   */
  hibrido: boolean;
}

export type ModoViajes = 'uno' | 'encabezado';
export const MODOS_VIAJES: readonly ModoViajes[] = ['uno', 'encabezado'];

export const CONFIG_BANDEJA_POR_DEFECTO: ConfigBandeja = {
  ventanaMinutos: 5,
  palabrasCierre: ['listo'],
  prefijosBot: ['gasto', 'bot'],
  prefijosConsulta: ['bot'],
  horasRespuestaCliente: 24,
  modoViajes: 'uno',
  confirmar: 'siempre',
  horasCajaActiva: 4,
  minutosFoco: 60,
  hibrido: false,
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
  const hibrido = leerHibrido((configExtra as { bot_conversacional?: unknown } | null)?.bot_conversacional);
  if (!raw || typeof raw !== 'object') return { ...d, hibrido };
  return {
    ventanaMinutos: entero(raw.ventana_minutos, 1, 120, d.ventanaMinutos),
    palabrasCierre: listaDePalabras(raw.palabras_cierre, d.palabrasCierre),
    // Un prefijo de consulta es también un prefijo del bot: se suman, sin repetir.
    prefijosBot: [...new Set([...listaDePalabras(raw.prefijos_bot, ['gasto']), ...listaDePalabras(raw.prefijos_consulta, d.prefijosConsulta)])],
    prefijosConsulta: listaDePalabras(raw.prefijos_consulta, d.prefijosConsulta),
    horasRespuestaCliente: entero(raw.horas_respuesta_cliente, 1, 168, d.horasRespuestaCliente),
    modoViajes: MODOS_VIAJES.includes(raw.modo_viajes as ModoViajes) ? (raw.modo_viajes as ModoViajes) : d.modoViajes,
    // Un valor desconocido cae a `siempre`: confirmar de más cuesta un mensaje, de menos un dato.
    confirmar: raw.confirmar === 'si_duda' ? 'si_duda' : 'siempre',
    horasCajaActiva: entero(raw.horas_caja_activa, 1, 24, d.horasCajaActiva),
    minutosFoco: entero(raw.minutos_foco, 5, 720, d.minutosFoco),
    hibrido,
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

/**
 * `guia`: un pedido de guía escrito («ayuda», «¿cómo funciona?»). Se contesta con la guía de la
 * bandeja (`textoGuiaBandeja`) y no toca nada más: ni abre tanda, ni entra a la abierta, ni contesta
 * la pregunta pendiente.
 */
export type Ruta = 'bandeja' | 'bot' | 'guia';

/** Lo que pide la guía, escrito SOLO (el mensaje completo, normalizado con `normalizarGuia`). */
export const PEDIDOS_DE_GUIA: readonly string[] = [
  'ayuda', 'guia', 'como funciona', 'como funciona esto', 'como se usa', 'instrucciones', 'menu',
];

/** Minúsculas, sin tildes, sin signos ni emojis, espacios colapsados: «¡¿Cómo funciona?!» → «como funciona». */
export function normalizarGuia(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿El texto entero es un pedido de guía? «Ayuda!», «AYUDA», «¿cómo funciona?», «menú», «?» sí;
 * «necesito ayuda con el hotel» o «el menú del hotel» no: solo el mensaje completo cuenta. «?» solo
 * (o «¿?», «??») también: sin letras, la normalización lo dejaría vacío.
 */
export function esPedidoDeGuia(texto: string): boolean {
  const crudo = String(texto ?? '').replace(/\s+/g, '');
  if (/^[¿?]+$/.test(crudo) && crudo.includes('?')) return true;
  return PEDIDOS_DE_GUIA.includes(normalizarGuia(texto));
}

/**
 * La guía de la bandeja, formato WhatsApp. Los prefijos y la palabra de cierre salen de la config
 * del workspace (default: «bot», «gasto», «listo»). Cada afirmación está verificada contra el código
 * (2026-10-02): el encabezado exacto se confirma con «📌» (`respuestaAlEncabezado`), «nuevo X» abre un
 * viaje nuevo, el nombre del negocio y el código son encabezado (`resolverEncabezado`), con
 * `confirmar: siempre` nada se carga sin el «sí», y la carga dice lo entendido, la línea de avance
 * («Mínimo 7/9») y lo que falta (`mensajeAlComercial`). Las fotos solo aportan su pie (`cuerpoDelMensaje`).
 */
export function textoGuiaBandeja(config: Pick<ConfigBandeja, 'prefijosBot' | 'prefijosConsulta' | 'palabrasCierre'> = CONFIG_BANDEJA_POR_DEFECTO): string {
  const consulta = config.prefijosConsulta[0] ?? 'bot';
  const gasto = config.prefijosBot.find(p => !config.prefijosConsulta.includes(p)) ?? 'gasto';
  const cierre = config.palabrasCierre[0] ?? 'listo';
  return [
    '*Cómo pasarle una solicitud de viaje al bot* ✈️',
    '',
    '*1. Di de quién es*',
    'Escríbeme el cliente o el viaje:',
    '• Viaje nuevo: `nuevo viaje` o `nuevo Carolina Ruiz` (si ya es cliente, lo busco yo)',
    '• Viaje que ya existe: `Carolina Ruiz`, `Europa 2 días` o el código',
    'Espera el 📌 con el viaje.',
    '',
    '*2. Pásame lo del cliente*',
    'Reenvía los mensajes y audios del cliente, o escribe lo que te dijo. Para cambiar de cliente, escribe primero el nombre del otro.',
    '',
    `*3. Cierra con* \`${cierre}\``,
    'Te muestro un resumen. Si está bien, responde `sí`. Sin el `sí` no cargo nada.',
    '',
    '*4. Lee lo que entendí*',
    'Te digo qué cargué, cuánto lleva («Mínimo 7/9») y qué falta preguntarle al cliente.',
    '',
    '*Bueno saber*',
    `• Los gastos siguen igual: empieza con \`${gasto}\`.`,
    `• Para preguntarme algo, empieza con \`${consulta}\`.`,
    '• No leo lo que hay dentro de las fotos ni los pantallazos, solo el texto que escribas.',
    '• Escribe `ayuda` cuando quieras volver a ver esto.',
  ].join('\n');
}

/** La guía con la config por defecto. */
export const TEXTO_GUIA_BANDEJA = textoGuiaBandeja(CONFIG_BANDEJA_POR_DEFECTO);

/** ¿El escrito es una pregunta? Con signo de interrogación (al abrir o al cerrar). */
export function esPregunta(texto: string): boolean {
  return /[¿?]/.test(String(texto ?? ''));
}

/** El texto sin el prefijo de consulta («bot ¿cuánto vendimos?» → «¿cuánto vendimos?»). `null` si no lo trae o no queda nada. */
export function quitarPrefijoConsulta(texto: string, prefijos: ReadonlyArray<string>): string | null {
  const bruto = String(texto ?? '').trim();
  const m = /^(\S+?)[\s:;,.!]+([\s\S]+)$/.exec(bruto);
  if (!m || !prefijos.includes(normalizar(m[1]))) return null;
  const resto = m[2].trim();
  return resto ? resto : null;
}

/** «cancelar» escrito solo: corta la conversación del bot que está a medias y vuelve a la bandeja. */
export function esCancelar(texto: string): boolean {
  return /^(cancelar|cancela|cancelalo|cancelar todo|salir)$/.test(normalizar(texto));
}

/**
 * Estados de `bot_sessions` donde una RESPUESTA esperada es un código de negocio («¿En cuál
 * negocio registro este gasto? … escribe el código»). Ahí un código no corta la conversación.
 */
export const ESTADOS_QUE_ESPERAN_CODIGO: readonly string[] = ['awaiting_selection'];

/**
 * ¿Este escrito corta la conversación del bot que está a medias? Solo dos cosas la cortan
 * (prueba en vivo del 2026-10-01, falla 2: el flujo de actividades atrapaba al comercial):
 *   · «cancelar» escrito solo;
 *   · un encabezado reconocido («nuevo Laura», «Carolina Ruiz», «Europa 2 días»). Un CÓDIGO no la
 *     corta cuando el bot espera justo un código (`awaiting_selection`): es su respuesta.
 * `null`: el escrito es para el bot.
 */
export function salidaDeLaSesion(p: {
  texto: string;
  /** Lo que es el escrito como encabezado: por código, por nombre, o no es encabezado. */
  encabezado: 'codigo' | 'nombre' | null;
  estadoSesion: string | null;
}): 'cancelar' | 'encabezado' | null {
  if (esCancelar(p.texto)) return 'cancelar';
  if (p.encabezado === 'nombre') return 'encabezado';
  if (p.encabezado === 'codigo' && !ESTADOS_QUE_ESPERAN_CODIGO.includes(p.estadoSesion ?? '')) return 'encabezado';
  return null;
}

export interface EntradaRuta {
  /** `workspaces.modules` del remitente. */
  modules: Record<string, unknown> | null | undefined;
  config: ConfigBandeja;
  tipo: string;
  texto: string;
  reenviado: boolean;
  /** Hay una conversación del bot a medias (p. ej. un gasto esperando la foto del soporte). */
  sesionBotEsperando: boolean;
  /** Si hay conversación a medias: si este escrito la corta (`salidaDeLaSesion`). */
  salidaDeSesion?: 'cancelar' | 'encabezado' | null;
}

/**
 * A dónde va un mensaje de un remitente YA identificado. Con la bandeja encendida MANDA LA
 * BANDEJA (prueba en vivo del 2026-10-01, coherente con «el encabezado manda»): todo lo del
 * comercial va a la bandeja. Orden de las reglas:
 *
 *   1. bandeja apagada en su workspace → el bot de siempre (nada cambia para nadie más);
 *   2. reenviado → bandeja, siempre: un reenvío es material de una solicitud, y ni siquiera un
 *      gasto a medias puede tragárselo;
 *   3. escrito que empieza por un prefijo del bot («gasto …», «bot …») → el bot;
 *   3b. pedido de guía escrito SOLO («ayuda», «¿cómo funciona?», `esPedidoDeGuia`) → `guia`: se contesta
 *      con la guía y nada más. No abre tanda, no entra a la abierta y no contesta la pregunta pendiente
 *      (la respuesta siguiente la contesta). Va antes de la 4: la conversación del bot a medias tampoco
 *      se lo traga, y sigue a medias;
 *   4. conversación del bot de verdad a medias (un gasto esperando su foto) → el bot, salvo que el
 *      escrito la corte («cancelar» o un encabezado reconocido): entonces vuelve a la bandeja;
 *   5. todo lo demás → bandeja: notas de voz, fotos, encabezados, lo escrito con o sin tanda
 *      abierta, y también una pregunta escrita (para consultar al bot está el prefijo «bot»).
 *
 * Se fue la regla N8 (un escrito suelto sin tanda iba al bot): producía la carrera del encabezado
 * (el escrito que llega antes de que el encabezado quede registrado se iba al bot de actividades),
 * dejaba al comercial atrapado en ese flujo y un escrito sin encabezado nunca recibía «¿A qué viaje
 * van?».
 */
export function decidirRuta(e: EntradaRuta): Ruta {
  if (!bandejaActiva(e.modules)) return 'bot';
  if (e.reenviado) return 'bandeja';
  if (e.tipo === 'text' && empiezaConPrefijoBot(e.texto, e.config.prefijosBot)) return 'bot';
  if (e.tipo === 'text' && esPedidoDeGuia(e.texto)) return 'guia';
  if (e.sesionBotEsperando) return e.tipo === 'text' && e.salidaDeSesion ? 'bandeja' : 'bot';
  return 'bandeja';
}

/**
 * ¿Hay que esperar a los mensajes que vienen en camino antes de decidir qué es este escrito?
 * Meta manda cada mensaje en un webhook aparte y se procesan en paralelo: un escrito puede llegar
 * ANTES de que su encabezado, mandado 1 a 3 segundos antes, quede registrado (latencia medida en
 * vivo: 1,5 a 6,2 s). Mientras no haya tanda abierta, un escrito con una pregunta pendiente se
 * tomaría como la RESPUESTA, y una palabra de cierre cerraría antes de que entre lo que se mandó
 * antes. Solo en esos dos casos se espera, y en el primero solo si el escrito NO tiene forma de
 * respuesta: un «sí» que esperara podría quedar dentro de la tanda que abre un encabezado mandado
 * después. Lo demás entra sin demora (un mensaje que llega antes que su encabezado abre la tanda, y
 * el orden lo arregla la hora de Meta: `ordenarPorEnvio`).
 */
export function hayQueEsperarEnVuelo(p: {
  escrito: boolean; esEncabezado: boolean; esCierre: boolean; hayAbierta: boolean; hayPregunta: boolean;
  /** Tiene forma de respuesta (`pareceRespuesta`): un «sí», un número, un nombre corto. Esa no espera. */
  pareceRespuesta: boolean;
}): boolean {
  if (!p.escrito || p.esEncabezado) return false;
  return p.esCierre || (!p.hayAbierta && p.hayPregunta && !p.pareceRespuesta);
}

/** Cuánto se espera a los mensajes en camino (ms): por encima de la latencia de registro medida en vivo. */
export const ESPERA_EN_VUELO_MS = 6000;

/** Lo que contesta el bot cuando «cancelar» corta una conversación del bot a medias. */
export const TEXTO_SESION_CANCELADA = 'Listo, cancelé lo que el bot esperaba. Lo que escribas ahora va a la bandeja de solicitudes.';

/** La pista cuando una pregunta escrita abre una tanda: quizá era para el bot de siempre. */
export function textoPistaConsulta(prefijos: ReadonlyArray<string>): string {
  const p = prefijos[0] ?? 'bot';
  return `Lo guardé con las solicitudes de viaje. Si era una consulta para el bot, escríbela empezando con «${p}», por ejemplo: «${p} ¿cuánto vendimos en septiembre?».`;
}

/**
 * La hora con la que se ORDENAN los mensajes de una entrega: la de Meta (`enviado_at`, cuando el
 * comercial lo mandó) si es fresca, para que un mensaje registrado antes que su encabezado quede
 * después de él; la de llegada (`recibido_at`) si la de Meta falta o está lejos de la llegada (un
 * reenvío podría traer la hora del mensaje original: no se arriesga el orden de la tanda).
 */
export const HOLGURA_HORA_META_MS = 120_000;

export function momentoDelMensaje(m: { enviado_at?: string | null; recibido_at?: string | null }): number {
  const recibido = m.recibido_at ? Date.parse(m.recibido_at) : NaN;
  const enviado = m.enviado_at ? Date.parse(m.enviado_at) : NaN;
  if (Number.isNaN(recibido)) return Number.isNaN(enviado) ? 0 : enviado;
  if (Number.isNaN(enviado)) return recibido;
  const lag = recibido - enviado;
  return lag >= -10_000 && lag <= HOLGURA_HORA_META_MS ? enviado : recibido;
}

/** Los mensajes en el orden en que el comercial los mandó (ver `momentoDelMensaje`); empate: llegada. */
export function ordenarPorEnvio<T extends { enviado_at?: string | null; recibido_at?: string | null }>(ms: ReadonlyArray<T>): T[] {
  return [...ms].sort((a, b) => momentoDelMensaje(a) - momentoDelMensaje(b)
    || String(a.recibido_at ?? '').localeCompare(String(b.recibido_at ?? '')));
}

// ── Cuando el entendimiento falla (prueba en vivo v2 del 2026-10-01) ─────────

/**
 * Los dos avisos de una carga que falla: al primer error y al agotar los intentos. Antes el bot se
 * callaba: con Gemini caído por cobro, dos entregas quedaron en error y el comercial no se enteró.
 */
export function textoFallaEntendimiento(cuando: 'primero' | 'agotado', nombre: string, referencia: string): string {
  return cuando === 'primero'
    ? `No pude procesar los mensajes de ${nombre} por un problema técnico; los reintento solo.`
    : `No pude cargar ${nombre}. Los mensajes quedan guardados; cuando quieras, escribe «reintentar ${referencia}».`;
}

/** «REINTENTAR L 26 3» → «L 26 3»; «reintentar» solo → «». `null`: no es la palabra. */
export function leerReintentar(texto: string): string | null {
  const m = /^\s*reintentar\b[\s:,.-]*([\s\S]*)$/i.exec(String(texto ?? ''));
  return m ? m[1].trim() : null;
}

/**
 * Cuál carga fallida pide reintentar el comercial: la que tiene esa referencia tal cual (código o
 * nombre, sin tildes, mayúsculas ni espacios), o la única cuyo nombre contiene todas sus palabras. Sin
 * objetivo, la única que haya.
 */
export function elegirFallida(
  objetivo: string, fallidas: ReadonlyArray<{ id: string; referencias: ReadonlyArray<string> }>,
): { tipo: 'una'; id: string } | { tipo: 'ninguna' } | { tipo: 'varias' } {
  const compacto = (x: string) => normalizar(x).replace(/[^a-z0-9]/g, '');
  const o = compacto(objetivo);
  if (!o) return fallidas.length === 1 ? { tipo: 'una', id: fallidas[0].id } : fallidas.length === 0 ? { tipo: 'ninguna' } : { tipo: 'varias' };
  const exactas = fallidas.filter(f => f.referencias.some(r => compacto(r) === o));
  const palabras = normalizar(objetivo).split(' ').filter(Boolean);
  const elegidas = exactas.length > 0 ? exactas
    : fallidas.filter(f => f.referencias.some(r => palabras.every(w => normalizar(r).split(/[^a-z0-9]+/).includes(w))));
  if (elegidas.length === 1) return { tipo: 'una', id: elegidas[0].id };
  return elegidas.length === 0 ? { tipo: 'ninguna' } : { tipo: 'varias' };
}

/** Lo que contesta REINTENTAR cuando no sabe cuál: las cargas fallidas que hay, o que no hay ninguna. */
export function textoReintentarSinElegir(objetivo: string, referencias: ReadonlyArray<string>): string {
  if (referencias.length === 0) return 'No tengo ninguna carga fallida para reintentar.';
  const cab = objetivo.trim() ? `¿Cuál reintento? No sé cuál es «${objetivo.trim()}».` : '¿Cuál reintento? Hay más de una carga fallida.';
  return [cab, 'Escribe «reintentar» y una de estas:', ...referencias.map(r => `- ${r}`)].join('\n');
}

/**
 * «descartar» o «cancelar» ESCRITOS solos, en cualquier momento (Trappvel, 2026-10-02, regla 4):
 * descartan TODO lo pendiente del remitente (la tanda abierta, las entregas que esperan su pregunta o
 * su respuesta, los entendimientos que esperan una respuesta). Cualquier mayúscula, con o sin tilde:
 * «DESCARTAR», «Descártalo», «descartar todo», «cancelar». «descartar el 3» no: esa es una
 * corrección del resumen y sigue igual.
 */
export function esDescartarTodo(texto: string): boolean {
  return esCancelar(texto)
    || /^(descartar|descarta|descartalo|descartala|descartalos|descartalas|descarte|descartar todo|descarta todo|descartalo todo|descartar todos|descartar todo eso|borrar todo|borra todo)$/.test(normalizar(texto));
}

/** Una parte de lo descartado: cómo se llama (el viaje o «Tanda de las 09:28») y cuántos mensajes tenía. */
export interface ParteDescartada { nombre: string; n: number }

/** Lo que contesta «descartar» sin nada pendiente. */
export const TEXTO_NADA_QUE_DESCARTAR = 'No tienes nada pendiente para descartar.';

/**
 * La confirmación de «descartar»: de qué y cuántos mensajes (los del resumen: sin encabezados ni
 * respuestas). «Descarté lo pendiente de Laura Prueba5 y la tanda de las 09:28 (3 mensajes). No creé ni
 * cargué nada.»
 */
export function textoDescarteTotal(partes: ReadonlyArray<ParteDescartada>): string {
  if (partes.length === 0) return TEXTO_NADA_QUE_DESCARTAR;
  const n = partes.reduce((a, p) => a + Math.max(0, p.n), 0);
  const nombres = [...new Set(partes.map(p => (/^Tanda de las /.test(p.nombre) ? p.nombre.replace(/^Tanda de las /, 'la tanda de las ') : p.nombre)))];
  const lista = nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
  const cuantos = n === 0 ? 'sin mensajes' : `${n} ${n === 1 ? 'mensaje' : 'mensajes'}`;
  return `Descarté lo pendiente de ${lista} (${cuantos}). No creé ni cargué nada.`;
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
    // Sin «Anotado.» (prueba en vivo del 2026-10-01): el siguiente mensaje útil ya confirma.
    case 'respuesta_cliente': return null;
    default: return null;
  }
}

/** La única pregunta que hace la bandeja mientras no exista el paso de entendimiento. */
export function textoPreguntaCliente(nMensajes: number): string {
  const n = Math.max(0, Math.trunc(nMensajes));
  return `¿De qué cliente ${n === 1 ? 'es el mensaje' : `son los ${n} mensajes`}?`;
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
