// ============================================================
// Preguntas al bot dentro de la bandeja, sin prefijo — las reglas, sin I/O
// ------------------------------------------------------------
// Prueba de Mauricio en Trappvel (2026-10-05, 09:26): tras «Vamos a hacer una nueva cotización para …», escribió
// «Que viajes tiene abiertos?» y el bot contestó «¿Qué hago con esto?». Dentro de la bandeja una consulta solo se
// atendía con el prefijo «bot». Ahora una pregunta ESCRITA por el comercial sobre la bandeja (los viajes abiertos
// de un cliente, cómo va o qué le falta a un viaje, qué lleva la tanda) se contesta en el acto, en solo lectura, y
// nunca entra como contenido de la tanda. «tiene», «ese cliente», «él» son el cliente de la tanda abierta.
//
// La frontera entre lo que el comercial le pregunta al bot y lo que el cliente pregunta:
//   1. Un REENVÍO nunca es una consulta (el marcador de reenviado de WhatsApp, `message.reenviado`): «¿cuánto
//      cuesta?» reenviado es lo que pidió el cliente y va a la tanda, como siempre.
//   2. Lo ESCRITO es una consulta solo si es una pregunta (o «dime / muéstrame …») sobre algo que el bot sabe del
//      sistema, con un vocabulario cerrado (viajes abiertos, qué falta, cómo va, qué llevo / qué hay en la tanda).
//      Lo demás escrito sigue siendo contenido o un encabezado, como hoy («quiere saber cuánto cuesta el hotel»).
//   3. Un escrito que RELATA lo que preguntó el cliente («me pregunta qué viajes hay a Cancún», «dice que …») no es
//      una consulta: es contenido.
// ============================================================

import { normalizarNombre, normalizarTexto } from './wa-entendimiento-reglas.ts';
import { codigoCompacto, ejemploDeReferencia } from './wa-carga-reglas.ts';

export type ConsultaBandeja =
  /** Los viajes abiertos de un cliente. `cliente`: el que nombra; `null`: el de la tanda abierta («¿qué viajes tiene?»). */
  | { tipo: 'viajes'; cliente: string | null }
  /** Cómo va o qué le falta a un viaje. `ref`: el código o el nombre que nombra; `null`: el de la tanda abierta. */
  | { tipo: 'viaje'; ref: string | null }
  /** Qué lleva la tanda abierta. */
  | { tipo: 'tanda' };

/** «me pregunta …», «dice que …», «quiere saber …»: el comercial relata lo que preguntó el cliente. */
const RELATA = /^(?:(?:el|la)\s+(?:cliente|clienta|senor|senora)\s+)?(?:me\s+)?(?:pregunta|preguntan|pregunto|dice|dicen|dijo|quiere\s+saber|quieren\s+saber|consulta|consultan|escribio|escribe)\b/;
/** Lo que le pide al bot sin signo de pregunta: «dime qué viajes tiene», «muéstrame los viajes de Lina». */
const PIDE = /^(?:(?:bueno|ok|oye|oiga|y)\s+)?(?:dime|digame|dame|deme|muestrame|mostrame|muestreme|ensename|listame|pasame|recuerdame|revisa|revisame|mira)\b/;
/** Lo que no es parte del nombre del cliente en «¿qué viajes tiene abiertos X?». */
const NO_ES_NOMBRE: ReadonlySet<string> = new Set([
  'que', 'cuales', 'cuantos', 'viajes', 'viaje', 'cotizaciones', 'negocios', 'tiene', 'tienen', 'hay', 'abiertos', 'abiertas', 'abierto', 'abierta',
  'ahora', 'ya', 'otros', 'otras', 'mas', 'el', 'la', 'los', 'las', 'de', 'del', 'para', 'a', 'al', 'cliente', 'clienta', 'ese', 'esa', 'este', 'esta',
  'mismo', 'misma', 'senor', 'senora', 'don', 'dona', 'el', 'ella', 'dime', 'digame', 'dame', 'muestrame', 'mostrame', 'listame', 'pasame', 'revisa',
  'mira', 'y', 'oye', 'bueno', 'ok', 'por', 'favor', 'porfa', 'en', 'con', 'nosotros', 'todavia', 'aun', 'cuantas', 'se', 'le', 'me', 'lista',
  'todo', 'todos', 'cosa', 'cosas', 'eso', 'esto', 'falta', 'va', 'como', 'algo', 'nada', 'alguno', 'alguna', 'mio', 'mia', 'suyo', 'suya',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'hoy', 'semana',
]);

/** Regla 3 de la frontera: ¿el escrito relata lo que preguntó o dijo el cliente («me pregunta …», «dice que …»)? */
export function relataAlCliente(texto: string): boolean {
  return RELATA.test(normalizarNombre(normalizarTexto(String(texto ?? '').trim())));
}

/** ¿Tiene forma de pregunta o de pedido al bot? */
function esPreguntaOPedido(t: string, bruto: string): boolean {
  return /[¿?]/.test(bruto) || PIDE.test(t) || /^(?:que|cuales|cuantos|cuantas|como|en\s+que|tiene)\b/.test(t);
}

/**
 * El nombre que queda después de quitar lo que no es nombre: «… tiene abiertos Lina Pérez» → «Lina Pérez». `parte`:
 * el trozo (ya normalizado) donde buscarlo; las palabras salen como las escribió el comercial en `bruto`.
 */
function nombreEn(bruto: string, parte: string = bruto): string | null {
  const enParte = new Set(normalizarNombre(parte).split(' ').filter(w => w && !NO_ES_NOMBRE.has(w)));
  const tokens = String(bruto ?? '').split(/[\s,.;:!¡¿?]+/).filter(Boolean);
  const quedan = tokens.filter(w => !NO_ES_NOMBRE.has(normalizarNombre(w)) && enParte.has(normalizarNombre(w)));
  if (quedan.length === 0 || quedan.length > 4) return null;
  // Algo con números no es un nombre de cliente.
  if (quedan.some(w => /\d/.test(w))) return null;
  return quedan.join(' ');
}

/**
 * ¿Este escrito del comercial es una pregunta al bot sobre la bandeja? `null`: no (sigue como siempre). Un reenvío
 * nunca lo es (regla 1 de la frontera).
 */
export function leerConsultaBandeja(texto: string, o: { reenviado: boolean }): ConsultaBandeja | null {
  if (o.reenviado) return null;
  const bruto = String(texto ?? '').trim();
  if (!bruto || bruto.length > 140) return null;
  const t = normalizarNombre(normalizarTexto(bruto));
  if (!t || RELATA.test(t) || !esPreguntaOPedido(t, bruto)) return null;
  // Qué lleva la tanda.
  if (/\b(?:que\s+(?:llevo|llevamos|llevas|te\s+he\s+mandado|te\s+he\s+pasado|te\s+mande|te\s+pase|tienes\s+en\s+la\s+tanda|hay\s+en\s+la\s+tanda|va\s+en\s+la\s+tanda)|cuantos\s+mensajes\s+(?:llevo|llevamos|van|te\s+he\s+mandado|tienes))\b/.test(t)) {
    return { tipo: 'tanda' };
  }
  // Cómo va o qué le falta a un viaje.
  if (/\b(?:que\s+(?:le\s+)?falta|cuanto\s+(?:le\s+)?falta|como\s+va|en\s+que\s+va|que\s+tiene\s+(?:el|ese|este)\s+viaje|(?:estado|avance)\s+del?\s+viaje)\b/.test(t)) {
    const cod = /\b([a-z]{1,3}\d?\s*\d{2}\s*\d{1,4})\b/.exec(t)?.[1];
    if (cod && codigoCompacto(cod).length >= 4) return { tipo: 'viaje', ref: cod.toUpperCase() };
    const de = /\b(?:viaje|cotizacion)\s+(?:de|del)\s+(.+)$/.exec(t)?.[1] ?? /\b(?:falta|va)\s+(?:(?:a|al|el|la)\s+)?(?:(?:viaje|cotizacion)\s+(?:de|del)\s+)?(.+)$/.exec(t)?.[1] ?? null;
    const ref = de ? nombreEn(bruto, de) : null;
    return { tipo: 'viaje', ref };
  }
  // Los viajes abiertos de un cliente.
  if (/\b(?:(?:que|cuales|cuantos)\s+(?:viajes|cotizaciones)(?:\s+abiertos)?\s+(?:tiene|tenemos\s+de|hay\s+de|hay\s+para|abiertos|de|del)|viajes\s+(?:abiertos\s+)?(?:tiene|de|del)|tiene\s+(?:viajes|otros\s+viajes|algo\s+abierto|cotizaciones))\b/.test(t)
    || (PIDE.test(t) && /\bviajes\b/.test(t))) {
    return { tipo: 'viajes', cliente: nombreEn(bruto) };
  }
  return null;
}

// ── Lo que contesta (los hechos los pone quien llama) ────────────────────────

/** «Martín Robledo tiene 5 viajes abiertos:» y la lista (sin números: no es una pregunta que se conteste con uno); o que no tiene. */
export function textoViajesDelCliente(p: {
  cliente: string;
  viajes: ReadonlyArray<{ linea: string }>;
  /** El último cerrado, si no tiene abiertos. */
  cerrado?: string | null;
  /** No está en el directorio. */
  noExiste?: boolean;
}): string {
  if (p.noExiste) return `No tengo a ${p.cliente} en el directorio, así que no tiene viajes.`;
  if (p.viajes.length === 0) return `${p.cliente} no tiene viajes abiertos${p.cerrado ? ` (el último fue ${p.cerrado})` : ''}.`;
  if (p.viajes.length === 1) return `${p.cliente} tiene un viaje abierto: ${p.viajes[0].linea}.`;
  return [`${p.cliente} tiene ${p.viajes.length} viajes abiertos:`, ...p.viajes.map(v => `- ${v.linea}`)].join('\n');
}

/**
 * «Lina puede ser CARTAGENA DIC · Lina Pérez (T1 26 14) o MADRID 8N · Lina Gómez (T1 26 12). Pregúntame por uno, por
 * ejemplo «¿cómo va el de Cartagena?».» Sin lista numerada: no es una pregunta pendiente que se conteste con un número.
 */
export function textoConsultaAmbigua(ref: string, viajes: ReadonlyArray<{ linea: string; cliente?: string | null; destino?: string | null; nombre?: string | null }>): string {
  const ej = ejemploDeReferencia(viajes);
  const lineas = viajes.map(v => v.linea);
  const enum_ = lineas.length <= 1 ? (lineas[0] ?? '') : `${lineas.slice(0, -1).join(', ')} o ${lineas[lineas.length - 1]}`;
  return `«${ref}» puede ser ${enum_}. Pregúntame por uno${ej ? `, por ejemplo «¿cómo va ${ej}?»` : ''}.`;
}

/** Lo que se dice cuando no se sabe de qué cliente o de qué viaje pregunta. */
export const TEXTO_CONSULTA_DE_QUIEN = '¿De qué cliente? Dime su nombre y te digo sus viajes abiertos.';
export const TEXTO_CONSULTA_DE_QUE_VIAJE = '¿De qué viaje? Dime el cliente o el nombre del viaje y te digo cómo va.';
export const TEXTO_SIN_TANDA = 'No tienes una tanda abierta: no me has pasado nada desde la última que cerraste.';

/** «Llevas 3 mensajes de Martín Robledo (viaje nuevo). Cuando termines, escribe «listo».» */
export function textoTanda(p: { nombre: string; n: number; cierre: string }): string {
  const cuantos = p.n === 0 ? 'todavía ningún mensaje' : `${p.n} ${p.n === 1 ? 'mensaje' : 'mensajes'}`;
  return `Llevas ${cuantos} de ${p.nombre}. Cuando termines, escribe «${p.cierre}».`;
}

/** «CARTAGENA DIC · Lina Pérez (T1 26 14) — Mínimo 7/9 … / Le falta: …» */
export function textoEstadoViaje(p: { avance: string; faltan: ReadonlyArray<string> }): string {
  if (p.faltan.length === 0) return `${p.avance}\nYa tiene todo lo mínimo para cotizar.`;
  const max = 6;
  const lista = p.faltan.slice(0, max).join(', ') + (p.faltan.length > max ? ` y ${p.faltan.length - max} más` : '');
  return `${p.avance}\nLe falta: ${lista}.`;
}
