/**
 * Orden de las tablas de Ferretería, en el cliente y después de los filtros.
 *
 * Puro. Reglas:
 *   - números como número (no «100» antes que «20»);
 *   - fechas como fecha: el accesor de la columna las entrega con `fechaComoNumero`;
 *   - texto en orden natural y sin distinguir mayúsculas ni tildes: MP-2 antes que MP-10;
 *   - vacíos (null, undefined, NaN, '') al final en las DOS direcciones.
 * El orden es estable: a igual valor se respeta el orden de llegada.
 */

export type DireccionOrden = 'asc' | 'desc'
export type ValorOrden = string | number | null | undefined

const colador = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

function esVacio(v: ValorOrden): boolean {
  return v == null || (typeof v === 'number' && Number.isNaN(v)) || (typeof v === 'string' && v.trim() === '')
}

/** Compara dos valores de celda. Los vacíos siempre pierden, sin importar la dirección. */
export function compararValores(a: ValorOrden, b: ValorOrden, dir: DireccionOrden): number {
  const va = esVacio(a)
  const vb = esVacio(b)
  if (va || vb) return va === vb ? 0 : va ? 1 : -1
  let r: number
  if (typeof a === 'number' && typeof b === 'number') r = a - b
  else if (typeof a === 'number') r = -1 // un número suelto entre textos va primero
  else if (typeof b === 'number') r = 1
  else r = colador.compare(a as string, b as string)
  return dir === 'asc' ? r : -r
}

/** Copia ordenada. `valor` extrae de cada fila el dato de la columna. */
export function ordenarFilas<T>(filas: readonly T[], valor: (fila: T) => ValorOrden, dir: DireccionOrden): T[] {
  return [...filas].sort((x, y) => compararValores(valor(x), valor(y), dir))
}

/** Una fecha ISO («2026-09-24» o con hora) como número para ordenar; `null` si no se entiende. */
export function fechaComoNumero(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}
