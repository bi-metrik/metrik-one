// ============================================================
// Código de negocio escrito por WhatsApp — módulo PURO (sin Deno ni red)
//
// El código lo pone la base: `{código de la empresa} {YY} {consecutivo}` con espacios ("I1 26 5", "S12 26 13"),
// o la primera letra del contacto sin empresa ("P 26 1"). La gente lo escribe como le sale: "i1 26 5", "I1-26-5",
// "I1265", o dentro de una frase ("Revisa el I1 26 5"). Mauricio, 2026-10-20: el bot no lo reconoció en la
// respuesta a «¿Para cuál?» y contestó «Responde con un número» dos veces.
//
// Lo que devuelve es el código como lo guarda la base (mayúsculas, un espacio entre partes). La búsqueda en la base
// (`wa_find_negocios`) igual compara sin espacios ni guiones, así que una forma rara que pase aquí no se pierde.
// ============================================================

// Borde: ni letra ni dígito al lado (`\b` de JS no ve tildes).
const ANTES = '(?<![\\p{L}\\p{N}])';
const DESPUES = '(?![\\p{L}\\p{N}])';

// El año va de 20 a 29: así "a 15 2" o "y 30 4" no pasan por código.
// Con separadores (espacio, guion, punto, guion bajo): "I1 26 5", "I1-26-5", "p 26 1".
const CON_SEPARADOR = new RegExp(`${ANTES}([A-Za-z]\\d{0,3})[\\s\\-_.]+(2\\d)[\\s\\-_.]+(\\d{1,4})${DESPUES}`, 'u');
// Pegado: "I1265" → "I1 26 5". Solo con un dígito en el código de la empresa (I1, no I12): con más es ambiguo.
const PEGADO = new RegExp(`${ANTES}([A-Za-z]\\d)(2\\d)(\\d{1,4})${DESPUES}`, 'u');

/** El código de negocio que trae el texto, normalizado ("I1 26 5"), o null. */
export function extraerCodigoNegocio(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = texto.match(CON_SEPARADOR) ?? texto.match(PEGADO);
  if (!m) return null;
  // Sin dígito en el código de la empresa ("p 26 1") solo vale en mayúscula: en minúscula es un artículo o una
  // conjunción seguida de números ("a 25 3"), no un código.
  if (!/\d/.test(m[1]) && m[1] !== m[1].toUpperCase()) return null;
  return `${m[1].toUpperCase()} ${m[2]} ${Number(m[3])}`;
}

/** La llave con la que se comparan dos códigos: sin espacios, guiones ni puntos, en mayúscula. */
export function llaveCodigo(codigo: string | null | undefined): string {
  return String(codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
