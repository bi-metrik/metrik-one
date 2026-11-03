/**
 * Qué opción PROPONE ONE para la Recomendada en un servicio con varias opciones de precio
 * (decisión de Mauricio, 2026-10-29, QA Trappvel S2 y M4): «la intermedia, el valor de la
 * mitad», la de mejor costo-beneficio entre la Económica (la más barata) y la Premium (la más
 * cara).
 *
 * Regla, con las opciones ordenadas de la más barata a la más cara:
 *  · una opción: esa;
 *  · dos opciones: empate (ninguna es «la del medio»); decide `RECOMENDADA_CON_DOS_OPCIONES`;
 *  · tres o más: entre las que NO son la más barata ni la más cara, la de precio más cercano al
 *    punto medio entre la más barata y la más cara. Con tres, siempre la del medio. A igual
 *    distancia, la más barata de las empatadas (y a igual precio, la primera por orden).
 *
 * Es solo la PROPUESTA: la asesora la cambia cuando quiera y, una vez cambiada, ONE no se la
 * vuelve a tocar (ver `planDeTarifas`).
 */

/**
 * Con exactamente dos opciones: la más cara (confirmado por Mauricio el 2026-10-29). Cambiar a
 * `'mas_barata'` aquí, en un solo lugar, si la decisión cambia.
 */
export const RECOMENDADA_CON_DOS_OPCIONES: 'mas_barata' | 'mas_cara' = 'mas_cara'

/**
 * El índice de la Recomendada dentro de `precios`, que llega YA ORDENADO de menor a mayor
 * (a igual precio, por el orden de las opciones). `-1` si la lista está vacía.
 */
export function indiceRecomendada(precios: readonly number[]): number {
  const n = precios.length
  if (n === 0) return -1
  if (n === 1) return 0
  if (n === 2) return RECOMENDADA_CON_DOS_OPCIONES === 'mas_cara' ? 1 : 0
  const medio = (precios[0] + precios[n - 1]) / 2
  let mejor = 1
  for (let i = 2; i < n - 1; i++) {
    if (Math.abs(precios[i] - medio) < Math.abs(precios[mejor] - medio)) mejor = i
  }
  return mejor
}
