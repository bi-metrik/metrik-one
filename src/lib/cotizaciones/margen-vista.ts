/**
 * De dónde sale el margen de una línea, dicho en palabras.
 *
 * ## Por qué hace falta
 *
 * `items.margen_porcentaje` es NULLABLE y sus tres estados no se distinguen mirando el
 * porcentaje:
 *
 *  · `null` → la línea USA el margen de la cotización. No es una excepción.
 *  · `0`    → la línea va A COSTO, y eso sí es una decisión de alguien.
 *  · `15`   → la línea margina distinto del resto.
 *
 * Un cuarto caso los atraviesa: con `precio_manual = true` el precio lo escribió una
 * persona y el margen se DERIVA de ese precio, no al revés — así que el número del
 * campo "margen" de esa línea no gobierna nada.
 *
 * Enseñar el porcentaje sin decir de dónde sale hace que "0,0%" se lea igual en los
 * dos primeros casos, y ahí es donde una cotización entera puede quedar a costo sin
 * que nadie se entere. Esta pieza es la única que traduce ese estado a texto.
 */

export type OrigenMargen = 'propio' | 'manual' | 'heredado'

/**
 * El precio escrito a mano MANDA sobre el margen propio.
 *
 * El orden importa: una línea puede tener las dos marcas (alguien le puso margen
 * propio y después escribió el precio). En ese caso el margen que la pantalla
 * enseña sale del precio, así que decir "propio de la línea" apuntaría al campo
 * equivocado — la cifra no cambia tocando ese campo.
 */
export function origenDelMargen(linea: {
  margenPropio: boolean
  precioManual: boolean
}): OrigenMargen {
  if (linea.precioManual) return 'manual'
  if (linea.margenPropio) return 'propio'
  return 'heredado'
}

/** Cómo se dice cada origen al lado del porcentaje. */
export function etiquetaOrigenMargen(origen: OrigenMargen): string {
  switch (origen) {
    case 'manual':
      return 'precio escrito a mano'
    case 'propio':
      return 'margen propio de la línea'
    case 'heredado':
      return 'hereda el margen de la cotización'
  }
}

/**
 * El porcentaje como se imprime: un decimal y coma, que es la convención local.
 *
 * `null` (sin margen medible) devuelve `null` y NO un "0,0%": un cero ahí afirma que
 * la línea se vende a costo, y lo único cierto es que todavía no hay con qué medirla.
 */
export function formatMargenPct(margenRealPct: number | null | undefined): string | null {
  if (margenRealPct === null || margenRealPct === undefined) return null
  if (!Number.isFinite(margenRealPct)) return null
  return `${margenRealPct.toFixed(1).replace('.', ',')}%`
}

/**
 * De qué color sale un margen según su nivel.
 *
 * Vive aquí, y no en la pantalla que lo usa, porque desde los itinerarios lo pintan
 * DOS superficies: la línea del editor y la fila de la tabla de combinaciones. Un
 * itinerario en rojo y su línea en ámbar por el mismo margen es una contradicción que
 * el usuario no puede resolver, y son dos `switch` que se desincronizan al primer
 * cambio de paleta.
 *
 * `sin_dato` NO se pinta de ningún color: regañar por no haber llegado todavía enseña
 * a ignorar el aviso.
 */
export function claseNivelMargen(nivel: 'sin_dato' | 'bajo_piso' | 'aviso' | 'ok'): string {
  switch (nivel) {
    case 'bajo_piso':
      return 'text-red-600'
    case 'aviso':
      return 'text-amber-600'
    default:
      return 'text-muted-foreground'
  }
}
