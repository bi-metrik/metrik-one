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

/** Un bloque sin `condition` aplica siempre. */
export function cumpleCondicion(
  cond: CondicionBloque | null | undefined,
  fuentes: FuentesCondicion,
): boolean {
  if (!cond) return true
  const fuente = resolverFuente(cond, fuentes)
  const raw = String(fuente[cond.field] ?? '')
  if (Array.isArray(cond.value_in)) {
    const target = norm(raw)
    return cond.value_in.some(v => norm(v) === target)
  }
  return raw === cond.value
}
