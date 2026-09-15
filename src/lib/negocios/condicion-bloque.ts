/**
 * ¿La `condition` de un bloque se cumple con los datos de HOY?
 *
 * Un bloque puede declarar `config_extra.condition` para aparecer solo cuando otro
 * bloque respondió cierta cosa: el RUT del segundo titular solo aplica si en
 * Titularidad se dijo "copropiedad". La condición NO se congela al avanzar de etapa
 * — se evalúa cada vez que se dibuja la pantalla, contra los datos vigentes.
 *
 * ── Por qué vive aparte ───────────────────────────────────────────────────────────
 * La misma pregunta la hacen ahora dos lugares: la pantalla del negocio, que decide
 * qué bloques de la ETAPA ACTUAL renderiza, y el detalle en el servidor, que decide
 * qué bloques de ETAPAS PREVIAS manda al historial. Dos implementaciones de la misma
 * regla terminan divergiendo — es el defecto que este repo ya pagó con el ranking
 * calculado en dos funciones y con la fórmula de saldo escrita en cuatro. Aquí la
 * regla es una sola, pura y probada.
 *
 * ⚠️ LAS DOS COMPARACIONES NO SON LA MISMA. `value` compara cadenas EXACTAS y
 * `value_in` compara normalizando (sin tildes, sin mayúsculas, sin espacios al
 * borde). No es un descuido que se pueda "arreglar" unificándolas: es el
 * comportamiento que la pantalla lleva teniendo desde siempre, y las condiciones
 * configuradas en producción están escritas contra él. Unificar cambiaría en
 * silencio qué bloques ve el equipo en negocios vivos.
 */

export interface CondicionBloque {
  field: string
  value?: string
  value_in?: unknown[]
  /** Etapa (por `orden` INTERNO) de la que sale el dato. Vía legacy. */
  source_etapa_orden?: number
  /** Bloque del que sale el dato. Vía preferida: el slug es identidad estable. */
  source_bloque_slug?: string
}

/**
 * De dónde puede salir el dato que la condición mira, en orden de preferencia.
 * `etapaActual` es el bolsillo aplanado de la etapa que se está dibujando; solo se
 * usa cuando la condición no dice de dónde sacar el dato (condiciones intra-etapa).
 */
export interface FuentesCondicion {
  porSlug: Record<string, Record<string, unknown>>
  porEtapaOrden: Record<number, Record<string, unknown>>
  etapaActual?: Record<string, unknown>
}

const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

/** El bolsillo de datos contra el que se evalúa la condición. */
export function resolverFuente(
  cond: CondicionBloque,
  fuentes: FuentesCondicion,
): Record<string, unknown> {
  if (cond.source_bloque_slug && fuentes.porSlug[cond.source_bloque_slug]) {
    return fuentes.porSlug[cond.source_bloque_slug]
  }
  if (typeof cond.source_etapa_orden === 'number') {
    return fuentes.porEtapaOrden[cond.source_etapa_orden] ?? {}
  }
  return fuentes.etapaActual ?? {}
}

/**
 * ¿Este valor satisface la comparación de una condición? Solo la COMPARACIÓN, sin resolver
 * de dónde sale el dato.
 *
 * Existe aparte porque hay guardias que no son `condition` pero preguntan lo mismo (el
 * `solo_si` de la confirmación de cita DIAN). Si cada una comparara a su manera, una podría
 * aceptar `value_in` y otra no — que es exactamente cómo un bloque termina aplicando para
 * la pantalla y no para la siembra. Misma asimetría documentada arriba: `value` exacto,
 * `value_in` normalizado. Un valor vacío nunca está en una lista sin cadena vacía.
 */
export function valorCumpleCondicion(
  valor: unknown,
  cond: Pick<CondicionBloque, 'value' | 'value_in'>,
): boolean {
  const raw = String(valor ?? '')
  if (Array.isArray(cond.value_in)) {
    const target = norm(raw)
    return cond.value_in.some(v => norm(v) === target)
  }
  return raw === cond.value
}

/**
 * El valor esperado de una condición, como texto para mostrarlo ("completo o solo_iva").
 * `null` si la condición no declara ninguno. Sin esto el diagrama pintaba "= null" en toda
 * condición escrita con `value_in`.
 */
export function textoValorCondicion(cond: { value?: unknown; value_in?: unknown } | null | undefined): string | null {
  if (!cond) return null
  if (typeof cond.value === 'string') return cond.value
  if (Array.isArray(cond.value_in) && cond.value_in.length > 0) return cond.value_in.map(v => String(v)).join(' o ')
  return null
}

/**
 * Guardia `solo_si` de `cita_dian_confirmacion`: la siembra de "¿requiere cita?" solo corre
 * si un campo de otro bloque (por slug) vale lo esperado en ALGUNA de sus instancias.
 *
 * ⚠️ Antes comparaba solo `value`. Un `solo_si` escrito con `value_in` daba `false` siempre,
 * y un `false` aquí no es inocuo: la siembra lo lee como "el bloque dejó de aplicar" y
 * RETIRA la respuesta ya sembrada. Por eso acepta la misma comparación que `condition`.
 */
export type SoloSiBloque = { bloque_slug: string; field: string; value?: string; value_in?: unknown[] }

export function soloSiCumple(
  soloSi: SoloSiBloque,
  datosDelBloque: ReadonlyArray<Record<string, unknown> | null | undefined>,
): boolean {
  return datosDelBloque.some(d => valorCumpleCondicion((d ?? {})[soloSi.field], soloSi))
}

/** Un bloque sin `condition` aplica siempre. */
export function cumpleCondicion(
  cond: CondicionBloque | null | undefined,
  fuentes: FuentesCondicion,
): boolean {
  if (!cond) return true
  const fuente = resolverFuente(cond, fuentes)
  return valorCumpleCondicion(fuente[cond.field], cond)
}
