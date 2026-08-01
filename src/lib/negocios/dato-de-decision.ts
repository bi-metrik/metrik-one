/**
 * El motor exige el dato antes de decidir.
 *
 * Cuando una etapa bifurca, el motor lee un campo del negocio y lo compara con el valor de
 * cada condición. Si el campo está VACÍO ninguna condición matchea y el avance cae al
 * `default_etapa_orden`. Es decir: **el motor decide una ruta con un dato que no tiene, y
 * nadie se entera** — no hay error, no hay aviso, el caso simplemente aparece en otra rama.
 *
 * Lo que costó (SOENA, 2026-07-31): 17 negocios salieron de Entrega hacia Facturación, que
 * es la etapa de CIERRE, porque `requiere_cita_dian_iva` estaba vacío en todos. Un dato que
 * faltaba empujó los casos al cierre saltándose toda la fase de devolución de IVA.
 *
 * Premisa vigente (decisión de Mauricio, 2026-07-31): *un campo que decide una ruta es
 * siempre obligatorio, vive en un bloque que retiene, y ninguna decisión se evalúa sin él.
 * El vacío no es una respuesta.*
 *
 * ── Por qué vive aparte ──────────────────────────────────────────────────────────────────
 * La regla la aplican DOS sitios del motor que tienen que coincidir exactamente: el avance
 * de etapa (`cambiarEtapaNegocioConGate`) y el salto encadenado por saldo, que también
 * resuelve routing. Si cada uno la implementara por su cuenta terminarían diciendo cosas
 * distintas — el mismo defecto que ya costó caro con el ranking calculado en dos funciones.
 *
 * ── Opt-in ───────────────────────────────────────────────────────────────────────────────
 * La etapa declara que exige el dato (`config_extra.exigir_dato_de_decision = true`). Sin
 * ese flag el comportamiento de todo workspace queda idéntico al de hoy.
 */

export interface CondicionRouting {
  field: string
  value: string
}

export interface ReglaRouting {
  condition: CondicionRouting
  etapa_orden: number
}

export interface RoutingEtapa {
  default_etapa_orden: number
  conditional?: ReglaRouting[]
  /** Leer los campos desde otra etapa. Es el caso NORMAL, no el raro. */
  source_etapa_orden?: number
  label_default?: string
}

/**
 * ¿Esta etapa exige el dato antes de decidir?
 *
 * Solo el booleano `true` enciende la exigencia. Una config a medio escribir (`"true"`, `1`)
 * NO cambia el comportamiento: frenar avances es demasiado caro para hacerlo por accidente.
 */
export function exigeDatoDeDecision(configExtra: Record<string, unknown> | null | undefined): boolean {
  return configExtra?.exigir_dato_de_decision === true
}

/**
 * Campos distintos que gobiernan la bifurcación, en orden de aparición.
 *
 * Un routing sin condiciones no decide nada: no hay dato que exigir.
 */
export function camposDeDecision(routing: RoutingEtapa | null | undefined): string[] {
  const vistos = new Set<string>()
  for (const regla of routing?.conditional ?? []) {
    const campo = regla?.condition?.field
    if (typeof campo === 'string' && campo !== '' && !vistos.has(campo)) vistos.add(campo)
  }
  return [...vistos]
}

/**
 * ¿Este valor cuenta como respuesta?
 *
 * Se mide exactamente lo que el motor va a comparar: `String(valor ?? '')`. Así un `false`
 * booleano SÍ es respuesta (el routing lo compara contra `"false"` y puede tener una rama
 * para él), mientras que `null`, `undefined`, `''`, `'   '` y `[]` no lo son.
 *
 * ⚠️ Un campo ausente y un campo vacío son lo mismo para esto. El campo puede no existir
 * porque el bloque se creó después de que el negocio pasó por ahí (pasó en SOENA: el bloque
 * "Cita DIAN" de Entrega es de 2026-07-28 y los casos ya estaban en la etapa). No están sin
 * responder por descuido: no hay dónde responder. Igual el motor no puede decidir con eso.
 */
export function esRespuesta(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false
  return String(valor).trim() !== ''
}

/**
 * Un campo de decisión con su procedencia, para poder exigirlo y explicarlo.
 */
export interface CampoDecision {
  /** Slug del campo que lee el routing. */
  campo: string
  /** Etiqueta que ve el equipo. Cae al slug si el bloque no la declara. */
  label?: string | null
  /** Nombre del bloque donde se responde. `null` = ningún bloque lo declara. */
  bloque?: string | null
  /** Nombre de la etapa donde vive ese bloque. */
  etapa?: string | null
  /**
   * ¿La pregunta le corresponde a ESTE caso?
   *
   * Un bloque con `condition` que no se cumple no aplica, y entonces su campo vacío es
   * legítimo: el default es la ruta deliberada, no un accidente. Medido en SOENA: de los 7
   * casos de Entrega sin el dato, 2 (V0022, V0023) no requieren devolución de IVA, así que
   * el bloque no les aplica y frenarlos sería dejarlos sin salida. Los otros 5 sí.
   *
   * Por defecto aplica: un bloque sin condición le corresponde a todos.
   */
  aplica?: boolean
}

/**
 * De los campos que gobiernan la bifurcación, cuáles quedaron sin responder.
 *
 * `valores` es el mismo bolsillo que arma el motor: el `data` de todos los bloques `datos`
 * de la etapa fuente, fusionado.
 */
export function decisionesSinResponder(
  campos: CampoDecision[],
  valores: Record<string, unknown>,
): CampoDecision[] {
  return campos.filter(c => (c.aplica ?? true) && !esRespuesta(valores[c.campo]))
}

/**
 * El rechazo en palabras del equipo: QUÉ falta y DÓNDE se responde.
 *
 * Un "no se puede avanzar" seco obliga a adivinar. La etapa puede reemplazar el texto entero
 * con `config_extra.gate_messages.dato_de_decision`, igual que cualquier otro gate.
 */
export function mensajeDatoFaltante(faltante: CampoDecision, mensajeConfigurado?: string | null): string {
  if (typeof mensajeConfigurado === 'string' && mensajeConfigurado.trim() !== '') {
    return mensajeConfigurado
  }

  const pregunta = faltante.label?.trim() || faltante.campo

  if (!faltante.bloque) {
    // Nadie declara el campo: no es que falte la respuesta, es que falta dónde responderla.
    // Decirlo tal cual evita que el equipo busque una casilla que no existe.
    return `Falta el dato que decide por dónde sigue el caso: "${faltante.campo}". Ningún bloque de la etapa lo pide, así que hay que configurarlo antes de avanzar.`
  }

  const donde = faltante.etapa
    ? `el bloque "${faltante.bloque}" de la etapa ${faltante.etapa}`
    : `el bloque "${faltante.bloque}"`

  return `Falta responder "${pregunta}" en ${donde}. Sin ese dato el sistema no puede decidir por dónde sigue el caso.`
}
