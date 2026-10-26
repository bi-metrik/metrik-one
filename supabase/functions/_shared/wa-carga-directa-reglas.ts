// ============================================================
// La carga directa en el viaje en foco — cuándo sí (décimo control de Vera, 2026-10-05) — sin I/O
// ------------------------------------------------------------
// #1033 cargaba directo, sin «sí», todo escrito que no fuera una pregunta con signo, un acuse, un «nuevo …», un
// encabezado o un reenvío: una regla por exclusión, demasiado ancha. Entraban así el dato de OTRO cliente («la de
// Pedro sale de Cali»), el destino de otro viaje abierto, preguntas sin signo, órdenes, correcciones y pedidos nuevos.
//
// La regla ahora es por inclusión. Va directo solo si se cumplen las dos:
//   1. el escrito trae, EN POSITIVO, un valor de alguno de los datos que el bot pidió para ese viaje (ciudad,
//      edades, personas, fechas, categoría, presupuesto…);
//   2. no nombra, en ninguna parte de la frase, a otro cliente del directorio ni el destino, el código o el cliente de
//      otro viaje abierto.
// Y nunca va directo: una pregunta sin signo, una orden (cancelar, borrar, quitar, descartar), una corrección («no, eso
// era de …») o un verbo de cotizar o abrir con un nombre. Lo que no pasa sigue el camino de siempre (la tanda, o el
// modelo con el viaje en foco en el contexto, con el interruptor prendido): con resumen y «sí».
// ============================================================

import { normalizarNombre } from './wa-entendimiento-reglas.ts';
import type { ViajeAbierto } from './wa-viajes-reglas.ts';

/** Un dato que el bot pidió para el viaje en foco («me falta: …»), con lo necesario para reconocer su valor. */
export interface PedidoFoco {
  slug: string;
  label: string;
  tipo: string;
  /** Las etiquetas de las opciones de un `select` («4 estrellas», «Todo incluido»…). */
  opciones?: string[];
}

function n(s: string | null | undefined): string {
  return normalizarNombre(s ?? '');
}

const MESES = 'ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?';
const RE_FECHA = new RegExp(`\\b(?:\\d{1,2}\\s*(?:de\\s+)?(?:${MESES})\\b|(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\\b|\\d{1,2}\\s*[/-]\\s*\\d{1,2}\\b|del\\s+\\d{1,2}\\s+al\\s+\\d{1,2}\\b|(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\\b|semana\\s+santa|puente\\s+festivo|fin\\s+de\\s+ano|vacaciones\\s+de)`);
const NUM = '(?:\\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)';
const RE_PERSONAS = new RegExp(`\\b${NUM}\\s+(?:adult\\w*|person\\w*|pax|pasajer\\w*|nin\\w*|menor\\w*|hij\\w*|beb\\w*|infante\\w*|chic\\w*|senor\\w*)\\b|\\b(?:somos|son|van|viajan|vamos)\\s+${NUM}\\b|\\b(?:solo|solos|sola|pareja|matrimonio)\\b`);
const RE_EDADES = new RegExp(`\\b${NUM}\\s*(?:anos|anitos|meses)\\b|\\b(?:tiene|tienen|cumple|cumplen)\\s+${NUM}\\b|\\bde\\s+\\d{1,2}\\s+y\\s+\\d{1,2}\\b`);
const RE_CIUDAD = /\b(?:sal(?:e|en|imos|dria|drian|dran)|parte|parten|partimos|vuela|vuelan|volamos|desde|ciudad\s+de\s+(?:salida|origen))\s+(?:de\s+|desde\s+)?[a-z]{3,}/;
const RE_DESTINO = /\b(?:ir|van|vamos|viajar|viajan|conocer|quieren|quiere)\s+(?:a|para)\s+[a-z]{3,}/;
const RE_HOTEL = /\b(?:\d|tres|cuatro|cinco)\s*estrellas?\b|\btodo\s+incluido\b|\bhotel\s+(?:de\s+)?(?:\d|lujo|economico|sencillo|boutique)\b|\bcategoria\b/;
const RE_PRESUPUESTO = /\b\d+(?:[.,]\d+)?\s*(?:millones?|mil|palos|lucas|k)\b|\$\s*\d|\b\d+\s*(?:usd|dolares|pesos)\b|\bpresupuesto\s+(?:de|es|seria|como)\b|\bmillon\b/;
/** Lo que dice que el dato todavía no se sabe: no es un valor «en positivo». */
const RE_NO_SE_SABE = /\b(?:no\s+(?:sabe|saben|se\s+sabe|ha|han|tiene|tienen|esta|estan|sabemos|tengo|me\s+ha|me\s+han|ha\s+dicho|han\s+dicho|ha\s+confirmado|han\s+confirmado|ha\s+definido|han\s+definido)|todavia\s+no|aun\s+no|por\s+definir|sin\s+definir|ni\s+idea|pendiente\s+de)\b/;

/** El valor que trae el texto para un dato pedido, por su tipo y su nombre. */
function traeValor(t: string, p: PedidoFoco): boolean {
  const etiqueta = n(`${p.slug.replace(/_/g, ' ')} ${p.label}`);
  if (/\bedad/.test(etiqueta)) return RE_EDADES.test(t);
  if (p.tipo === 'fecha' || /\bfecha|\bsalida\b.*\bdia|\bregreso\b/.test(etiqueta) && !/ciudad/.test(etiqueta)) return RE_FECHA.test(t);
  if (/\b(?:adult|nin|infante|pasajer|persona|menor)/.test(etiqueta)) return RE_PERSONAS.test(t);
  if (/ciudad|origen/.test(etiqueta)) return RE_CIUDAD.test(t);
  if (/destino/.test(etiqueta)) return RE_DESTINO.test(t);
  if (/hotel|categoria|estrella|acomodacion/.test(etiqueta)) return RE_HOTEL.test(t) || opcionEscrita(t, p);
  if (/presupuesto|valor|precio|monto/.test(etiqueta)) return RE_PRESUPUESTO.test(t) || opcionEscrita(t, p);
  if (p.tipo === 'select') return opcionEscrita(t, p);
  if (p.tipo === 'numero') return /\b\d+\b/.test(t) && etiqueta.split(' ').some(w => w.length >= 4 && t.includes(w.slice(0, 5)));
  return false;
}

function opcionEscrita(t: string, p: PedidoFoco): boolean {
  return (p.opciones ?? []).some(o => {
    const x = n(o);
    return x.length >= 3 && !/^(?:sin preferencia|no se|otro|otra)$/.test(x) && ` ${t} `.includes(` ${x} `);
  });
}

/** ¿El texto trae, en positivo, el valor de alguno de los datos pedidos? Devuelve su slug, o `null`. */
export function datoPedidoEnElTexto(texto: string, pedidos: ReadonlyArray<PedidoFoco>): string | null {
  const t = n(texto);
  if (!t || RE_NO_SE_SABE.test(t)) return null;
  return pedidos.find(p => traeValor(t, p))?.slug ?? null;
}

// ── Lo que nunca va directo ──────────────────────────────────────────────────

/** Una pregunta sin signo: palabra interrogativa al empezar, o un imperativo de averiguar o informar. */
const RE_PREGUNTA_SIN_SIGNO = /^(?:y\s+)?(?:que|cual|cuales|cuando|como|donde|cuanto|cuanta|cuantos|cuantas|quien|quienes|por\s*que|sera\s+que|sabes\s+si|me\s+dices|me\s+puedes\s+decir|hay\s+(?:algun|alguna|forma|manera))\b|\b(?:averigua\w*|averigue\w*|investiga\w*|consulta(?:me|le|r)?|revisa(?:me|r)?|verifica\w*|mira\s+a\s+ver|dime|dimelo|cuentame|informame|avisame\s+si|confirmame\s+si|preguntale|pregunta\s+(?:si|cuanto|que|cual))\b/;
/** Una orden de cancelar, borrar, quitar o descartar. */
const RE_ORDEN = /\b(?:cancel\w*|borr\w*|quit\w*|elimin\w*|descart\w*|anul\w*|sac(?:a|alo|ala|ar|ale)\b|devuelve\w*|deshac\w*)/;
/** Una corrección de lo anterior: una negación seguida de a quién o a qué viaje era, o un «me equivoqué». */
const RE_CORRECCION = /^\s*(?:no|nop|nada|error|ojo)\b[\s,.:;!-]+[\s\S]*\b(?:era|eran|es|son|va|van|iba|iban)\s+(?:de|del|para|pa)\b|\bme\s+equivoque\b|\bcorrijo\b|\bme\s+confundi\b|\bno\s+(?:es|era|son|eran)\s+(?:de|del|para)\s+(?:ese|esa|este|esta)\b|\bera\s+(?:de|para)\s+otr[oa]\b|\bes\s+de\s+otr[oa]\b/;
/** Un verbo de cotizar o abrir con un nombre: un pedido nuevo que no dice «nuevo». */
const RE_PEDIDO_NUEVO = /\b(?:cotiz\w*|abr(?:e|ir|ele|eme|amos|elo|ale)\b|monta(?:r|le|me|lo|mos)?\b|arma(?:le|me|r|lo)?\b|crea(?:le|me|r|lo)?\b)/;

/** Por qué este escrito nunca va directo al viaje en foco, o `null`. */
export function nuncaDirecto(texto: string): 'pregunta' | 'orden' | 'correccion' | 'pedido_nuevo' | null {
  const bruto = String(texto ?? '');
  const t = n(bruto);
  if (/[¿?]/.test(bruto) || RE_PREGUNTA_SIN_SIGNO.test(t)) return 'pregunta';
  if (RE_CORRECCION.test(t)) return 'correccion';
  if (RE_ORDEN.test(t)) return 'orden';
  if (RE_PEDIDO_NUEVO.test(t)) return 'pedido_nuevo';
  return null;
}

// ── Otro viaje u otro cliente nombrado en la frase ───────────────────────────

/** Palabras que no nombran a nadie: artículos, verbos y vocabulario del viaje. Lo demás puede ser un nombre. */
const NO_ES_NOMBRE = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en', 'con', 'por', 'para', 'pa', 'y', 'o', 'que', 'se', 'su', 'sus',
  'le', 'les', 'lo', 'me', 'mi', 'mis', 'te', 'tu', 'es', 'son', 'era', 'eran', 'va', 'van', 'ya', 'si', 'no', 'tambien', 'pero', 'mas', 'muy', 'bien',
  'ella', 'ellos', 'ellas', 'el', 'nos', 'nosotros', 'senor', 'senora', 'don', 'dona', 'sr', 'sra', 'cliente', 'clienta', 'viaje', 'viajes', 'hotel',
  'estrellas', 'estrella', 'salen', 'sale', 'salimos', 'desde', 'quieren', 'quiere', 'prefieren', 'prefiere', 'tienen', 'tiene', 'anos', 'adultos',
  'adulto', 'ninos', 'nino', 'nina', 'ninas', 'hijos', 'hijo', 'hija', 'bebe', 'bebes', 'menores', 'menor', 'personas', 'persona', 'presupuesto',
  'millones', 'millon', 'mil', 'pesos', 'categoria', 'todo', 'incluido', 'fecha', 'fechas', 'regreso', 'salida', 'vuelven', 'regresan', 'dias',
  'noches', 'semana', 'santa', 'puente', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
  'noviembre', 'diciembre', 'dijo', 'dice', 'confirmo', 'confirma', 'confirmaron', 'mando', 'manda', 'escribio', 'cuenta', 'ademas', 'ahora',
  'entonces', 'esposo', 'esposa', 'mama', 'papa', 'abuela', 'abuelo', 'familia', 'amigos', 'amiga', 'amigo', 'pareja', 'novio', 'novia', 'solo',
  'sola', 'solos', 'como', 'unos', 'mas', 'menos', 'aproximado', 'aproximadamente', 'cada', 'otro', 'otra', 'listo', 'ok', 'vale', 'dale', 'gracias',
  'buenas', 'buenos', 'hola', 'tardes', 'noches', 'dias', 'ciudad', 'ida', 'vuelta', 'vuelo', 'vuelos', 'aeropuerto', 'habitacion', 'habitaciones',
]);

function palabrasDe(s: string | null | undefined): string[] {
  return n(s).split(' ').filter(w => w.length >= 3);
}

/** Lo que nombra a un viaje: su código, las palabras del cliente y las del destino (no las del mes ni los números). */
function marcasDelViaje(v: ViajeAbierto): { codigo: string | null; cliente: string[]; destino: string[] } {
  const destino = [...palabrasDe(v.destino), ...palabrasDe(v.nombre)]
    .filter(w => !new RegExp(`^(?:${MESES})$`).test(w) && !/\d/.test(w) && !NO_ES_NOMBRE.has(w));
  return { codigo: v.codigo ? n(v.codigo) : null, cliente: palabrasDe(v.cliente).filter(w => !NO_ES_NOMBRE.has(w)), destino: [...new Set(destino)] };
}

/**
 * ¿La frase nombra, en cualquier parte, OTRO viaje abierto (su código, su destino o su cliente)? Las palabras que
 * también son del viaje en foco no cuentan (dos viajes a San Andrés: «San Andrés» no distingue). Devuelve el primero.
 */
export function otroViajeNombrado(texto: string, foco: ViajeAbierto | null, viajes: ReadonlyArray<ViajeAbierto>): ViajeAbierto | null {
  const t = ` ${n(texto)} `;
  const delFoco = foco ? marcasDelViaje(foco) : null;
  const propias = new Set([...(delFoco?.cliente ?? []), ...(delFoco?.destino ?? [])]);
  for (const v of viajes) {
    if (foco && v.id === foco.id) continue;
    const m = marcasDelViaje(v);
    if (m.codigo && t.includes(` ${m.codigo} `)) return v;
    if ([...m.cliente, ...m.destino].some(w => !propias.has(w) && t.includes(` ${w} `))) return v;
  }
  return null;
}

/**
 * El viaje que el texto nombra entre unos candidatos, en cualquier parte de la frase (décimo control, hallazgo 6):
 * por su código, su destino o su cliente. Solo cuentan las palabras que distinguen a un candidato de los demás.
 * `null`: ninguno o más de uno.
 */
export function candidatoNombradoEnLaFrase(texto: string, cands: ReadonlyArray<ViajeAbierto>): ViajeAbierto | null {
  const t = ` ${n(texto)} `;
  const marcas = cands.map(c => ({ c, m: marcasDelViaje(c) }));
  const cuenta = new Map<string, number>();
  for (const { m } of marcas) for (const w of new Set([...m.cliente, ...m.destino])) cuenta.set(w, (cuenta.get(w) ?? 0) + 1);
  const nombrados = marcas.filter(({ m }) => (m.codigo && t.includes(` ${m.codigo} `))
    || [...m.cliente, ...m.destino].some(w => cuenta.get(w) === 1 && t.includes(` ${w} `)));
  return nombrados.length === 1 ? nombrados[0].c : null;
}

/**
 * Las palabras del escrito que podrían ser el nombre de una persona (para buscarlas en el directorio): no son
 * vocabulario del viaje, ni números, ni fechas, ni del cliente del viaje en foco. Como mucho `max`, las más largas.
 */
export function posiblesNombres(texto: string, focoCliente: string | null, max = 4): string[] {
  const propias = new Set(palabrasDe(focoCliente));
  const ws = n(texto).split(' ').filter(w => w.length >= 3 && !/\d/.test(w) && !NO_ES_NOMBRE.has(w) && !propias.has(w)
    && !new RegExp(`^(?:${MESES})$`).test(w) && !/(?:ar|er|ir|ando|iendo|ado|ido|amos|emos|imos|aron|ieron)$/.test(w));
  return [...new Set(ws)].sort((a, b) => b.length - a.length).slice(0, max);
}

// ── La decisión ──────────────────────────────────────────────────────────────

export type MotivoNoDirecto = 'sin_pedidos' | 'sin_dato_pedido' | 'pregunta' | 'orden' | 'correccion' | 'pedido_nuevo' | 'otro_viaje' | 'otro_cliente';

/**
 * ¿Este escrito va directo al viaje en foco? Sin I/O: `otrosClientes` son los clientes del directorio (que no son el
 * del viaje en foco) cuyo nombre trae alguna palabra del escrito; los busca quien llama con `posiblesNombres`.
 */
export function cargaDirecta(texto: string, ctx: {
  pedidos: ReadonlyArray<PedidoFoco> | undefined;
  foco: ViajeAbierto | null;
  viajes: ReadonlyArray<ViajeAbierto>;
  otrosClientes: ReadonlyArray<string>;
}): { ok: true; dato: string } | { ok: false; motivo: MotivoNoDirecto } {
  if (!ctx.pedidos?.length) return { ok: false, motivo: 'sin_pedidos' };
  const nunca = nuncaDirecto(texto);
  if (nunca) return { ok: false, motivo: nunca };
  if (otroViajeNombrado(texto, ctx.foco, ctx.viajes)) return { ok: false, motivo: 'otro_viaje' };
  if (ctx.otrosClientes.length > 0) return { ok: false, motivo: 'otro_cliente' };
  const dato = datoPedidoEnElTexto(texto, ctx.pedidos);
  return dato ? { ok: true, dato } : { ok: false, motivo: 'sin_dato_pedido' };
}
