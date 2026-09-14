/**
 * Tolerancia de despliegue para las columnas que congelan los umbrales de margen.
 *
 * ## Por qué existe
 *
 * `cotizaciones.piso_margen_pct` y `aviso_margen_pct` las agrega la migración
 * `20260914160000_cotizaciones_umbrales_margen.sql`. Mientras esa migración no esté
 * aplicada, un INSERT que las nombre falla con `42703 column ... does not exist` y
 * **deja de poder crearse cotizaciones**, que es una regresión mucho peor que el
 * problema que estas columnas vienen a resolver.
 *
 * Este repo ya documenta el orden correcto —la columna va ANTES que el código que la
 * escribe— y también documenta que ese orden se salta solo: hay PRs mergeados con su
 * migración sin aplicar. Así que el código no depende de que alguien recuerde el
 * orden: si la columna no está, reintenta sin ella y lo dice por consola.
 *
 * La consecuencia de quedarse sin congelar es exactamente el estado anterior a este
 * cambio: la cotización cae a la política vigente de su línea. No se pierde ningún
 * dato y no se rompe ninguna pantalla.
 *
 * **Esta pieza se borra el día que la migración esté aplicada en todos los entornos.**
 */

/** Las columnas que la migración agrega. */
export const COLUMNAS_UMBRAL_MARGEN = ['piso_margen_pct', 'aviso_margen_pct'] as const

/** Lo mínimo que hace falta de un error de PostgREST para decidir. */
export interface ErrorPostgrest {
  code?: string | null
  message?: string | null
}

/**
 * ¿El INSERT falló porque las columnas de umbral todavía no existen?
 *
 * Se exige el código `42703` **y** que el mensaje nombre una de las dos columnas: un
 * `42703` por otra columna es un error real del código y tiene que propagarse, no
 * reintentarse con menos campos.
 */
export function faltaLaColumnaDeUmbrales(error: ErrorPostgrest | null | undefined): boolean {
  if (!error) return false
  if (error.code !== '42703') return false
  const mensaje = (error.message ?? '').toLowerCase()
  return COLUMNAS_UMBRAL_MARGEN.some((col) => mensaje.includes(col))
}

/** El mismo payload sin las columnas de umbral. No muta el original. */
export function sinUmbralesCongelados<T extends Record<string, unknown>>(payload: T): Omit<T, typeof COLUMNAS_UMBRAL_MARGEN[number]> {
  const copia = { ...payload } as Record<string, unknown>
  for (const col of COLUMNAS_UMBRAL_MARGEN) delete copia[col]
  return copia as Omit<T, typeof COLUMNAS_UMBRAL_MARGEN[number]>
}
