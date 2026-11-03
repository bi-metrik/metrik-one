/**
 * EL MARGEN DE LA COTIZACIÓN, con el de la línea de negocio como respaldo (decisión D4 de Mauricio,
 * 2026-10-29, Trappvel).
 *
 * ## El defecto
 *
 * Todo lector hacía `cot.margen_porcentaje ?? cot.margen_default_pct`. `??` solo cae al respaldo con
 * `null`: un 0 guardado en la cotización anulaba en silencio el 15 de la línea, y todas las Netas que
 * heredan salían a costo (COT-2026-0009: dos Netas a costo). El 0 llegaba sin que nadie lo escribiera:
 * la casilla «Margen» de Tarifas hacía `Number('')` al borrarla y salir, y `Number('') === 0`.
 *
 * ## La regla (la opción más segura)
 *
 * El margen de la cotización vale lo guardado si es MAYOR que 0. Un 0 (o nada) cuenta como «sin
 * dato» y manda el de la línea, si la línea declara uno mayor que 0. Si la línea no declara margen
 * (`margen_default_pct` 0 o nulo, como toda línea fuera de Trappvel), el 0 guardado vale 0, como
 * siempre: ahí no hay respaldo que tomar y nada cambia.
 *
 * Por qué no «el 0 vale si alguien lo escribió a propósito»: la base no guarda QUIÉN escribió el 0
 * ni por qué (haría falta una columna nueva, o sea una migración), y un 0 en el margen GENERAL
 * pone a costo todas las Netas a la vez, que es justo la pérdida que este frente evita. Vender UNA
 * opción a costo sigue siendo posible: su margen propio (`items.margen_porcentaje = 0`) no pasa por
 * aquí. Y la casilla general ya no escribe un 0 (ni vacío ni tecleado): lo rechaza diciendo eso.
 *
 * Puro: lo usan el recálculo, el contexto del piso, el editor y los adicionales.
 */

export interface MargenesDeCotizacion {
  margen_porcentaje?: number | string | null
  margen_default_pct?: number | string | null
}

const positivo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** El margen con que heredan las líneas Netas. `null` = la cotización no tiene ninguno. */
export function margenDeLaCotizacion(cot: MargenesDeCotizacion | null | undefined): number | null {
  if (!cot) return null
  const propio = positivo(cot.margen_porcentaje)
  if (propio !== null) return propio
  const respaldo = positivo(cot.margen_default_pct)
  if (respaldo !== null) return respaldo
  // Sin respaldo en la línea, lo guardado tal cual (un 0 sigue siendo 0, como siempre).
  const guardado = cot.margen_porcentaje ?? cot.margen_default_pct
  if (guardado === null || guardado === undefined || guardado === '') return null
  const n = Number(guardado)
  return Number.isFinite(n) ? n : null
}

/**
 * ¿Se puede escribir este margen en la cotización? `null` = sí. Un 0 no: con la línea declarando su
 * margen, se leería como «sin dato» y la pantalla volvería a mostrar el de la línea sin explicar por
 * qué. Para dejar UNA opción a costo, se le pone 0 a esa opción.
 */
export function motivoMargenDeCotizacionInvalido(pct: number, margenDeLaLinea: number | null | undefined): string | null {
  if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return 'El margen tiene que estar entre 0 % y 99 %.'
  if (pct === 0 && positivo(margenDeLaLinea) !== null) {
    return 'El margen de la cotización no puede quedar en 0 %: dejaría todas las opciones Netas a costo. Para dejar una opción a costo, ponle 0 % en esa opción.'
  }
  return null
}
