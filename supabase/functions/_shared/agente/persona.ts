// ============================================================
// Asistentes MeTRIK — el paso a una persona, genérico por canal (spec 2026-10-26, §4.2; función común `comun.persona`)
// ------------------------------------------------------------
// Lo único que sale de un rol hacia una persona es el traspaso (§2.7), y cada uno deja su fila en
// `asistente_escalamientos` (a mejor esfuerzo: si la fila no se escribe, el traspaso sale igual).
//
// Lo configura la ficha `rol.escalamiento` del reglamento del rol (`escalamientoDe`), en dos modos:
//   · `chatwoot_equipo` (Sabor): pasa directo, sin ofrecer. Es el paso que ya existe en `publico/cola.ts`
//     (`pasarAPersona`: nota privada, etiqueta, equipo y `open`). Aquí solo viven lo común: el equipo por motivo y el
//     horario de la ficha, y la cabecera de la nota (`notaComun`); el bloque del medio lo aporta cada función.
//   · `wa_link` (ONE: el equipo de hoy, la gestión de Imperviun, Laura): un botón que abre el WhatsApp de MeTRIK (o el
//     número que ponga la ficha, p. ej. «la oficina» para operarios) con un mensaje ya escrito por el código.
//
// Las cuatro señales y quién las detecta:
//   · pide una persona, frustración, dato que no está en la base: el MODELO, con su motivo (cierre `pasar_a_persona`);
//   · dos «no pude» seguidos y tres correcciones de lo mismo: el CÓDIGO, contando en la conversación (`senalDelCodigo`).
//     Sin listas de palabras: el modelo interpreta, el código cuenta. Los umbrales son parámetro de la ficha.
// Ofrecer o pasar (wa_link): si la persona lo pide de forma explícita (`pide_persona`) sale el botón de una (`link`);
// si no, se OFRECE (el mismo botón, con la pregunta), nunca dos turnos seguidos.
// ============================================================

import { aliasConversacionWa } from './caida.ts';
import { cortarEnPalabra } from './render.ts';
import type { ContextoDominio, DeclaracionHerramienta, Dominio, FilaConversacion, Reglamento, Salida, Traza } from './tipos.ts';

export const PASAR_A_PERSONA = 'pasar_a_persona';
/** El id del motor del paso a persona en WhatsApp (`componerDominio({ motores: { one, persona } })`). */
export const MOTOR_PERSONA = 'persona';
/** El WhatsApp de MeTRIK (el de Mauricio). Distinto del número de Agus, así que el chat se abre con una persona. */
export const NUMERO_METRIK = '573159509103';

export type ModoTraspaso = 'ofrecido' | 'pasado' | 'link';
export type CanalEscalamiento = 'wa_one' | 'chatwoot' | 'wa_propio';

// ── La ficha `rol.escalamiento` ──────────────────────────────────────────────

export interface Umbrales {
  /** «No pude» seguidos (turnos con `rf.modelo_caido` o error en la traza) para ofrecer. Por defecto 2. */
  noPude: number;
  /** Correcciones de lo mismo (propuestas reemplazadas sobre lo mismo, o respuestas a la misma pregunta). Por defecto 3. */
  correcciones: number;
}

/** Hora de Bogotá. `dias`: 1 = lunes … 7 = domingo. `desde`/`hasta`: «HH:MM» (hasta exclusivo). */
export interface Horario {
  dias: number[];
  desde: string;
  hasta: string;
}

export interface EscalamientoChatwoot {
  modo: 'chatwoot_equipo';
  /** Equipo de Chatwoot por motivo (`pago`, `queja`…). */
  equipos: Record<string, number>;
  equipoPorDefecto: number | null;
  /** Sin horario, siempre se pasa igual (la variante sin horario). */
  horario: Horario | null;
  umbrales: Umbrales;
}

export interface EscalamientoWaLink {
  modo: 'wa_link';
  /** Solo dígitos, con indicativo (573159509103). */
  numero: string;
  /** Quién atiende, como lo lee la persona: «alguien de MeTRIK», «la oficina». Nunca el nombre de una persona. */
  atiende: string;
  /** El mensaje ya escrito: `{nombre}`, `{empresa}` y `{resumen}` los pone el código. */
  plantilla: string;
  /** El texto del botón (≤ 20). */
  boton: string;
  umbrales: Umbrales;
}

export type Escalamiento = EscalamientoChatwoot | EscalamientoWaLink;

export const UMBRALES_POR_DEFECTO: Umbrales = { noPude: 2, correcciones: 3 };
export const PLANTILLA_POR_DEFECTO = 'Hola, soy {nombre} de {empresa}. El asistente no pudo con: {resumen}';
export const BOTON_POR_DEFECTO = 'Abrir WhatsApp';
export const TOPE_BOTON = 20;
export const TOPE_CUERPO = 1024;

/** El de todo rol de ONE sin ficha (y del dominio ONE de hoy, sin roles): el WhatsApp de MeTRIK. */
export const ESCALAMIENTO_METRIK: EscalamientoWaLink = Object.freeze({
  modo: 'wa_link', numero: NUMERO_METRIK, atiende: 'alguien de MeTRIK', plantilla: PLANTILLA_POR_DEFECTO, boton: 'Escribir a MeTRIK',
  umbrales: UMBRALES_POR_DEFECTO,
}) as EscalamientoWaLink;

/** El de un rol de Chatwoot sin ficha: el equipo y el horario de siempre (los de `config_extra`, que pone quien llama). */
export const ESCALAMIENTO_CHATWOOT_HOY: EscalamientoChatwoot = Object.freeze({
  modo: 'chatwoot_equipo', equipos: {}, equipoPorDefecto: null, horario: null, umbrales: UMBRALES_POR_DEFECTO,
}) as EscalamientoChatwoot;

const entero = (v: unknown, min: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min ? v : null);
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function umbralesDe(v: Record<string, unknown>): Umbrales {
  return {
    noPude: entero(v.umbral_no_pude, 1) ?? UMBRALES_POR_DEFECTO.noPude,
    correcciones: entero(v.umbral_correcciones, 1) ?? UMBRALES_POR_DEFECTO.correcciones,
  };
}

function horarioDe(v: unknown): Horario | null {
  if (!v || typeof v !== 'object') return null;
  const h = v as Record<string, unknown>;
  const dias = Array.isArray(h.dias) ? h.dias.filter((d): d is number => entero(d, 1) !== null && (d as number) <= 7) : [];
  if (!dias.length || typeof h.desde !== 'string' || typeof h.hasta !== 'string' || !RE_HORA.test(h.desde) || !RE_HORA.test(h.hasta)) return null;
  return { dias, desde: h.desde, hasta: h.hasta };
}

/**
 * La ficha `rol.escalamiento` del reglamento, validada. Sin ficha, con un modo de otro canal o con datos que no sirven
 * (un número sin dígitos, una plantilla sin `{resumen}`), `porDefecto`, y queda en el log. Pura salvo el log.
 */
export function escalamientoDe<E extends Escalamiento>(r: Pick<Reglamento, 'fichas'> | null, porDefecto: E, log: (m: string) => void = (m) => console.warn(`[persona] ${m}`)): E {
  const f = r?.fichas.find((x) => x.clave === 'rol.escalamiento');
  const v = f?.valores;
  if (!v) return porDefecto;
  if (v.modo !== porDefecto.modo) {
    log(`rol.escalamiento con modo «${String(v.modo)}» en un canal de «${porDefecto.modo}»: rige el de por defecto`);
    return porDefecto;
  }
  const umbrales = umbralesDe(v);
  if (porDefecto.modo === 'chatwoot_equipo') {
    const equipos: Record<string, number> = {};
    if (v.equipos && typeof v.equipos === 'object') {
      for (const [k, x] of Object.entries(v.equipos as Record<string, unknown>)) if (entero(x, 1) !== null) equipos[k] = x as number;
    }
    return { modo: 'chatwoot_equipo', equipos, equipoPorDefecto: entero(v.equipo_por_defecto, 1), horario: horarioDe(v.horario), umbrales } as E;
  }
  const d = porDefecto as EscalamientoWaLink;
  const numero = typeof v.numero === 'string' || typeof v.numero === 'number' ? String(v.numero).replace(/\D/g, '') : '';
  if (v.numero !== undefined && (numero.length < 8 || numero.length > 15)) {
    log(`rol.escalamiento con un número que no sirve («${String(v.numero)}»): rige el de por defecto`);
    return porDefecto;
  }
  const plantilla = typeof v.plantilla === 'string' && v.plantilla.includes('{resumen}') ? v.plantilla.trim() : d.plantilla;
  const propio = numero && numero !== d.numero;
  const atiende = typeof v.atiende === 'string' && v.atiende.trim() ? v.atiende.trim() : (propio ? 'alguien del equipo' : d.atiende);
  // El botón va hasta 20 caracteres (Meta): uno más largo no se corta a media frase, rige el genérico.
  const pedido = typeof v.boton === 'string' ? v.boton.trim() : '';
  if ([...pedido].length > TOPE_BOTON) log(`rol.escalamiento con un botón de más de ${TOPE_BOTON} caracteres («${pedido}»): va «${BOTON_POR_DEFECTO}»`);
  const boton = pedido && [...pedido].length <= TOPE_BOTON ? pedido : (pedido || propio ? BOTON_POR_DEFECTO : d.boton);
  return { modo: 'wa_link', numero: numero || d.numero, atiende, plantilla, boton, umbrales } as E;
}

// ── El mensaje ya escrito (wa_link) ──────────────────────────────────────────

/**
 * Sin datos sensibles: fuera correos, links y toda cifra de cinco dígitos o más (cédulas, teléfonos, cuentas, montos),
 * en una sola línea. Pura.
 */
export function sinDatosSensibles(s: string): string {
  return s
    .replace(/\S+@\S+/g, '…')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '…')
    .replace(/\+?\d(?:[\d .,-]*\d)?/g, (m) => (m.replace(/\D/g, '').length >= 5 ? '…' : m))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lo que el traspaso dice de un motivo, en llano (va en el mensaje y en la fila si el modelo no dijo qué pidió). */
export const MOTIVO_LLANO: Record<string, string> = {
  pide_persona: 'quiero hablar con alguien',
  frustracion: 'no me entendió',
  no_entiende: 'no me entendió',
  sin_dato: 'un dato que no tiene',
  no_pude: 'responderme (falló dos veces seguidas)',
  bucle: 'lo corregí varias veces y no quedó',
  falla: 'responderme (falló)',
};

/** El resumen de una línea del traspaso: lo que pidió (sin datos sensibles) o el motivo en llano. Pura. */
export function resumenTraspaso(motivo: string, pidio?: string | null): string {
  const limpio = sinDatosSensibles(String(pidio ?? ''));
  return cortarEnPalabra(limpio || MOTIVO_LLANO[motivo] || motivo, 140);
}

/** «Hola, soy <nombre> de <empresa>. El asistente no pudo con: <resumen>». Pura. */
export function mensajeParaPersona(c: Pick<EscalamientoWaLink, 'plantilla'>, p: { nombre: string | null; empresa: string | null; resumen: string }): string {
  const nombre = sinDatosSensibles(p.nombre ?? '') || 'una persona del equipo';
  const empresa = sinDatosSensibles(p.empresa ?? '') || 'mi empresa';
  return c.plantilla.replace(/\{nombre\}/g, nombre).replace(/\{empresa\}/g, empresa).replace(/\{resumen\}/g, p.resumen);
}

/** El link de WhatsApp con el mensaje ya escrito. Pura. */
export function urlWa(numero: string, texto: string): string {
  return `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
}

/** El botón del traspaso: `link` (lo pidió) o `ofrecido` (lo ofrece el asistente). Pura. */
export function salidaTraspaso(c: EscalamientoWaLink, modo: 'link' | 'ofrecido', p: { nombre: string | null; empresa: string | null; resumen: string }): Salida {
  const texto = modo === 'link'
    ? `Te paso con ${c.atiende}: toca el botón y se abre su WhatsApp con el mensaje ya escrito. Solo envíalo.`
    : `¿Quieres hablar con ${c.atiende}? Toca el botón y se abre su WhatsApp con el mensaje ya escrito.`;
  return { tipo: 'enlace', texto: cortarEnPalabra(texto, TOPE_CUERPO), boton: cortarEnPalabra(c.boton, TOPE_BOTON), url: urlWa(c.numero, mensajeParaPersona(c, p)) };
}

// ── Las señales que cuenta el código ─────────────────────────────────────────

/** Las trazas de los turnos que contestaron algo (o fallaron), en orden. Pura. */
export function turnosDe(filas: Array<Pick<FilaConversacion, 'traza'>>): Traza[] {
  return filas.map((f) => f.traza).filter((t): t is Traza => !!t && (!!t.salida || !!t.error));
}

/** Errores del envío (Meta, Chatwoot): el turno sí contestó; no es un «no pude». */
const RE_ERROR_DE_ENVIO = /^(Meta rechazó|nota:|etiqueta|equipo|toggle_status|respuesta:|aviso:|extra:)/;

/** ¿Este turno fue un «no pude»? (`rf.modelo_caido`, o un error del turno que no es del envío). Pura. */
export function esNoPude(t: Traza): boolean {
  if (t.respuesta_fija === 'rf.modelo_caido') return true;
  return String(t.error ?? '').split('; ').some((e) => e.trim() && !RE_ERROR_DE_ENVIO.test(e.trim()));
}

const comparable = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();
const llavePropuesta = (t: Traza) => (t.propuesta ? `${t.propuesta.accion}|${t.propuesta.sobre ?? ''}` : null);

/**
 * Cuántas veces se corrigió lo mismo hasta este turno (incluido): las propuestas sobre lo mismo (acción y `sobre`) que
 * se reemplazaron sin tocarse, o los turnos seguidos con la misma pregunta del asistente. Pura.
 */
export function correccionesSeguidas(previas: Traza[], actual: Traza): number {
  const llave = llavePropuesta(actual);
  if (llave) {
    let n = 0;
    for (let i = previas.length - 1; i >= 0; i--) {
      const t = previas[i];
      if (t.ejecucion && (t.ejecucion.resultado === 'ejecutada' || t.ejecucion.resultado === 'rechazada')) break;
      const k = llavePropuesta(t);
      if (k === null) continue;
      if (k !== llave) break;
      n++;
    }
    return n;
  }
  const texto = actual.tipo === 'modelo' && actual.salida && !esNoPude(actual) ? comparable(actual.salida.texto).slice(0, 160) : '';
  if (!texto) return 0;
  let n = 0;
  for (let i = previas.length - 1; i >= 0; i--) {
    const t = previas[i];
    if (!t.salida || comparable(t.salida.texto).slice(0, 160) !== texto) break;
    n++;
  }
  return n;
}

/** ¿El turno anterior ya ofreció (o dio) el paso a una persona? Nunca dos veces seguidas. Pura. */
export function yaOfrecido(previas: Traza[]): boolean {
  const m = previas.at(-1)?.escalamiento?.modo;
  return m === 'ofrecido' || m === 'link';
}

/**
 * La señal del código en este turno, o null: `no_pude` (este y los anteriores seguidos son «no pude», hasta el umbral)
 * o `bucle` (la misma corrección o la misma pregunta, hasta el umbral). Pura.
 */
export function senalDelCodigo(previas: Traza[], actual: Traza, u: Umbrales): 'no_pude' | 'bucle' | null {
  if (esNoPude(actual)) {
    let n = 1;
    for (let i = previas.length - 1; i >= 0 && esNoPude(previas[i]); i--) n++;
    if (n >= u.noPude) return 'no_pude';
  }
  if (correccionesSeguidas(previas, actual) >= u.correcciones) return 'bucle';
  return null;
}

// ── El motor del paso a persona en WhatsApp (wa_link) ────────────────────────

export const MOTIVOS_WA = ['pide_persona', 'frustracion', 'no_entiende', 'sin_dato'] as const;
export type MotivoWa = typeof MOTIVOS_WA[number];

export const DECLARACION_PASAR_A_PERSONA_WA: DeclaracionHerramienta = {
  name: PASAR_A_PERSONA,
  description: 'Le da a la persona un botón que abre el WhatsApp de quien la atiende, con un mensaje ya escrito por el sistema. Cierra el turno: el texto lo escribe el sistema. Motivos: pide_persona (pide de forma explícita hablar con alguien, una persona o un humano: se le da de una, sin preguntar), frustracion (frustración fuerte), no_entiende (no logras entender lo que necesita), sin_dato (pregunta algo que no está en ONE ni en tus herramientas). En `pidio`, lo que necesita, en una línea y sin datos personales (sin cédulas, teléfonos, cuentas ni montos).',
  parameters: {
    type: 'object',
    properties: {
      motivo: { type: 'string', enum: [...MOTIVOS_WA] },
      pidio: { type: 'string', description: 'Lo que necesita, en una línea, sin datos personales.' },
      reglas_usadas: { type: 'array', items: { type: 'string' } },
    },
    required: ['motivo', 'pidio'],
  },
};

/** Lo que el cierre deja en `privado` y lee la cola para la traza y la fila. */
export interface TraspasoPrivado {
  escalamiento: { modo: 'ofrecido' | 'link'; motivo: string; resumen: string };
}

/**
 * El motor `persona` para los canales de WhatsApp: un solo cierre, `pasar_a_persona`. Copia del motor principal las
 * banderas del dominio (bot, reenvíos, vencimiento de propuestas, ventana de adjuntos): si el rol no tiene otra función,
 * el dominio compuesto sigue siendo el mismo bot.
 */
export function dominioPersona(o: {
  config: EscalamientoWaLink;
  empresa: string | null;
  base: Pick<Dominio, 'bot' | 'reenvios' | 'propuestaVenceConRespuesta' | 'ventanaAdjuntosMs'>;
}): Dominio {
  const { bot, reenvios, propuestaVenceConRespuesta, ventanaAdjuntosMs } = o.base;
  return {
    bot,
    ...(reenvios ? { reenvios } : {}),
    ...(propuestaVenceConRespuesta !== undefined ? { propuestaVenceConRespuesta } : {}),
    ...(ventanaAdjuntosMs !== undefined ? { ventanaAdjuntosMs } : {}),
    lecturas: [],
    acciones: [],
    datosProponer: {},
    cierres: [DECLARACION_PASAR_A_PERSONA_WA],
    leer: async (nombre) => ({ ok: false, datos: null, error: `No existe la herramienta «${nombre}».` }),
    proponer: async () => ({ ok: false, error: 'Acción desconocida.', candado: 'accion_desconocida' }),
    ejecutar: async (p) => { throw new Error(`el paso a persona no ejecuta acciones («${p.accion}»)`); },
    async cerrar(nombre: string, args: Record<string, unknown>, ctx: ContextoDominio) {
      if (nombre !== PASAR_A_PERSONA) return { ok: false as const, error: `No existe la herramienta «${nombre}».`, candado: 'cierre_desconocido' };
      const motivo = String(args.motivo ?? '');
      if (!(MOTIVOS_WA as readonly string[]).includes(motivo)) {
        return { ok: false as const, error: `Motivo desconocido. Usa uno de: ${MOTIVOS_WA.join(', ')}.`, candado: 'motivo_desconocido' };
      }
      // Lo pidió: de una, siempre. Si no lo pidió, se ofrece, y nunca dos turnos seguidos.
      const modo: 'link' | 'ofrecido' = motivo === 'pide_persona' ? 'link' : 'ofrecido';
      if (modo === 'ofrecido' && yaOfrecido(turnosDe(ctx.conversacion))) {
        return { ok: false as const, error: 'En tu mensaje anterior ya le ofreciste hablar con una persona: no lo repitas. Contesta lo que puedas con `responder`; si ahora pide una persona, usa pasar_a_persona con motivo pide_persona.', candado: 'persona_ya_ofrecida' };
      }
      const resumen = resumenTraspaso(motivo, String(args.pidio ?? ''));
      const salida = salidaTraspaso(o.config, modo, { nombre: ctx.remitente.nombre, empresa: o.empresa, resumen });
      const privado: TraspasoPrivado = { escalamiento: { modo, motivo, resumen } };
      return { ok: true as const, salidas: [salida], datos: { motivo, modo }, privado };
    },
  };
}

// ── Después del turno: la señal del código y la marca en la traza ────────────

export interface TraspasoDelTurno {
  modo: ModoTraspaso;
  motivo: string;
  resumen: string;
  senal: 'modelo' | 'codigo';
}

/**
 * El traspaso de este turno en wa_link, y la traza marcada (`traza.escalamiento`). Si el modelo llamó
 * `pasar_a_persona`, ese. Si no, la señal del código: el botón se OFRECE como un mensaje más, debajo de lo que el turno
 * ya iba a decir (en un «no pude», debajo de la respuesta fija), salvo que el turno anterior ya lo haya ofrecido.
 * Muta el resultado del turno (`salida`, `extras`, `traza`). Pura salvo eso.
 */
export function traspasoWa(
  r: { salida: Salida | null; extras?: Salida[]; traza: Traza },
  filas: Array<Pick<FilaConversacion, 'traza'>>,
  c: EscalamientoWaLink,
  p: { nombre: string | null; empresa: string | null },
): TraspasoDelTurno | null {
  const delModelo = [...(r.traza.herramientas ?? [])].reverse().find((h) => h.nombre === PASAR_A_PERSONA && h.ok);
  const pv = (delModelo?.privado as TraspasoPrivado | undefined)?.escalamiento;
  if (pv) {
    r.traza.escalamiento = { modo: pv.modo, motivo: pv.motivo, senal: 'modelo', resumen: pv.resumen };
    return { ...pv, senal: 'modelo' };
  }
  const previas = turnosDe(filas);
  const senal = senalDelCodigo(previas, r.traza, c.umbrales);
  if (!senal || yaOfrecido(previas)) return null;
  const resumen = senal === 'bucle' && r.traza.propuesta
    ? cortarEnPalabra(`${MOTIVO_LLANO.bucle} (${r.traza.propuesta.accion})`, 140)
    : MOTIVO_LLANO[senal];
  const oferta = salidaTraspaso(c, 'ofrecido', { ...p, resumen });
  if (r.salida) {
    r.extras = [...(r.extras ?? []), oferta];
    r.traza.salidas_extra = [...(r.traza.salidas_extra ?? []), oferta];
  } else {
    r.salida = oferta;
    r.traza.salida = oferta;
  }
  r.traza.escalamiento = { modo: 'ofrecido', motivo: senal, senal: 'codigo', resumen };
  return { modo: 'ofrecido', motivo: senal, resumen, senal: 'codigo' };
}

// ── La fila de `asistente_escalamientos` ─────────────────────────────────────

export interface FilaEscalamiento {
  workspace_id: string;
  rol_clave: string;
  canal: CanalEscalamiento;
  /** Por alias: en WhatsApp, `wa-` + 10 hex del sha-256 (nunca el teléfono); en Chatwoot, `cw:<cuenta>:<conversación>`. */
  conversacion: string;
  motivo: string;
  /** Lo arma el código; nunca un dato sensible. */
  resumen: string;
  modo: ModoTraspaso;
}

export interface PuertoEscalamientos {
  registrar(f: FilaEscalamiento): Promise<void>;
}

/** Escribe la fila a mejor esfuerzo: si falla, queda en el log y el traspaso sigue. Nunca lanza. Devuelve si quedó. */
export async function registrarEscalamiento(p: PuertoEscalamientos | null | undefined, f: FilaEscalamiento): Promise<boolean> {
  if (!p) return false;
  try {
    await p.registrar({ ...f, resumen: sinDatosSensibles(f.resumen).slice(0, 300) || f.motivo });
    return true;
  } catch (err) {
    console.error('[persona] no se escribió la fila de asistente_escalamientos (el traspaso salió igual):', err);
    return false;
  }
}

/**
 * El alias de una conversación de WhatsApp que no deja ver el teléfono: el mismo de los correos de caída (§4.1,
 * `caida.ts`), para cruzar los dos.
 */
export { aliasConversacionWa };

// ── Chatwoot (chatwoot_equipo): equipo, horario y la cabecera de la nota ─────

/** El equipo de un motivo: el de la ficha, su por defecto, o el de siempre (`config_extra`). Pura. */
export function equipoDe(c: EscalamientoChatwoot, motivo: string, deSiempre: Partial<Record<string, number>>): number | null {
  return c.equipos[motivo] ?? c.equipoPorDefecto ?? deSiempre[motivo] ?? null;
}

/** ¿Está dentro del horario? Sin horario, siempre. En hora de Bogotá (UTC-5, sin horario de verano). Pura. */
export function dentroDeHorario(h: Horario | null, ahoraMs: number): boolean {
  if (!h) return true;
  const b = new Date(ahoraMs - 5 * 3600 * 1000);
  const dia = b.getUTCDay() === 0 ? 7 : b.getUTCDay();
  const hhmm = `${String(b.getUTCHours()).padStart(2, '0')}:${String(b.getUTCMinutes()).padStart(2, '0')}`;
  if (!h.dias.includes(dia)) return false;
  return h.desde <= h.hasta ? hhmm >= h.desde && hhmm < h.hasta : hhmm >= h.desde || hhmm < h.hasta;
}

/**
 * La nota privada del paso a persona, con la cabecera común: motivo y qué pidió arriba; qué consultó y el siguiente
 * paso abajo. En el medio, los bloques que aporta cada función (la reserva tomada, la autorización…). Pura.
 */
export function notaComun(p: { motivo: string; pidio: string; bloques: string[][]; consulto: string[]; siguiente: string; fueraDeHorario?: Horario | null }): string {
  return [
    `[Asistente] Paso a persona · motivo: ${p.motivo}`,
    `Pidió: ${p.pidio || '(ver el chat)'}`,
    ...p.bloques.flat(),
    ...(p.consulto.length ? [`Consultó: ${[...new Set(p.consulto)].join(', ')}`] : []),
    `Siguiente paso: ${p.siguiente}`,
    ...(p.fueraDeHorario ? [`Fuera de horario (${p.fueraDeHorario.desde}-${p.fueraDeHorario.hasta}): contestar al abrir.`] : []),
  ].join('\n');
}
