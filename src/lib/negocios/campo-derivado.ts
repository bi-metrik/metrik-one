/**
 * Campo derivado: la regla, en un solo sitio.
 *
 * Un campo con `lock_when.mapping` no es una pregunta sino la CONSECUENCIA de la respuesta
 * de otro campo. Sirve para que el equipo responda una sola pregunta mientras el motor
 * sigue leyendo los campos de siempre, sin tocar routings ni condiciones.
 *
 * Vive aparte porque la regla la aplican DOS lados que tienen que coincidir exactamente:
 * el render (`BloqueDatos`, que bloquea el control y muestra el valor) y el guardado
 * (`actualizarBloqueData` / `marcarBloqueCompleto`, que lo persiste junto con la respuesta).
 * Si cada uno la implementara por su cuenta, tarde o temprano dirían cosas distintas —
 * el mismo defecto que ya costó caro con el ranking calculado en dos funciones.
 */

export type LockWhen = {
  source_bloque_slug: string
  source_etapa_orden?: number
  field: string
  value?: unknown
  force_value?: unknown
  mapping?: Record<string, unknown>
  /**
   * Regla puntual que CONVIVE con un `mapping` y le gana. Para el caso en que un campo se
   * deriva de una respuesta salvo cuando una condición dura de negocio lo determina por su
   * cuenta (leasing → sin devolución de IVA, contrate lo que contrate el cliente).
   * Su fuente puede ser otro bloque distinto al del `mapping`.
   */
  regla?: {
    source_bloque_slug: string
    source_etapa_orden?: number
    field: string
    value: unknown
    force_value: unknown
    hint?: string
  }
  hint?: string
}

export type EstadoDerivado = {
  /** El control no se responde a mano. Con `mapping` es SIEMPRE true: no es una pregunta. */
  bloqueado: boolean
  /** Valor que debe quedar persistido. `undefined` = el campo va vacío, a propósito. */
  valor: unknown
}

/**
 * Resuelve qué valor le corresponde a un campo dado el valor de su fuente.
 *
 * Sin `lock_when` no hay derivación. Con `value`/`force_value` es la regla puntual de
 * siempre (si la fuente vale X, forzar Y). Con `mapping`, cada respuesta de la fuente se
 * traduce a un valor de este campo.
 *
 * ⚠️ Una respuesta que no está en el mapa (o una fuente sin responder) deja el campo
 * VACÍO, nunca en `false`. Un `false` inventado es indistinguible de una negativa
 * deliberada, y es exactamente así como un caso se va por la rama equivocada sin que nadie
 * lo note. El vacío no es una respuesta: exigirla es trabajo del gate de la pregunta.
 */
export function resolverDerivado(
  lockWhen: LockWhen | undefined,
  valorFuente: unknown,
  /**
   * Valor de la fuente de la REGLA PUNTUAL, cuando convive con un `mapping` y vive en otro
   * bloque (`regla.source_bloque_slug`). Si se omite, la regla puntual se evalúa contra
   * `valorFuente`, que es el caso de siempre.
   */
  valorFuenteRegla?: unknown,
): EstadoDerivado {
  if (!lockWhen) return { bloqueado: false, valor: undefined }

  // Precedencia: una regla puntual de negocio gana sobre la derivación general.
  // El caso que lo obliga: `requiere_devolucion_iva` se deriva de qué contrató el cliente,
  // PERO si la titularidad es leasing no hay devolución de IVA, se haya contratado lo que
  // se haya contratado. Sin esta precedencia, configurar el mapping encima borraría esa
  // regla en silencio, que es justo la clase de pérdida muda que estamos persiguiendo.
  const regla = lockWhen.regla
  if (regla) {
    const observado = valorFuenteRegla !== undefined ? valorFuenteRegla : valorFuente
    if (observado === regla.value) {
      return { bloqueado: true, valor: regla.force_value }
    }
  }

  if (lockWhen.mapping) {
    const clave = valorFuente == null ? '' : String(valorFuente)
    return { bloqueado: true, valor: lockWhen.mapping[clave] }
  }

  return {
    bloqueado: valorFuente === lockWhen.value,
    valor: lockWhen.force_value,
  }
}
