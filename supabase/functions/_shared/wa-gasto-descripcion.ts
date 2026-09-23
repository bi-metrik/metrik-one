// ============================================================
// Descripcion de un gasto registrado por WhatsApp — modulo PURO
//
// POR QUE EXISTE: `gastos.descripcion` quedaba en "Categoria — $monto" o en un
// concepto recortado aunque el usuario hubiera dado todo el detalle. Tres fugas:
// el prompt obligaba a resumir en 2-5 palabras, el titulo se reemplazaba por
// "Categoria — $monto" si el concepto pasaba de 40 caracteres (justo el que mas
// detalle daba lo perdia todo), y en los caminos que pasan por la sesion
// (elegir destino, confirmar) `parsed_fields` se sobrescribia y el mensaje
// original se perdia.
//
// Decision de producto (Mauricio, 2026-09-23): la descripcion sale de
// INTERPRETAR el mensaje, sin ninguna pregunta nueva. Si el usuario dio
// detalle, se guarda completo; si solo mando el monto, queda sin detalle.
//
// Todo lo de aqui es determinista y sin Deno/red, para que vitest lo pruebe.
// ⚠️ NO usar `\b` de JavaScript: es ASCII y no ve "á"/"é" como letra. Los
// bordes de palabra van con lookarounds `\p{L}` y flag `u`.
// ============================================================

import type { ParsedFields } from './types.ts';
import { CATEGORIA_LABELS } from './types.ts';

// Borde de palabra que entiende tildes y eñes.
const NO_LETRA_ANTES = '(?<![\\p{L}\\p{N}])';
const NO_LETRA_DESPUES = '(?![\\p{L}\\p{N}])';

// ------------------------------------------------------------
// Montos
// ------------------------------------------------------------

/**
 * Un numero seguido (o no) de su multiplicador coloquial. El grupo 1 es el
 * numero; el 2, el multiplicador. Va sin borde a la derecha a proposito:
 * "3.572.920correspondiente" (asi llego un mensaje real) tiene que reconocerse.
 */
const NUMERO_CON_MULTIPLICADOR =
  /(\d{1,3}(?:[.,]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(mil|lucas?|palos?|barras?|millones?|mill[oó]n)?/giu;

function valorDeNumero(numero: string, multiplicador: string | undefined): number {
  let n: number;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(numero)) {
    n = parseFloat(numero.replace(/\./g, '').replace(',', '.'));
  } else if (/^\d{1,3}(?:,\d{3})+$/.test(numero)) {
    n = parseInt(numero.replace(/,/g, ''), 10);
  } else {
    n = parseFloat(numero.replace(',', '.'));
  }
  const m = (multiplicador ?? '').toLowerCase();
  if (/^(mil|lucas?)$/.test(m)) return n * 1_000;
  if (/^(palos?|barras?|millones?|mill[oó]n)$/.test(m)) return n * 1_000_000;
  return n;
}

// Lo que acompaña al monto y se va con el: "por valor de", "por un total de",
// "por", "de", "$", "pesos". Se quita junto con el numero para que no queden
// conectores huerfanos ("Gasto en DEWALT por valor de en ESCOBILLAS").
const PREFIJO_MONTO =
  /(?:(?<![\p{L}])(?:por\s+(?:un\s+)?(?:valor|monto|total)(?:\s+de)?|por|de|en|son|fue|fueron)\s*)?(?:\$\s*)?$/iu;
const SUFIJO_MONTO = /^\s*(?:pesos|cop|mcte)(?![\p{L}])/iu;

/**
 * Quita del texto la PRIMERA aparicion del monto registrado, con su "por
 * valor de" y su "$". Compara por VALOR, no por forma: "30x30", "3/8",
 * "calibre 18" o "1 pulgada" son parte de lo que se compro y se quedan.
 */
export function quitarMonto(texto: string, monto: number | undefined): string {
  if (!monto || monto <= 0) return texto;
  if (/medio\s+palo/iu.test(texto) && monto === 500_000) {
    return texto.replace(/(?:por\s+|de\s+)?medio\s+palo/iu, ' ');
  }
  NUMERO_CON_MULTIPLICADOR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMERO_CON_MULTIPLICADOR.exec(texto)) !== null) {
    const inicio = m.index;
    // Un numero pegado a letras por la izquierda es una referencia, no el
    // monto ("MIG O.30", "B1"): se salta.
    if (inicio > 0 && /[\p{L}\d.,]/u.test(texto[inicio - 1])) continue;
    if (valorDeNumero(m[1], m[2]) !== monto) continue;
    const antes = texto.slice(0, inicio);
    let despues = texto.slice(inicio + m[0].length);
    const prefijo = antes.match(PREFIJO_MONTO);
    const corte = prefijo ? antes.length - prefijo[0].length : antes.length;
    despues = despues.replace(SUFIJO_MONTO, '');
    return `${antes.slice(0, corte)} ${despues}`;
  }
  return texto;
}

// ------------------------------------------------------------
// Codigo del negocio
// ------------------------------------------------------------

// "B1 26 2", "B 1 26 2" (asi llego en produccion), "T1261", "KAE-2", "P-12".
const CODIGO =
  '(?:[A-Za-z]\\s?\\d{1,2}\\s+\\d{2}\\s+\\d+|[A-Za-z]\\d\\d{2}\\d+|[A-Za-z]{2,4}-\\d{1,3}|P-?\\d{1,4}|#\\d{1,4})';

// "correspondiente" y sus erratas reales: CORRSPONDIENTE, CORREPSONDIENTE.
const CORRESPONDIENTE = 'corr?[a-z]{0,3}ondiente';

const FRASE_CODIGO = new RegExp(
  `${NO_LETRA_ANTES}(?:${CORRESPONDIENTE}\\s+)?` +
    `(?:(?:al|a|del|de|para|en)\\s+(?:el\\s+)?)?` +
    `(?:(?:proyecto|negocio|proy)\\s+)?` +
    `${NO_LETRA_ANTES}${CODIGO}${NO_LETRA_DESPUES}`,
  'giu',
);
// Codigo numerico legado: "al proyecto 12", "proy 7".
const PROYECTO_NUMERICO = new RegExp(
  `${NO_LETRA_ANTES}(?:(?:al|del|para|en)\\s+(?:el\\s+)?)?(?:proyecto|proy)\\s+\\d{1,4}${NO_LETRA_DESPUES}`,
  'giu',
);
// "correspondiente al proyecto" que quedo suelto al final.
const FRASE_CODIGO_HUERFANA = new RegExp(
  `(?:${CORRESPONDIENTE})(?:\\s+(?:al|a|del|de)\\s+(?:el\\s+)?(?:proyecto|negocio))?\\s*$`,
  'iu',
);

export function quitarCodigoNegocio(texto: string): string {
  // El prefijo "correspondiente al proyecto" puede venir pegado al numero
  // anterior ("3.572.920correspondiente"): se separa antes de buscar.
  const separado = texto.replace(new RegExp(`(\\d)(${CORRESPONDIENTE})`, 'giu'), '$1 $2');
  return separado
    .replace(FRASE_CODIGO, ' ')
    .replace(PROYECTO_NUMERICO, ' ')
    .replace(FRASE_CODIGO_HUERFANA, ' ');
}

// ------------------------------------------------------------
// Verbos de registro y conectores
// ------------------------------------------------------------

// "registrar gasto", "necesito registrar gastos", "gasto en", "pagué",
// "gasté", "compré", "pago de"... al INICIO del mensaje. Son la orden al bot,
// no la descripcion del gasto.
const VERBO_REGISTRO_INICIAL = new RegExp(
  '^\\s*(?:(?:hola|buenas|buenos\\s+d[ií]as|buenas\\s+(?:tardes|noches))[\\s,.!]+)?' +
    '(?:(?:necesito|quiero|quisiera|voy\\s+a|vamos\\s+a|por\\s+favor)\\s+)?' +
    '(?:(?:registr(?:ar|a|o|e|é)|anot(?:ar|a|e|é)|agreg(?:ar|a))(?:me)?\\s+(?:(?:un|el|los|unos)\\s+)?)?' +
    // Sin "compra" ni "pago" a secas: son sustantivos y son parte del detalle
    // ("Gaste 182300 para compra de insumos" conserva "compra de insumos").
    '(?:gastos?|pagu[eé]|pagamos|gast[eé]|gastamos|compr[eé]|compramos|invert[ií]|invertimos|egreso)' +
    NO_LETRA_DESPUES,
  'iu',
);

const CONECTOR_INICIAL = /^\s*(?:(?:de|del|en|para|por|a|al|con)(?![\p{L}\p{N}])|[:\-–—,.;])\s*/iu;
const CONECTOR_FINAL = /\s*(?:(?<![\p{L}\p{N}])(?:de|del|en|para|por|a|al|con|y)|[:\-–—,.;])\s*$/iu;

// Lo que queda si el mensaje no traia detalle: "gasto", "registrar", "hoy".
const SIN_DETALLE = /^(?:gastos?|registrar|registro|pago|compra|egreso|hoy|ayer|el|la|un|una|de)?$/iu;

function recortarBordes(texto: string): string {
  let t = texto.replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
  let previo = '';
  while (t !== previo) {
    previo = t;
    t = t.replace(CONECTOR_INICIAL, '').replace(CONECTOR_FINAL, '').trim();
  }
  return t;
}

/**
 * Limpia una descripcion: quita el monto, el codigo del negocio y el verbo de
 * registro, y los conectores que queden sueltos en los bordes. Devuelve
 * `undefined` si no queda detalle real (solo monto, "registrar gasto", etc.).
 * Sirve para el texto crudo del usuario Y para lo que devuelve el modelo (que
 * a veces deja el monto o el codigo aunque se le pida que no).
 */
export function extraerDescripcionGasto(
  texto: string | null | undefined,
  monto?: number,
): string | undefined {
  if (!texto) return undefined;
  let t = texto.replace(/\s+/g, ' ');
  t = quitarCodigoNegocio(t);
  t = quitarMonto(t, monto);
  t = recortarBordes(t);
  // El verbo puede venir despues de un conector que ya se recorto, y puede
  // venir dos veces ("Registrar gasto: gaste ..."): se quita en bucle.
  let previo = '';
  while (t !== previo) {
    previo = t;
    t = recortarBordes(t.replace(VERBO_REGISTRO_INICIAL, ''));
  }
  if (!/\p{L}/u.test(t)) return undefined;
  if (SIN_DETALLE.test(t)) return undefined;
  return t;
}

// ------------------------------------------------------------
// Lo que se guarda y lo que se muestra
// ------------------------------------------------------------

function formatoMonto(monto: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(monto);
}

/**
 * La categoria que sugirio el parser, SOLO si es una de las validas. Gemini y el
 * respaldo por regex pueden devolver texto libre ("tintos", "construccion") que
 * el CHECK de `gastos.categoria` rechaza: el insert fallaba y el usuario veia
 * "Ocurrio un error". Con esto cae al matcher por palabras clave o a 'otros'.
 */
export function categoriaConocida(hint: string | null | undefined): string | undefined {
  const h = (hint ?? '').trim().toLowerCase();
  return h && h in CATEGORIA_LABELS ? h : undefined;
}

/** El detalle del gasto si lo hay: descripcion completa, o el concepto de sesiones viejas. */
export function detalleGasto(fields: ParsedFields | null | undefined): string | undefined {
  const d = fields?.descripcion?.trim() || fields?.concept?.trim();
  return d || undefined;
}

/**
 * Valor de `gastos.descripcion`. Sin tope de longitud (la columna es `text`):
 * el detalle se guarda COMPLETO. "Categoria — $monto" solo cuando el mensaje no
 * traia ningun detalle.
 *
 * `concept` queda de respaldo para las sesiones que se abrieron antes de este
 * cambio y todavia no tienen `descripcion`.
 */
export function descripcionParaGuardar(
  fields: ParsedFields | null | undefined,
  categoria: string,
  monto: number,
): string {
  const detalle = detalleGasto(fields);
  if (detalle) return detalle;
  const label = CATEGORIA_LABELS[categoria] || categoria;
  return `${label} — ${formatoMonto(monto)}`;
}

/**
 * La descripcion recortada para MOSTRARLA en WhatsApp. Lo guardado no se toca;
 * esto existe porque el cuerpo de un mensaje con botones admite 1.024
 * caracteres y un mensaje largo lo haria rebotar.
 */
export function descripcionVisible(texto: string, max = 300): string {
  const t = texto.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function palabras(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}/]+/u)
    .filter(Boolean);
}

/**
 * Entre lo que devolvio el modelo y lo que sale del mensaje por reglas, cual se
 * guarda. Manda el modelo (entiende mejor un mensaje enredado o dictado), con
 * una red: si todo lo que el modelo dejo ESTA en la extraccion literal y esta
 * trae palabras de mas, el modelo recorto y no reformulo, y se guarda la literal.
 * Medido contra Gemini con mensajes reales: a veces bota una palabra suelta
 * ("invitacion cafe cierre" -> "invitacion cafe") o el proveedor.
 */
export function elegirDescripcion(
  delModelo: string | undefined,
  delMensaje: string | undefined,
): string | undefined {
  if (!delModelo) return delMensaje;
  if (!delMensaje) return delModelo;
  const deMensaje = palabras(delMensaje);
  const setMensaje = new Set(deMensaje);
  const recorto = palabras(delModelo).every((p) => setMensaje.has(p));
  return recorto && deMensaje.length > palabras(delModelo).length ? delMensaje : delModelo;
}

/**
 * Asegura `fields.descripcion` en un GASTO: limpia la del modelo y, si no hay,
 * la saca del mensaje crudo. Si el mensaje no traia detalle, queda ausente.
 */
export function conDescripcion<T extends { intent: string; fields: ParsedFields }>(
  result: T,
  rawMessage: string,
): T {
  if (result.intent !== 'GASTO') return result;
  const monto = result.fields.amount;
  const delModelo = extraerDescripcionGasto(result.fields.descripcion, monto);
  const delMensaje = extraerDescripcionGasto(rawMessage, monto);
  const descripcion = elegirDescripcion(delModelo, delMensaje);
  const fields = { ...result.fields };
  if (descripcion) fields.descripcion = descripcion;
  else delete fields.descripcion;
  return { ...result, fields };
}
