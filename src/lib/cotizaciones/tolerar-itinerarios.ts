/**
 * Tolerancia de despliegue para las tablas de itinerarios.
 *
 * ## Por qué existe
 *
 * `cotizacion_itinerarios` e `itinerario_opciones` las crea la migración
 * `20260914200000_cotizacion_itinerarios.sql`. Mientras no esté aplicada, un `select`
 * sobre ellas falla y —si nadie lo tolera— **el editor de cotización deja de abrir**,
 * que es una regresión mucho peor que no tener itinerarios.
 *
 * Este repo ya documenta el orden correcto —la migración va ANTES que el código que la
 * lee— y documenta también que ese orden se salta solo: hay PRs mergeados con su
 * migración sin aplicar, y la migración hermana de este mismo frente
 * (`20260914160000`, umbrales de margen) es una de ellas. Así que la LECTURA no
 * depende de que alguien recuerde el orden.
 *
 * ## La asimetría es deliberada: leer tolera, escribir NO
 *
 * Sin las tablas, leer devuelve «esta cotización no tiene itinerarios», que es
 * exactamente el estado de las 18 cotizaciones que existen hoy y el comportamiento de
 * R6. Escribir, en cambio, **falla con su error**: tragarse un insert dejaría a alguien
 * armando nueve combinaciones que no se guardan en ninguna parte, y eso no se ve hasta
 * que recarga la pantalla.
 *
 * **Esta pieza se borra el día que la migración esté aplicada en todos los entornos.**
 */

/** Lo mínimo que hace falta de un error de PostgREST para decidir. */
export interface ErrorPostgrest {
  code?: string | null
  message?: string | null
}

/** Las tablas que la migración crea. */
export const TABLAS_ITINERARIOS = ['cotizacion_itinerarios', 'itinerario_opciones'] as const

/**
 * ¿La consulta falló porque las tablas todavía no existen?
 *
 * PostgREST puede contestar de dos formas y las dos cuentan:
 *
 *  · `42P01` — el `undefined_table` de PostgreSQL, cuando la consulta llega a la base.
 *  · `PGRST205` — la tabla no está en la caché de esquema de PostgREST, que es lo que
 *    contesta cuando ni siquiera intenta la consulta.
 *
 * ⚠️ Se exige además que el mensaje **nombre una de las dos tablas**. Sin eso, un
 * `42P01` por otra tabla —un `from()` mal escrito, un join a algo que no existe— se
 * leería como «todavía no hay itinerarios» y el defecto real quedaría invisible, que es
 * justo el fallo mudo contra el que este repo escribe comentarios en cada migración.
 */
export function faltanLasTablasDeItinerarios(error: ErrorPostgrest | null | undefined): boolean {
  if (!error) return false
  const codigo = error.code ?? ''
  if (codigo !== '42P01' && codigo !== 'PGRST205') return false
  const mensaje = (error.message ?? '').toLowerCase()
  return TABLAS_ITINERARIOS.some(tabla => mensaje.includes(tabla))
}
