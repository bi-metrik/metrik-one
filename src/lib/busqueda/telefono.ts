/**
 * Coincidencia de teléfonos para las búsquedas libres de la aplicación.
 *
 * ⚠️ El mismo número está guardado de varias formas y ninguna es "la correcta":
 * medido en SOENA sobre 576 contactos con teléfono, 393 traen indicativo
 * (`+573127226316`), 175 traen separadores (`+57 (312) 7226316`, `310 2589129`)
 * y 43 son dígitos pelados. Dos contactos distintos llegan a tener EL MISMO
 * número escrito de dos maneras. Comparar el texto tal cual, que es lo que hace
 * el resto de la búsqueda, no encuentra casi nada.
 *
 * Por eso la comparación se hace sobre dígitos y contra el número NACIONAL: quien
 * busca teclea `3127226316` y el dato guardado puede traer el `57` adelante, o al
 * revés. Recortar a los últimos 10 dígitos deja los dos lados comparables sin
 * tener que adivinar si el indicativo está o no.
 */

/** Solo los dígitos del valor. `+57 (312) 722-6316` → `573127226316`. */
export const soloDigitos = (v: string): string => v.replace(/\D/g, '')

/**
 * Número nacional: los últimos 10 dígitos. Colombia usa 10 dígitos para celular,
 * así que esto retira el indicativo venga como venga (`57`, `+57`, `0057`) sin
 * asumir cuál es el prefijo. Un número más corto (fijo viejo, extensión) se
 * devuelve entero en vez de recortarse.
 */
export const numeroNacional = (v: string): string => {
  const d = soloDigitos(v)
  return d.length > 10 ? d.slice(-10) : d
}

/**
 * Mínimo de dígitos para que el término se trate como teléfono. Con menos, un
 * `31` haría coincidir a media base y la búsqueda dejaría de discriminar.
 */
const MIN_DIGITOS = 3

/**
 * ¿El término busca un teléfono? Solo si, ya sin separadores, quedan dígitos
 * suficientes. `null`/vacío nunca coincide.
 */
export const esTerminoTelefonico = (term: string): boolean =>
  soloDigitos(term).length >= MIN_DIGITOS

/**
 * ¿El teléfono guardado coincide con lo tecleado? Coincidencia parcial a
 * propósito: `315 950` debe encontrar al de `+57 315 950 9103`, porque en la
 * práctica se busca por el pedazo que uno recuerda.
 *
 * Devuelve false cuando el término es demasiado corto o el contacto no tiene
 * teléfono, para que quien llame no tenga que repetir esos guardas.
 */
export const telefonoCoincide = (guardado: string | null | undefined, term: string): boolean => {
  if (!guardado) return false
  if (!esTerminoTelefonico(term)) return false
  const buscado = numeroNacional(term)
  if (!buscado) return false
  return numeroNacional(guardado).includes(buscado)
}
