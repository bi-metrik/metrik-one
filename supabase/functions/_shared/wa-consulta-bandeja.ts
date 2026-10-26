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
  /**
   * Cómo va o qué le falta a un viaje. `ref`: el código o el nombre que nombra; `null`: el de la tanda abierta o el viaje
   * en foco. `alcance` (2026-10-05): «para completo» o «para cotizar»; sin él, los dos.
   */
  | { tipo: 'viaje'; ref: string | null; alcance?: 'minimo' | 'completo' }
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
  // La pregunta por lo que falta (2026-10-05): «… para entregarlo completo», «… para que quede completa la solicitud».
  'entregarlo', 'entregarla', 'entregar', 'completo', 'completa', 'completar', 'completarlo', 'cotizar', 'cotizarlo', 'quede', 'queda',
  'pendiente', 'pendientes', 'solicitud', 'puntos', 'datos', 'campos', 'minimo', 'lo', 'faltaria', 'faltarian', 'faltan', 'estan', 'que',
]);

/**
 * Noveno control de Vera (hallazgo 3): el verbo de relato en CUALQUIER posición y con un sujeto que no es el comercial
 * («Ana Ruiz pregunta…», «la señora anda preguntando…», «él quiere saber…», «dijeron que…»): tercera persona, pasado o
 * gerundio. «te pregunto» o «quiero saber» (el comercial al bot) no lo son. «una consulta» como sustantivo, tampoco.
 */
const RELATO_EN_CUALQUIER_PARTE = /\b(?:pregunta|preguntan|preguntaba|preguntaban|preguntaron|preguntando|quiere\s+saber|quieren\s+saber|queria\s+saber|querian\s+saber|quiso\s+saber|quisieron\s+saber|dice|dicen|decia|decian|dijo|dijeron|diciendo|escribe|escriben|escribia|escribio|escribieron|escribiendo|consultan|consultaba|consultaron|consultando)\b/;
/**
 * Décimo control de Vera (hallazgo 3): el relato no es una lista de verbos. Dos construcciones con un sujeto que no es el
 * comercial, en cualquier tiempo y posición, son contenido:
 *   · el encargo del cliente al comercial: un verbo de pedir o encargar + «que» + un verbo de decir o averiguar en
 *     subjuntivo («me pidió que le averigüe…», «quiere que le confirme…», «nos encargaron que les cotizáramos…»);
 *   · el interés en tercera persona: un verbo de interés o deseo + «saber» («le interesa saber…», «les gustaría saber…»).
 */
const ENCARGO_DEL_CLIENTE = /\b(?:pide|piden|pidio|pidieron|pedia|pedian|ha\s+pedido|han\s+pedido|encargo|encargaron|encarga|encargan|quiere|quieren|queria|querian|quisiera|quisieran|necesita|necesitan|necesitaba|necesitaban|insiste\s+en|insisten\s+en)\s+que\s+(?:(?:le|les|se|lo|la|los|las|me|nos)\s+){0,2}(?:diga|digamos|dijera|dijeramos|averigue|averiguemos|averiguara|averiguaramos|cuente|contemos|contara|confirme|confirmemos|confirmara|consiga|consigamos|cotice|coticemos|cotizara|cotizaramos|busque|busquemos|buscara|mande|mandemos|mandara|envie|enviemos|enviara|pase|pasemos|pasara|informe|informemos|informara|revise|revisemos|revisara|mire|miremos|mirara|pregunte|preguntemos|preguntara|explique|expliquemos|explicara|consulte|consultemos|consultara|verifique|verifiquemos|verificara|reserve|reservemos|reservara|ayude|ayudemos|ayudara)\b/;
const INTERES_DE_TERCERO = /\b(?:le|les)\s+(?:interesa|interesaria|interesaba|gustaria|gusta|gustaba|encantaria|intriga)\s+saber\b|\b(?:desea|desean|deseaba|deseaban|quisiera|quisieran|necesita|necesitan|necesitaba|necesitaban|anda|andan|esta|estan)\s+(?:interesad[oa]s?\s+en\s+)?(?:saber|averiguando|preguntando)\b|\b(?:tiene|tienen)\s+(?:curiosidad|la\s+duda|dudas?)\s+(?:de|sobre|por)\b/;

/** Las formas con tilde que en minúscula sin tilde serían también del comercial («preguntó» / «pregunto»). */
const RELATO_CON_TILDE = /\b(?:pregunt[oó]|consult[oó])\b/;

/** Un imperativo (o infinitivo) de acción: descartar, borrar, quitar, mover, pasar, cargar, crear. */
const PIDE_UNA_ACCION = /\b(?:(?:descart|borr|quit|elimin|sac|bot)(?:a|e|ar|alo|ala|alos|alas|elo|ela|elos|arlo|arla|arlos)|mueve|muevelo|muevela|muevelos|mover|moverlo|moverla|pasalo|pasala|pasalos|pasalas|pasarlo|pasarla|carga|cargalo|cargala|cargalos|cargar|cargarlo|crea|crealo|creala|crear|crearlo|crearla)\b/;

/** Regla 3 de la frontera: ¿el escrito relata lo que preguntó o dijo el cliente? */
export function relataAlCliente(texto: string): boolean {
  const bruto = String(texto ?? '').trim();
  const t = normalizarNombre(normalizarTexto(bruto));
  if (RELATA.test(t)) return true;
  // «te pregunto», «le pregunto»: el comercial pregunta (al bot o al cliente); no es un relato.
  const sinElComercial = t.replace(/\b(?:te|le|yo)\s+(?:pregunto|consulto|digo|escribo)\b/g, ' ');
  if (RELATO_EN_CUALQUIER_PARTE.test(sinElComercial)) return true;
  if (ENCARGO_DEL_CLIENTE.test(sinElComercial) || INTERES_DE_TERCERO.test(sinElComercial)) return true;
  // «preguntó», «consultó» (con tilde): tercera persona del pasado. Sin tilde no se adivina.
  const m = RELATO_CON_TILDE.exec(bruto.toLowerCase());
  return !!m && /[óÓ]$/.test(m[0]);
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

/** «pero faltan 4 puntos para que quede completo», «todavía le faltan datos para cotizar». */
const CORRIGE_LO_QUE_FALTA = /^(?:(?:pero|y|oye|ojo|no|mira)\s+)*(?:todavia\s+|aun\s+)?(?:le\s+)?faltan?\s+(?:\d+|un|una|dos|tres|cuatro|cinco|varios|varias|datos|puntos|campos|cosas)\b.*\b(?:complet\w*|cotiz\w*|entreg\w*|minimo)\b/;

/** El viaje que nombra la pregunta: su código, o el nombre tras «del viaje de …» / «le falta al …». */
function refDelViaje(t: string, bruto: string): string | null {
  const cod = /\b([a-z]{1,3}\d?\s*\d{2}\s*\d{1,4})\b/.exec(t)?.[1];
  if (cod && codigoCompacto(cod).length >= 4) return cod.toUpperCase();
  const de = /\b(?:viaje|cotizacion|solicitud)\s+(?:de|del)\s+(.+)$/.exec(t)?.[1]
    ?? /\b(?:falta\w*|va|queda(?:\s+pendiente)?)\s+(?:(?:a|al|el|la)\s+)?(?:(?:viaje|cotizacion)\s+(?:de|del)\s+)?(.+)$/.exec(t)?.[1] ?? null;
  return de ? nombreEn(bruto, de) : null;
}

/**
 * El alcance de una pregunta por lo que falta, sacado del texto (décimo control, hallazgo 5: en toda consulta de viaje,
 * también en la que viene del modelo). Completo: complet*, deseable, lo que falta en total, entregar, terminar o dejar
 * lista la solicitud. Mínimo: cotiz*, mínimo, empezar. Sin nada de eso, `undefined` (se contestan los dos).
 */
export function alcanceDelTexto(texto: string): 'minimo' | 'completo' | undefined {
  const t = normalizarNombre(normalizarTexto(String(texto ?? '')));
  if (/\b(?:complet\w*|deseable\w*|entreg\w*|al\s+100|cien\s+por\s+ciento|todo\s+lo\s+que\s+falta|en\s+total|termin\w*|dej\w*\s+(?:la\s+|lo\s+)?(?:solicitud\s+)?list[oa]s?|quede\s+list[oa]|cerrar\s+la\s+solicitud|barra|sin\s+llenar|por\s+llenar)\b/.test(t)) return 'completo';
  if (/\b(?:cotiz\w*|minimo|empez\w*|empiez\w*|arrancar)\b/.test(t)) return 'minimo';
  return undefined;
}

/** El alcance de la pregunta: «para completo» / «para entregarlo», o «para cotizar» / «el mínimo»; sin eso, los dos. */
function conAlcance(c: { tipo: 'viaje'; ref: string | null }, t: string): ConsultaBandeja {
  const alcance = alcanceDelTexto(t);
  return alcance ? { ...c, alcance } : c;
}

/**
 * Décimo control (hallazgo 5b): la corrección al bot SIN cifra («le faltan los datos de hotel y presupuesto», «hay campos
 * sin llenar», «la barra no está llena», «todavía no está completo»), sin un sujeto cliente, es la pregunta de completo
 * del viaje en foco.
 */
const CORRIGE_SIN_CIFRA = /^(?:(?:pero|y|oye|ojo|no|mira|bueno)\s+)*(?:todavia\s+|aun\s+)?(?:(?:le\s+)?faltan?\s+(?:(?:los|las|unos|unas|varios|varias)\s+)?(?:datos|campos|cosas|puntos|casillas)\b|(?:hay|quedan|quedaron|tiene|tienen|siguen)\s+(?:(?:unos|unas|varios|varias|muchos|muchas)\s+)?(?:datos|campos|cosas|puntos|casillas)\s+(?:sin|por)\s+(?:llenar|completar|diligenciar)|la\s+barra\s+(?:no\s+)?(?:esta|va|sigue|queda|quedo)\b|(?:no|todavia\s+no|aun\s+no)\s+(?:esta|queda|quedo|ha\s+quedado)\s+complet\w*|(?:esta|quedo|sigue)\s+incomplet\w*)/;
/** Lo que falta DEL CLIENTE («falta que me mande…», «el cliente no ha mandado…»): contenido, no la corrección al bot. */
const FALTA_DEL_CLIENTE = /\b(?:que\s+(?:me|nos|le)\s+(?:mande|manden|envie|envien|pase|pasen|confirme|confirmen)|(?:cliente|clienta|senor|senora)\s+(?:no\s+)?(?:ha|han|me|nos|manda|mando|dijo|envio))\b/;
/** Con palabras de plata, «cómo va» no es la consulta de un viaje (décimo control, hallazgo 9). */
const PLATA = /\b(?:cartera|ventas?|vendid[oa]s?|vendimos|vendemos|gastos?|gastad[oa]|gastamos|numeros|facturad[oa]|facturacion|facturamos|utilidad|utilidades|plata|recaudo|recaudad[oa]|cobrad[oa]|cobros?|ingresos?|caja|flujo|margen|rentabilidad|ebitda)\b/;

/**
 * ¿Este escrito del comercial es una pregunta al bot sobre la bandeja? `null`: no (sigue como siempre). Un reenvío
 * nunca lo es (regla 1 de la frontera).
 */
export function leerConsultaBandeja(texto: string, o: { reenviado: boolean }): ConsultaBandeja | null {
  if (o.reenviado) return null;
  const bruto = String(texto ?? '').trim();
  if (!bruto || bruto.length > 140) return null;
  const t = normalizarNombre(normalizarTexto(bruto));
  if (!t || relataAlCliente(bruto)) return null;
  // Conversación con memoria (2026-10-05, punto 3): una afirmación que corrige al bot sobre lo que falta («pero faltan 4
  // puntos para que quede completo») es una pregunta por ese viaje, aunque no tenga signo.
  if (CORRIGE_LO_QUE_FALTA.test(t)) return conAlcance({ tipo: 'viaje', ref: refDelViaje(t, bruto) }, t);
  if (CORRIGE_SIN_CIFRA.test(t) && !FALTA_DEL_CLIENTE.test(t)) return { tipo: 'viaje', ref: refDelViaje(t, bruto), alcance: 'completo' };
  if (!esPreguntaOPedido(t, bruto)) return null;
  if (PLATA.test(t)) return null;
  // Noveno control (hallazgo 6): un pedido de hacer algo («borra lo que te mandé», «pásalo al de Cartagena») no es una
  // consulta aunque use su vocabulario.
  if (PIDE_UNA_ACCION.test(t)) return null;
  // Qué lleva la tanda.
  if (/\b(?:que\s+(?:llevo|llevamos|llevas|te\s+he\s+mandado|te\s+he\s+pasado|te\s+mande|te\s+pase|tienes\s+en\s+la\s+tanda|hay\s+en\s+la\s+tanda|va\s+en\s+la\s+tanda)|cuantos\s+mensajes\s+(?:llevo|llevamos|van|te\s+he\s+mandado|tienes))\b/.test(t)) {
    return { tipo: 'tanda' };
  }
  // Cómo va o qué le falta a un viaje.
  if (/\b(?:que\s+(?:le\s+)?falta\w*|cuanto\s+(?:le\s+)?falta\w*|que\s+(?:le\s+)?queda(?:\s+pendiente)?|como\s+va|en\s+que\s+va|que\s+tiene\s+(?:el|ese|este)\s+viaje|(?:estado|avance)\s+del?\s+viaje)\b/.test(t)) {
    return conAlcance({ tipo: 'viaje', ref: refDelViaje(t, bruto) }, t);
  }
  // Los viajes abiertos de un cliente.
  if (/\b(?:(?:que|cuales|cuantos)\s+(?:viajes|cotizaciones)(?:\s+abiertos)?\s+(?:tiene|tenemos\s+de|hay\s+de|hay\s+para|abiertos|de|del)|(?:que|cuales|cuantos)\s+(?:viajes|cotizaciones)\s+(?:estan|siguen|quedan|hay|tengo|tenemos|tiene)\s+abiert\w*|viajes\s+(?:abiertos\s+)?(?:tiene|de|del)|tiene\s+(?:viajes|otros\s+viajes|algo\s+abierto|cotizaciones))\b/.test(t)
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

/** La tanda ya cerrada con su resumen esperando (noveno control, hallazgo 7). */
export function textoTandaEnResumen(p: { nombre: string; n: number }): string {
  return `La tanda de ${p.nombre} ya se cerró con ${p.n} ${p.n === 1 ? 'mensaje' : 'mensajes'} y espera tu respuesta al resumen («sí» para cargarla).`;
}

/** «CARTAGENA DIC · Lina Pérez (T1 26 14) — Mínimo 7/9 … / Le falta: …» */
export function textoEstadoViaje(p: {
  avance: string;
  /** Lo que falta del mínimo para cotizar. */
  faltan: ReadonlyArray<string>;
  /** Lo que falta para completo (mínimo y deseable). Sin él, solo se dice el mínimo. */
  faltanCompleto?: ReadonlyArray<string>;
  /** Lo que preguntó (2026-10-05): para completo, para cotizar, o los dos. */
  alcance?: 'minimo' | 'completo';
}): string {
  const lista = (xs: ReadonlyArray<string>, max = 6) => xs.slice(0, max).join(', ') + (xs.length > max ? ` y ${xs.length - max} más` : '');
  const minimo = p.faltan.length === 0 ? 'Ya tiene todo lo mínimo para cotizar.' : `Le falta para cotizar: ${lista(p.faltan)}.`;
  const completo = !p.faltanCompleto ? null
    : p.faltanCompleto.length === 0 ? 'Ya está completo.'
    : `Le ${p.faltanCompleto.length === 1 ? 'falta 1 dato' : `faltan ${p.faltanCompleto.length} datos`} para completo: ${lista(p.faltanCompleto, 8)}.`;
  if (p.alcance === 'completo' && completo) return `${p.avance}\n${completo}`;
  if (p.alcance === 'minimo' || !completo) return `${p.avance}\n${minimo}`;
  return `${p.avance}\n${minimo}\n${completo}`;
}
