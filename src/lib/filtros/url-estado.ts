// ============================================================
// Filtros que sobreviven al volver atrás — serialización pura
// ============================================================
// Los filtros de las listas (negocios, contactos) vivían solo en estado de React:
// filtrar, entrar a un caso y volver los borraba, y había que rehacerlos cada vez.
// Aquí viven las dos funciones puras que traducen entre el valor de un filtro y su
// representación en la query string; el hook `useEstadoUrl` las usa.
//
// Reglas de diseño:
//  - Un filtro en su valor POR DEFECTO no aparece en la URL. Así la vista sin filtrar
//    tiene URL limpia y un enlace compartido solo carga lo que alguien eligió a mano.
//  - El tipo se deduce del valor inicial, no se declara aparte: un `number` vuelve
//    como number, un `boolean` como boolean. Si el texto de la URL no encaja con ese
//    tipo (alguien editó la barra de direcciones), gana el valor por defecto.

/** Valores que un filtro puede tomar. Cubre los 12 filtros de negocios y contactos. */
export type ValorFiltro = string | number | boolean | null

/**
 * Texto con el que un valor viaja en la query string. `null` = no viaja.
 *
 * `null` como valor de filtro (ej. "ninguna etapa seleccionada") se representa con la
 * ausencia del parámetro, igual que el default: los dos significan "sin elegir".
 */
export function serializarFiltro(valor: ValorFiltro, porDefecto: ValorFiltro): string | null {
  if (valor === null || valor === undefined) return null
  if (valor === porDefecto) return null
  if (typeof valor === 'boolean') return valor ? '1' : '0'
  const texto = String(valor)
  return texto === '' ? null : texto
}

/**
 * Valor de un filtro a partir del texto de la URL, tipado según el valor por defecto.
 *
 * Un texto que no encaja con el tipo esperado NO se fuerza: devuelve el default. Es
 * la diferencia entre una URL manipulada que cae en la vista sin filtrar y una que
 * deja la lista mostrando `NaN` casos.
 */
export function parsearFiltro(texto: string | null, porDefecto: ValorFiltro): ValorFiltro {
  if (texto === null || texto === '') return porDefecto

  if (typeof porDefecto === 'boolean') {
    if (texto === '1' || texto === 'true') return true
    if (texto === '0' || texto === 'false') return false
    return porDefecto
  }

  if (typeof porDefecto === 'number') {
    const n = Number(texto)
    return Number.isFinite(n) ? n : porDefecto
  }

  // `null` por defecto (ej. etapa sin elegir) admite number o string según el texto:
  // los filtros que arrancan en null en estas listas guardan números de etapa.
  if (porDefecto === null) {
    const n = Number(texto)
    return texto.trim() !== '' && Number.isFinite(n) ? n : texto
  }

  return texto
}

/** Forma en que Next entrega los parámetros de la URL a un server component. */
export type SearchParams = Record<string, string | string[] | undefined>

/**
 * Valor de un filtro leído de los `searchParams` que resuelve el SERVIDOR.
 *
 * Existe para que servidor y cliente pinten lo mismo en el primer render. Si el
 * servidor ignora la URL, el HTML llega con la lista sin filtrar y el cliente hidrata
 * con la filtrada: React descarta ese subárbol, la lista parpadea y queda un error de
 * hidratación en consola.
 */
export function filtroDesdeSearchParams<T extends ValorFiltro>(
  searchParams: SearchParams | undefined,
  clave: string,
  porDefecto: T,
  admisibles?: readonly T[],
): T {
  const crudo = searchParams?.[clave]
  // Un parámetro repetido (`?fase=a&fase=b`) llega como arreglo: gana el primero.
  const texto = Array.isArray(crudo) ? (crudo[0] ?? null) : (crudo ?? null)
  const parseado = parsearFiltro(texto, porDefecto) as T
  if (admisibles && !admisibles.includes(parseado)) return porDefecto
  return parseado
}

/**
 * Query string resultante de aplicar un cambio sobre la actual, preservando todo
 * parámetro ajeno a los filtros (ej. `?empresa_id=` que llega del Directorio).
 *
 * Se calcula desde la URL de AHORA y no desde una copia guardada al montar: con un
 * hook por filtro, dos cambios seguidos sobre una copia vieja se pisarían entre sí.
 */
export function aplicarFiltroEnQuery(
  queryActual: string,
  clave: string,
  valor: ValorFiltro,
  porDefecto: ValorFiltro,
): string {
  const params = new URLSearchParams(queryActual)
  const texto = serializarFiltro(valor, porDefecto)
  if (texto === null) params.delete(clave)
  else params.set(clave, texto)
  return params.toString()
}
