/**
 * Un texto leído de un documento, listo para comparar contra otro.
 *
 * Lo comparten los cruces de la línea (`comparar-valores.ts`), la validación del bloque
 * de un documento (`documentos/comparar-check.ts`) y las direcciones
 * (`direccion-predio.ts`). Si cada uno normalizara a su manera, el mismo par de valores
 * podría pasar en un sitio y avisar en otro.
 *
 * Lo que se pliega, medido en los casos abiertos de SOENA (2026-10-01):
 *
 * - **Letras de otro alfabeto** que la lectura del PDF mete por las latinas: el
 *   certificado de V0507 dice «JOHΝ» con la N griega (U+039D) y el RUT «JOHN». A la vista
 *   son idénticos; byte a byte no.
 * - **Tildes y eñes**: «CASTAÑO» contra «CASTANO», «Díaz» contra «DIAZ».
 * - **Puntuación y espacios repetidos**: «ALARCON  WILSON» (doble espacio), «COLOMBIA,».
 * - **Siglas con puntos**: «S.A.S.» es «SAS». Sin esto, la sigla se partía en tres
 *   letras sueltas y «TESLA MOTORS COLOMBIA, S.A.S.» no contenía «SAS».
 */

/** Letras griegas y cirílicas que se ven iguales a una latina (lectura de PDF). */
export const HOMOGLIFOS: Record<string, string> = {
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  α: 'a', ι: 'i', κ: 'k', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
  І: 'I', Ј: 'J', Ѕ: 'S',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', м: 'm', т: 't', і: 'i', ј: 'j', ѕ: 's',
}

/** Cambia cada letra griega o cirílica que imita a una latina por la latina. */
export function plegarHomoglifos(v: unknown): string {
  return [...String(v ?? '')].map(ch => HOMOGLIFOS[ch] ?? ch).join('')
}

/**
 * Minúsculas latinas, dígitos y un espacio entre palabras. Lo demás (tildes, signos,
 * letras de otro alfabeto que no imitan a una latina) desaparece o queda como espacio.
 */
export function normalizarTexto(v: unknown): string {
  return plegarHomoglifos(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // «s.a.s.» → «sas»: un punto ENTRE dos letras sueltas es una sigla, no un separador.
    .replace(/\b([a-z])\.(?=[a-z]\b)/g, '$1')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
