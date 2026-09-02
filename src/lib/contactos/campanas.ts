/**
 * Atribución de campaña de un contacto — FUENTE ÚNICA de la regla.
 *
 * Responde las tres preguntas que la supervisora comercial hace sobre un lead:
 * cuál campaña lo trajo la PRIMERA vez, cuál fue la última, y cuántos
 * formularios llenó. La primera es la que se usa para atribuir un cierre, así
 * que dos pantallas que la calculen por su cuenta terminarían atribuyendo el
 * mismo cierre a campañas distintas.
 *
 * Consumidores:
 *  - el panel lateral de `/negocios/[id]` (vía `getNegocioDetalle`, servidor)
 *  - `ResumenCampanas` en el 360 del contacto (`directorio/contacto/[id]`),
 *    que hoy tiene esta misma lógica escrita en línea. Ese archivo pertenece a
 *    otra sesión en curso y no se toca aquí; cuando esa rama aterrice, debe
 *    importar de este módulo en vez de conservar su copia.
 *
 * La regla, textual:
 *  - La PRIMERA sale de `custom_data.origen` del contacto, no del `min()` de
 *    las interacciones: ese campo es first-touch inmutable grabado por el
 *    webhook. Solo cuando el contacto no lo tiene (leads previos al webhook) se
 *    cae a la interacción más vieja que declare campaña.
 *  - Nombre y fecha salen SIEMPRE de la misma fuente. Medido el 2026-09-02: 333
 *    contactos del workspace SOENA tienen `origen.first_at` con
 *    `origen.campaign_name` en null (la llave existe, el valor no). Tomar el
 *    nombre de la interacción más vieja y la fecha de `origen` mezclaría dos
 *    orígenes y podría fechar mal la primera campaña.
 *  - Sin primera campaña no hay resumen: devuelve null y la pantalla no pinta
 *    el bloque.
 */

/** Origen (primer toque) grabado por el webhook en `contactos.custom_data.origen`. */
export type OrigenCampana = {
  campaign_name?: string | null
  first_at?: string | null
}

/** Lo mínimo que hace falta de una fila de `contacto_interacciones`. */
export type InteraccionCampana = {
  payload: Record<string, unknown> | null
  ocurrida_at: string | null
  created_at: string | null
}

export type ResumenCampanas = {
  /** Interacciones que declaran campaña. Es el "N formularios" de la pantalla. */
  formularios: number
  primeraNombre: string
  primeraFecha: string | null
  /** null cuando la más nueva no declara campaña. */
  ultimaNombre: string | null
  ultimaFecha: string | null
  /** Con un solo formulario, primera y última son la misma fila: se colapsa. */
  hayVarias: boolean
}

/**
 * Lee un texto del payload de la interacción. El payload de Meta trae
 * `campaign_name` y `ad_name` en las 703 de 703 interacciones medidas, pero el
 * tipo es `Record<string, unknown>`: se lee defensivo y sin placeholder.
 */
export function textoPayload(it: InteraccionCampana, key: string): string | null {
  const v = it.payload?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Espeja el orden con el que `getInteraccionesPorContacto` sirve las filas
 * (`ocurrida_at desc nulls last`, luego `created_at desc`). El resumen depende
 * del orden, así que ordenar aquí es lo que hace que el servidor y el 360 del
 * contacto lleguen al mismo resultado sin que quien llama tenga que acordarse.
 * Sobre una lista ya ordenada por la base no cambia nada.
 */
export function ordenarRecientesPrimero(interacciones: InteraccionCampana[]): InteraccionCampana[] {
  const cmpDesc = (a: string | null, b: string | null): number => {
    // nulls al final, como `nullsFirst: false` de PostgREST.
    if (a === b) return 0
    if (a === null) return 1
    if (b === null) return -1
    return a < b ? 1 : -1
  }
  return [...interacciones].sort(
    (x, y) => cmpDesc(x.ocurrida_at, y.ocurrida_at) || cmpDesc(x.created_at, y.created_at),
  )
}

export function resumenCampanasContacto(
  interacciones: InteraccionCampana[],
  origen: OrigenCampana | null | undefined,
): ResumenCampanas | null {
  const ordenadas = ordenarRecientesPrimero(interacciones)
  const conCampana = ordenadas.filter((it) => textoPayload(it, 'campaign_name') !== null)
  const masNueva = conCampana[0] ?? null
  const masVieja = conCampana[conCampana.length - 1] ?? null

  const origenNombre = origen?.campaign_name?.trim() || null
  const primeraNombre = origenNombre ?? (masVieja ? textoPayload(masVieja, 'campaign_name') : null)
  if (!primeraNombre) return null

  const primeraFecha = origenNombre
    ? origen?.first_at ?? null
    : masVieja?.ocurrida_at ?? masVieja?.created_at ?? null

  const ultimaNombre = masNueva ? textoPayload(masNueva, 'campaign_name') : null
  const ultimaFecha = masNueva?.ocurrida_at ?? masNueva?.created_at ?? null

  return {
    formularios: conCampana.length,
    primeraNombre,
    primeraFecha,
    ultimaNombre,
    ultimaFecha,
    hayVarias: conCampana.length > 1 && ultimaNombre !== null,
  }
}
