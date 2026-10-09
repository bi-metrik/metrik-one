// ============================================================
// Núcleo conversacional — el verificador de `responder` (§3.5, «no afirmar lo que nadie devolvió»)
// ------------------------------------------------------------
// Todo código de viaje, celular, correo, cifra, fecha, porcentaje y nombre propio del texto tiene que estar en el
// respaldo: un resultado de herramienta, un mensaje de la conversación (escritos, reenvíos, lo que el bot ya dijo) o el
// estado y el reglamento que armó el código.
// Una oración que AFIRMA un hecho del sistema («lo anoté», «abrimos», «ya quedó guardada…», «está registrada…») sale
// solo si un HECHO la respalda: un resultado de herramienta de este turno (`ver_viaje`, `buscar`) o una escritura
// confirmada con su toque en la conversación. La oración tiene que nombrar algo de ese hecho (un campo, un código, un
// valor) y todos sus datos tienen que estar en él. Las palabras solo detectan que hay una afirmación; lo que decide si
// sale es el respaldo (2026-10-07: en vivo se atajaban «está registrada la ciudad de salida: Bogotá», dicho tras un
// `ver_viaje`, y «la fecha de regreso ya quedó guardada…», cierta desde el toque anterior).
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

/** Los pares de palabras seguidas de 3+ letras: «la ciudad de salida» → «ciudad salida». */
function pares(n: string): Set<string> {
  const ws = n.split(/[^a-z0-9ñ]+/u).filter((w) => w.length >= 3);
  const out = new Set<string>();
  for (let i = 0; i + 1 < ws.length; i++) out.add(`${ws[i]} ${ws[i + 1]}`);
  return out;
}

/** ¿La oración afirma un hecho del sistema? Devuelve qué lo dice (para el motivo), o null. Solo DETECTA. */
function afirmacion(oracion: string): string | null {
  for (const v of VERBOS_DE_HECHO) {
    if (new RegExp(`(^|[^\\p{L}])${v}($|[^\\p{L}])`, 'iu').test(oracion)) return `verbo de hecho «${v}»`;
  }
  for (const v of VERBOS_DE_HECHO_PLURAL) {
    for (const m of oracion.matchAll(new RegExp(`(^|[^\\p{L}])${v}($|[^\\p{L}])`, 'giu'))) {
      if (!dentroDePregunta(oracion, (m.index ?? 0) + m[1].length)) return `verbo de hecho «${v}»`;
    }
  }
  if (RE_HECHO_PARTICIPIO.test(oracion)) return 'afirma que algo quedó hecho';
  return null;
}

const RESPALDO_VACIO: Respaldo = { texto: '', palabras: new Set(), digitos: '', numeros: new Set() };

/**
 * Los motivos por los que el texto no puede salir. Vacío = pasa.
 *
 * @param hechos lo que respalda una AFIRMACIÓN de hecho (`respaldoDe` de los resultados de herramienta de este turno y
 *               de las escrituras confirmadas de la conversación). Sin hechos, ninguna afirmación de hecho sale.
 */
export function verificar(texto: string, r: Respaldo, hechos: Respaldo = RESPALDO_VACIO): string[] {
  const motivos: string[] = [];
  const paresHechos = pares(hechos.texto);
  for (const m of texto.matchAll(/[^.!?\n]+[.!?]*/gu)) {
    const oracion = m[0].trim();
    const dice = oracion ? afirmacion(oracion) : null;
    if (!dice) continue;
    if (!hechos.texto) {
      motivos.push(`${dice} y ninguna herramienta de este turno ni escritura confirmada lo respalda: los hechos los escribe el sistema`);
      continue;
    }
    // Tiene que nombrar algo del hecho (un campo, un código, un valor)…
    const nombra = [...pares(normal(oracion))].some((x) => paresHechos.has(x))
      || [...oracion.matchAll(RE_CODIGO)].some((c) => hechos.texto.includes(normal(c[0])));
    if (!nombra) {
      motivos.push(`${dice} sin nombrar nada de lo que devolvió una herramienta de este turno o se escribió con un toque`);
      continue;
    }
    // …y todos sus datos tienen que estar en él, no solo en la conversación.
    for (const d of datosSinRespaldo(oracion, hechos)) motivos.push(`${dice}, pero ${d} entre lo consultado o escrito`);
  }
  motivos.push(...datosSinRespaldo(texto, r));
  return [...new Set(motivos)];
}

/** Los datos de un texto (códigos, correos, celulares, fechas, cifras, nombres) que no están en el respaldo. */
function datosSinRespaldo(texto: string, r: Respaldo): string[] {
  const motivos: string[] = [];
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
