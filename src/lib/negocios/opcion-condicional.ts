/**
 * Opciones que no aplican a todos los casos.
 *
 * `showIf` decide si un campo entero se muestra. Esto es más fino: decide si UNA OPCIÓN de
 * un `radio`/`select` se le ofrece al usuario, según el valor de un campo de otro bloque.
 *
 * El caso que lo obliga (SOENA VE): un vehículo en leasing **no tiene** proceso de
 * devolución de IVA. No es que la respuesta se corrija después: es que esa alternativa no
 * existe para ese caso, así que ofrecerla es invitar a un error que luego hay que atajar.
 * La diferencia importa — forzar el valor a posteriori deja al usuario eligiendo algo que
 * el sistema le contradice en silencio; no ofrecerlo deja el formulario diciendo la verdad.
 */

export type OpcionSoloSi = {
  source_bloque_slug: string
  source_etapa_orden?: number
  field: string
  /** La opción se ofrece solo si el valor de la fuente está en esta lista. */
  value_in?: unknown[]
  /** La opción se ofrece solo si el valor de la fuente NO está en esta lista. */
  distinto_de?: unknown[]
  /** Por qué no aplica, para mostrarlo cuando corresponda. */
  motivo?: string
}

export type OpcionCondicional = {
  value: unknown
  label?: string
  solo_si?: OpcionSoloSi
}

/**
 * ¿Se le ofrece esta opción al usuario?
 *
 * ⚠️ Con la fuente SIN RESPONDER la opción se ofrece. No se asume la restricción: si
 * todavía no sabemos si el vehículo es leasing, esconder las opciones de devolución de IVA
 * sería adivinar, y adivinar en contra del usuario es peor que preguntar. Quien garantiza
 * que la fuente esté respondida antes es su propio `required`.
 */
export function opcionAplica(opcion: OpcionCondicional, valorFuente: unknown): boolean {
  const s = opcion.solo_si
  if (!s) return true
  if (valorFuente == null || valorFuente === '') return true

  if (s.distinto_de && s.distinto_de.some(v => v === valorFuente)) return false
  if (s.value_in && !s.value_in.some(v => v === valorFuente)) return false
  return true
}

/**
 * Las opciones a pintar, y si la respuesta YA GUARDADA dejó de aplicar.
 *
 * Una opción que deja de aplicar **no se esconde si es la que está seleccionada**. Esconder
 * el valor elegido lo volvería un dato fantasma: invisible en pantalla y vivo en la base,
 * que es exactamente el patrón que ya costó caro (el bloque que deja de mostrarse pero
 * sigue decidiendo la ruta). Se muestra marcada, para que se vea y se pueda cambiar.
 */
export function resolverOpciones<T extends OpcionCondicional>(
  opciones: T[],
  valorSeleccionado: unknown,
  valorDeFuente: (solo_si: OpcionSoloSi) => unknown,
): { visibles: T[]; seleccionadaYaNoAplica: boolean; motivo?: string } {
  let seleccionadaYaNoAplica = false
  let motivo: string | undefined

  const visibles = opciones.filter(o => {
    const aplica = opcionAplica(o, o.solo_si ? valorDeFuente(o.solo_si) : undefined)
    if (aplica) return true
    if (o.value === valorSeleccionado) {
      seleccionadaYaNoAplica = true
      motivo = o.solo_si?.motivo
      return true
    }
    return false
  })

  return { visibles, seleccionadaYaNoAplica, motivo }
}
