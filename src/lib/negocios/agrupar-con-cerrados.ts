/**
 * Aparta los negocios CERRADOS antes de agrupar la lista por día.
 *
 * ⚠️ POR QUÉ EXISTE
 *
 * Desde que la pestaña "Todos" lista abiertos **y** cerrados, la lista agrupada mezcla
 * dos cosas que no se miden igual. Los encabezados de grupo responden "qué cayó hoy en
 * esta etapa" (llegada) o "qué cita se viene" (cita): las dos preguntas se calculan
 * contra un reloj que para un cerrado dejó de correr. Un caso que salió del proceso en
 * marzo bajo el encabezado "Hoy" no es un detalle de presentación: es falso.
 *
 * Los cerrados van entonces en un grupo propio, **siempre el último**, con su rótulo.
 *
 * ⚠️ Y van DENTRO de los grupos, no fuera de ellos: la descarga a Excel manda los ids
 * de `grupos.flatMap(g => g.items)`. Un cerrado que se pinte por su cuenta, al margen de
 * `grupos`, se vería en pantalla y NO bajaría al archivo — exactamente la pérdida
 * silenciosa que la pestaña vino a corregir.
 */
import type { GrupoLlegada } from './agrupar-por-dia'

/**
 * Clave del grupo de cerrados. Va en el campo `dia` porque es lo que la pantalla usa
 * como `key`; no es una fecha y no se parsea como tal (mismo criterio que
 * `GRUPO_CITA_VENCIDA`).
 */
export const GRUPO_CERRADOS = 'cerrados'

export const ETIQUETA_CERRADOS = 'Cerrados'

/**
 * @param negocios         la lista ya filtrada y ordenada
 * @param esCerrado        quién salió del proceso. Se recibe como predicado a propósito:
 *                         quien llama lo sabe por el ORIGEN de la fila (viene del arreglo
 *                         de cerrados), que no puede desincronizarse de la consulta; un
 *                         criterio recalculado aquí sí podría.
 * @param agruparAbiertos  cómo se agrupan los que siguen vivos (por llegada o por cita)
 */
export function agruparApartandoCerrados<T>(
  negocios: T[],
  esCerrado: (n: T) => boolean,
  agruparAbiertos: (abiertos: T[]) => GrupoLlegada<T>[],
): GrupoLlegada<T>[] {
  const abiertos: T[] = []
  const cerrados: T[] = []
  for (const n of negocios) {
    if (esCerrado(n)) cerrados.push(n)
    else abiertos.push(n)
  }

  const grupos = agruparAbiertos(abiertos)
  if (cerrados.length === 0) return grupos
  return [...grupos, { dia: GRUPO_CERRADOS, etiqueta: ETIQUETA_CERRADOS, items: cerrados }]
}
