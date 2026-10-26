// ============================================================
// Una actividad larga en `activity_log`, sin perder texto
// ============================================================
//
// `activity_log.contenido` tiene CHECK de 280 caracteres (`char_length`: puntos de código, no bytes). El bot recortaba
// con `.slice(0, 280)` y en silencio: el 2026-10-26 una nota de voz de casi cinco minutos, transcrita completa (4.451
// caracteres), quedó registrada en S2 26 1 como sus primeros 279, cortada a mitad de frase. Un corte que nadie ve es un
// falso verde. Ahora un texto que no cabe va en varios comentarios seguidos, partidos entre palabras y numerados
// «(1/3)», que se insertan juntos: o quedan todos o ninguno.

export const TOPE_COMENTARIO = 280;

const largo = (s: string) => [...s].length;

/** Parte el texto en trozos de hasta `presupuesto` caracteres, entre palabras. Una palabra más larga (un enlace) se parte. */
function partir(texto: string, presupuesto: number): string[] {
  const trozos: string[] = [];
  let actual = '';
  for (const palabra of texto.match(/\S+\s*/g) ?? []) {
    if (largo((actual + palabra).trimEnd()) <= presupuesto) {
      actual += palabra;
      continue;
    }
    if (actual.trim()) trozos.push(actual.trim());
    let resto = [...palabra.trimEnd()];
    while (resto.length > presupuesto) {
      trozos.push(resto.slice(0, presupuesto).join(''));
      resto = resto.slice(presupuesto);
    }
    actual = resto.join('') + palabra.slice(palabra.trimEnd().length);
  }
  if (actual.trim()) trozos.push(actual.trim());
  return trozos;
}

/**
 * El contenido de cada comentario, con el prefijo (el emoji y, si aplica, «[nombre] ») en todos. Si cabe, uno solo y
 * sin número. Pura.
 */
export function comentariosDeActividad(prefijo: string, texto: string, tope = TOPE_COMENTARIO): string[] {
  const entero = `${prefijo}${texto}`;
  if (largo(entero) <= tope) return [entero];
  // El número de partes cambia el largo de la marca «(n/n) »: se prueba hasta que alcance.
  for (let n = 2; ; n++) {
    const presupuesto = tope - largo(prefijo) - largo(`(${n}/${n}) `);
    if (presupuesto < 1) throw new Error('el prefijo no deja espacio para el texto del comentario');
    const trozos = partir(texto, presupuesto);
    if (trozos.length <= n) return trozos.map((t, i) => `${prefijo}(${i + 1}/${trozos.length}) ${t}`);
  }
}

/**
 * Las filas para un solo `insert`. Cada una lleva su `created_at` un milisegundo después de la anterior: en el mismo
 * insert todas tendrían el mismo `now()`, y el timeline, que ordena por `created_at`, las mostraría en cualquier orden.
 * Pura.
 */
export function filasDeComentarios<T extends Record<string, unknown>>(
  fila: T,
  contenidos: string[],
  ahora = Date.now(),
): Array<T & { contenido: string; created_at: string }> {
  return contenidos.map((contenido, i) => ({ ...fila, contenido, created_at: new Date(ahora + i).toISOString() }));
}
