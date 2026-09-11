/**
 * Qué se anota cuando alguien cambia el margen de un ítem.
 *
 * ## Por qué existe
 *
 * El margen nace con el default que declara la línea y es editable ítem por ítem. Así se
 * decidió a propósito: un piso duro no sube el margen, enseña a escribir el número que
 * deja pasar la pantalla, y el dato que llega después no sirve para nada.
 *
 * Pero "editable" sin rastro es exactamente cómo una agencia termina con ocho divisores
 * distintos conviviendo en el mismo mes y nadie sabiendo cuál es la política. No es una
 * hipótesis: es lo que se midió en la operación de 2025 de Trappvel.
 *
 * La decisión de QUÉ anotar vive aquí, separada del insert, porque es la parte con
 * reglas —cuándo callar, a qué entidad colgarlo, qué decir cuando no había margen— y es
 * la que se puede probar sin levantar medio Supabase.
 */

/** Lo que hay que saber del ítem ANTES de pisarle el margen. */
export interface ItemParaRastro {
  nombre: string | null
  /** `null` cuando el ítem no tenía margen legible: no es lo mismo que 0. */
  margenAnterior: number | null
  negocioId: string | null
  oportunidadId: string | null
}

/** Los campos de `activity_log` que describen el cambio. */
export interface RastroDeMargen {
  /** `activity_log.entidad_tipo` solo admite oportunidad, proyecto, negocio o contacto. */
  entidadTipo: 'negocio' | 'oportunidad'
  entidadId: string
  valorAnterior: string | null
  valorNuevo: string
  contenido: string
}

/** `activity_log.contenido` está limitado por un CHECK de la base. */
export const MAX_CONTENIDO_ACTIVIDAD = 280

/**
 * Qué anotar por este cambio de margen, o `null` si no hay nada que anotar.
 *
 * Devuelve `null` cuando:
 *  · el valor nuevo no es un número — no hay cambio que describir;
 *  · el margen no cambió — guardar el mismo número no es una decisión, y un timeline
 *    lleno de ruido es un timeline que nadie lee;
 *  · la cotización no cuelga ni de un negocio ni de una oportunidad — no hay dónde
 *    colgarlo, y `entidad_id` no admite nulo.
 *
 * Un margen que pasa de ausente a un valor SÍ se anota: es la primera vez que alguien
 * fija el precio de ese ítem.
 */
export function rastroDeCambioDeMargen(
  antes: ItemParaRastro,
  margenNuevo: number,
): RastroDeMargen | null {
  const nuevo = Number(margenNuevo)
  if (!Number.isFinite(nuevo)) return null
  if (antes.margenAnterior !== null && antes.margenAnterior === nuevo) return null

  const entidadTipo = antes.negocioId ? 'negocio' : 'oportunidad'
  const entidadId = antes.negocioId ?? antes.oportunidadId
  if (!entidadId) return null

  const anteriorTexto = antes.margenAnterior === null ? 'sin margen' : `${antes.margenAnterior}%`
  const nombre = antes.nombre?.trim() || 'ítem sin nombre'

  return {
    entidadTipo,
    entidadId,
    valorAnterior: antes.margenAnterior === null ? null : String(antes.margenAnterior),
    valorNuevo: String(nuevo),
    contenido: `Margen de "${nombre}": ${anteriorTexto} → ${nuevo}%`.slice(0, MAX_CONTENIDO_ACTIVIDAD),
  }
}
