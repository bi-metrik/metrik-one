// ============================================================
// Núcleo conversacional — el verificador de `responder` (§3.5, «no afirmar lo que nadie devolvió»)
// ------------------------------------------------------------
// Todo código de viaje, celular, correo, cifra, fecha, porcentaje y nombre propio del texto tiene que estar en el
// respaldo: un resultado de herramienta, un mensaje de la conversación (escritos, reenvíos, lo que el bot ya dijo) o el
// estado y el reglamento que armó el código. Los verbos de hecho («cargué», «creé», «abrí», «descarté») no salen nunca
// del modelo: los hechos los escribe el código (`rf.hecho`) después de un toque.
//
// Riesgo conocido (diseño §3.5): puede bloquear un nombre escrito de otra forma («don Diego» por «Diego Torres»). Eso
// es un «mal», no una dañina; el arnés cuenta los bloqueos y su motivo.
// Pura.
// ============================================================

const VERBOS_DE_HECHO = [
  'cargué', 'creé', 'abrí', 'descarté', 'anoté', 'guardé', 'registré', 'actualicé', 'borré', 'eliminé', 'asigné', 'agregué', 'añadí', 'cambié',
];
/**
 * La primera del plural también afirma un hecho: en vivo (2026-10-07) el respaldo escribió «Sí, abrimos el nuevo viaje a
 * San Andrés» sin que nada se abriera, y pasó porque la lista solo tenía «abrí». Dentro de una pregunta («¿Lo
 * abrimos?») no afirma nada.
 */
const VERBOS_DE_HECHO_PLURAL = [
  'cargamos', 'creamos', 'abrimos', 'descartamos', 'anotamos', 'guardamos', 'registramos', 'actualizamos', 'borramos',
  'eliminamos', 'asignamos', 'agregamos', 'añadimos', 'cambiamos',
];
const RE_HECHO_PARTICIPIO = /\b(?:ya\s+)?(?:qued[oó]|est[aá]|lo\s+dej[eé])\s+(?:cargad|cread|abiert|registrad|anotad|guardad|descartad|actualizad)[oa]s?\b/iu;
const RE_CODIGO = /\b[A-ZÑ]\d{0,2} \d{2} \d{1,4}\b/gu;
const RE_CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const RE_CEL_CORTO = /(?:…|\.\.\.)\s?(\d{3,4})\b/gu;
const RE_CEL_LARGO = /(?<![\d])\+?\d[\d\s().-]{5,}\d(?![\d])/gu;
const MESES = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic';
const RE_FECHA = new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${MESES})\\b|\\b(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?\\b`, 'giu');
const RE_PORCENTAJE = /(\d+(?:[.,]\d+)?)\s?%/gu;
const RE_PLATA = /(?:\$|US\$|USD\s?)\s?(\d[\d.,]*)|(\d[\d.,]*)\s?(?:pesos|millones|mil|usd|dólares|dolares)\b/giu;
const RE_NUMERO = /\b\d{2,}(?:[.,]\d+)*\b/gu;
const RE_PALABRA_MAYUSCULA = /(^|[^\p{L}\p{N}])(\p{Lu}[\p{L}'’-]{2,})/gu;

/** Palabras con mayúscula que no son nombres propios del dominio (aunque no estén en el respaldo). */
const NO_SON_NOMBRES = new Set([
  'listo', 'hola', 'gracias', 'claro', 'perfecto', 'dale', 'vale', 'bueno', 'entendido', 'okay', 'ok', 'whatsapp', 'one', 'sí', 'si', 'no',
  'cliente', 'clientes', 'viaje', 'viajes', 'nuevo', 'nueva', 'cargar', 'descartar', 'crear', 'abrir', 'ninguno', 'otro', 'otra', 'ver',
  'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'cel', 'celular', 'correo', 'para', 'qué', 'que', 'cuál', 'cual', 'cuándo',
  'dónde', 'cómo', 'quién', 'quiénes', 'falta', 'faltan', 'tengo', 'tienes', 'tiene', 'también', 'ahora', 'esto', 'este', 'esta', 'ese', 'esa',
]);

export function normal(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function digitos(s: string): string {
  return s.replace(/\D/g, '');
}

export interface Respaldo {
  texto: string;
  palabras: Set<string>;
  digitos: string;
  numeros: Set<string>;
}

/** El respaldo armado una vez por turno. */
export function respaldoDe(fuentes: ReadonlyArray<string>): Respaldo {
  const texto = fuentes.join('\n');
  const n = normal(texto);
  const palabras = new Set(n.split(/[^a-z0-9ñ]+/u).filter(Boolean));
  const numeros = new Set<string>();
  for (const m of texto.matchAll(/\d[\d.,]*/g)) {
    const d = digitos(m[0]);
    if (d) { numeros.add(d); numeros.add(String(Number(d))); }
  }
  return { texto: n.replace(/\s+/g, ' '), palabras, digitos: digitos(texto), numeros };
}

/** ¿Es el inicio de una oración? (la mayúscula de ahí no dice nada). */
function inicioDeOracion(texto: string, i: number): boolean {
  const antes = texto.slice(0, i).replace(/[\s«"“(¿¡*_-]+$/u, '');
  return antes === '' || /[.!?:\n…]$/u.test(antes);
}

/** ¿La posición cae dentro de una pregunta («¿… ?» sin cerrar antes)? */
function dentroDePregunta(texto: string, i: number): boolean {
  const abre = texto.lastIndexOf('¿', i);
  if (abre < 0) return false;
  const cierra = texto.indexOf('?', abre);
  return cierra >= i && !/[.!\n]/u.test(texto.slice(abre, i));
}

/** Los motivos por los que el texto no puede salir. Vacío = pasa. */
export function verificar(texto: string, r: Respaldo): string[] {
  const motivos: string[] = [];

  for (const v of VERBOS_DE_HECHO) {
    if (new RegExp(`(^|[^\\p{L}])${v}($|[^\\p{L}])`, 'iu').test(texto)) motivos.push(`verbo de hecho «${v}»: los hechos los escribe el sistema`);
  }
  for (const v of VERBOS_DE_HECHO_PLURAL) {
    for (const m of texto.matchAll(new RegExp(`(^|[^\\p{L}])${v}($|[^\\p{L}])`, 'giu'))) {
      if (!dentroDePregunta(texto, (m.index ?? 0) + m[1].length)) { motivos.push(`verbo de hecho «${v}»: los hechos los escribe el sistema`); break; }
    }
  }
  if (RE_HECHO_PARTICIPIO.test(texto)) motivos.push('afirma que algo quedó hecho: los hechos los escribe el sistema');

  const usados = new Set<string>();
  for (const m of texto.matchAll(RE_CODIGO)) {
    usados.add(m[0]);
    if (!r.texto.includes(normal(m[0]))) motivos.push(`código «${m[0]}» que ninguna herramienta devolvió`);
  }
  for (const m of texto.matchAll(RE_CORREO)) {
    if (!r.texto.includes(normal(m[0]))) motivos.push(`correo «${m[0]}» sin respaldo`);
  }
  for (const m of texto.matchAll(RE_CEL_CORTO)) {
    usados.add(m[1]);
    if (!r.digitos.includes(m[1])) motivos.push(`celular «…${m[1]}» sin respaldo`);
  }
  for (const m of texto.matchAll(RE_CEL_LARGO)) {
    const d = digitos(m[0]);
    if (d.length < 7) continue;
    usados.add(m[0].trim());
    if (!r.digitos.includes(d.slice(-7))) motivos.push(`número «${m[0].trim()}» sin respaldo`);
  }
  for (const m of texto.matchAll(RE_FECHA)) {
    const partes = [m[1], m[3], m[4], m[5]].filter(Boolean) as string[];
    for (const p of partes) usados.add(p);
    // La fecha tiene que estar como la dijeron (el día con su mes) o sus números en el respaldo.
    if (!r.texto.includes(normal(m[0]).replace(/\s+/g, ' ')) && !partes.every((p) => r.numeros.has(String(Number(p))))) {
      motivos.push(`fecha «${m[0]}» sin respaldo`);
    }
  }
  for (const m of texto.matchAll(RE_PORCENTAJE)) {
    usados.add(m[1]);
    if (!r.numeros.has(digitos(m[1]))) motivos.push(`porcentaje «${m[0]}» sin respaldo`);
  }
  for (const m of texto.matchAll(RE_PLATA)) {
    const num = m[1] ?? m[2];
    usados.add(num);
    if (!r.numeros.has(digitos(num))) motivos.push(`cifra «${m[0].trim()}» sin respaldo`);
  }
  for (const m of texto.matchAll(RE_NUMERO)) {
    if ([...usados].some((u) => u.includes(m[0]))) continue;
    const d = digitos(m[0]);
    if (!r.numeros.has(d) && !r.numeros.has(String(Number(d)))) motivos.push(`cifra «${m[0]}» sin respaldo`);
  }

  for (const m of texto.matchAll(RE_PALABRA_MAYUSCULA)) {
    const palabra = m[2];
    const i = (m.index ?? 0) + m[1].length;
    if (inicioDeOracion(texto, i)) continue;
    const k = normal(palabra).replace(/['’-]/g, '');
    if (NO_SON_NOMBRES.has(k) || NO_SON_NOMBRES.has(palabra.toLowerCase())) continue;
    // Un código ya revisado («M1 26 6») o una sigla corta no es un nombre.
    if (/^\p{Lu}\d/u.test(palabra)) continue;
    if (!r.palabras.has(k)) motivos.push(`nombre «${palabra}» que no está en la conversación ni en lo que devolvieron las herramientas`);
  }
  return [...new Set(motivos)];
}
