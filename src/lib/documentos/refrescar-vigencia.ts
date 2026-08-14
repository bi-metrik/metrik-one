/**
 * Reevaluación de la vigencia AL LEER el negocio.
 *
 * El resultado del cross-check se calcula cuando se carga el documento y se
 * guarda en `negocio_bloques.data._cross_check`. Para casi todos los modos eso
 * está bien: comparar dos textos da lo mismo hoy que en un mes.
 *
 * ⚠️ La vigencia NO. Su veredicto depende de dos cosas que se mueven después de
 * guardarlo:
 *
 *   - la fecha objetivo (la DIAN reprograma citas), y
 *   - **el día de hoy**, cuando el criterio es el margen sin cita: ahí el
 *     objetivo es `hoy + margen`, así que un certificado guardado como vigente
 *     deja de serlo solo con que pase el tiempo.
 *
 * Sin este refresco, la pantalla mostraría para siempre la foto del día que
 * alguien subió el archivo: se vería sana y estaría mintiendo, que es peor que
 * verse rota. Y el frente entero existe para que la alerta llegue por la
 * plataforma en vez de revisarse caso por caso.
 *
 * El recálculo es DERIVADO y no se persiste, por la misma razón que `pedirDesde`
 * nunca se guarda: un veredicto congelado vuelve a quedar viejo mañana.
 */

import { estadoVigencia, type CriterioVigencia, type EstadoVigencia } from './vigencia'

/** La forma mínima de un resultado guardado que este módulo necesita tocar. */
export type ResultadoCrossCheck = {
  slug: string
  expected: string
  extracted: string
  ok: boolean
  mode?: string
  estado?: 'ok' | 'falla' | 'no_comprobable'
  vigencia?: EstadoVigencia
  pedir_desde?: string | null
  criterio?: CriterioVigencia
  [otras: string]: unknown
}

export type CrossCheckGuardado = {
  passed: boolean
  solo_alerta?: boolean
  results: ResultadoCrossCheck[]
  [otras: string]: unknown
}

/** La parte de la config del check que gobierna la vigencia. */
export type SpecVigencia = {
  slug: string
  label?: string
  match_mode?: string
  vigencia_dias?: number
  margen_sin_cita_dias?: number
  source_field?: string
  source_bloque_slug?: string
  source_etapa_orden?: number
  source_alternatives?: unknown[] | null
}

/**
 * Devuelve el valor VIGENTE de la fecha objetivo de un check, o `null` si no se
 * puede resolver (entonces la fila se deja como está y no se inventa nada).
 */
export type ResolverObjetivo = (spec: SpecVigencia) => string | null

/**
 * Valor extraído del documento para ese check (la fecha de expedición), leído
 * del bloque. Solo hace falta para SINTETIZAR el veredicto de un documento que
 * se cargó antes de que el check existiera: sin él no habría nada que evaluar.
 */
export type ResolverExtraido = (spec: SpecVigencia) => string | null

/**
 * Recalcula las filas de `match_mode: 'vigencia'` contra el objetivo de hoy.
 *
 * Devuelve el MISMO objeto si nada cambió, para que quien llama pueda evitar
 * trabajo (y para que el `data` del bloque no se reescriba por gusto).
 *
 * No toca los demás modos: comparar dos textos no caduca.
 */
export function refrescarVigenciaCrossCheck(
  cc: CrossCheckGuardado | null | undefined,
  checks: SpecVigencia[],
  resolverObjetivo: ResolverObjetivo,
  hoyISO: string,
  resolverExtraido?: ResolverExtraido,
): CrossCheckGuardado | null | undefined {
  const specPorSlug = new Map<string, SpecVigencia>()
  for (const c of checks) {
    if ((c?.match_mode ?? 'exact') === 'vigencia' && c?.slug) specPorSlug.set(c.slug, c)
  }
  if (specPorSlug.size === 0) return cc

  // Un documento cargado ANTES de que el check existiera no tiene veredicto
  // guardado, y sin esto la señal solo llegaría a los que se volvieran a subir.
  // Medido en SOENA (2026-08-13): 136 casos abiertos con certificado, y solo 22
  // con veredicto — o sea que sin sintetizar, la alerta cubriría uno de cada seis.
  //
  // Se sintetiza SOLO si todos los checks del bloque son de vigencia: si hubiera
  // otros modos sin evaluar, un panel que dice "validado" afirmaría de más sobre
  // comprobaciones que nadie hizo.
  if (!cc || !Array.isArray(cc.results) || cc.results.length === 0) {
    if (!resolverExtraido || specPorSlug.size !== checks.length) return cc
    const results = [...specPorSlug.values()].flatMap(spec => {
      const extraido = resolverExtraido(spec)
      const objetivo = resolverObjetivo(spec)
      if (extraido === null || objetivo === null) return []
      return [filaVigencia(spec, extraido, objetivo, hoyISO)]
    })
    if (results.length === 0) return cc
    return {
      ...(cc ?? {}),
      passed: results.every(r => r.estado !== 'falla'),
      results,
    }
  }

  let cambio = false
  const results = cc.results.map(r => {
    const spec = specPorSlug.get(r.slug)
    if (!spec) return r
    // Un check con fuentes alternativas elige la que PASA, no la primera que
    // exista; reproducir esa elección aquí sería una segunda copia del criterio
    // y ya se pagó el precio de tener dos. Se deja el veredicto guardado.
    if (spec.source_alternatives && spec.source_alternatives.length > 0) return r

    const objetivo = resolverObjetivo(spec)
    // `null` = no se pudo resolver el bloque fuente en esta lectura. Distinto de
    // "no hay cita todavía" (cadena vacía), que SÍ es una respuesta y la usa el
    // criterio del margen.
    if (objetivo === null) return r

    const fila = { ...r, ...filaVigencia(spec, r.extracted, objetivo, hoyISO) }
    if (!fila.criterio) delete fila.criterio

    if (
      fila.expected !== r.expected
      || fila.ok !== r.ok
      || fila.estado !== r.estado
      || fila.vigencia !== r.vigencia
      || fila.pedir_desde !== r.pedir_desde
      || fila.criterio !== r.criterio
    ) cambio = true

    return fila
  })

  if (!cambio) return cc

  // `passed` se recalcula desde las filas: un check que no se pudo comprobar NO
  // tumba el conjunto (ese es justo el estado que existe para no bloquear).
  const passed = results.every(r => (r.estado ?? (r.ok ? 'ok' : 'falla')) !== 'falla')
  return { ...cc, passed, results }
}

/** El veredicto de una fila de vigencia, calculado contra el objetivo de hoy. */
function filaVigencia(
  spec: SpecVigencia,
  extraido: string,
  objetivo: string,
  hoyISO: string,
): ResultadoCrossCheck {
  const v = estadoVigencia(extraido, objetivo, {
    vigenciaDias: spec.vigencia_dias,
    hoyISO,
    margenSinObjetivoDias: spec.margen_sin_cita_dias,
  })
  const estado: 'ok' | 'falla' | 'no_comprobable' =
    v.estado === 'no_comprobable' ? 'no_comprobable' : v.estado === 'vigente' ? 'ok' : 'falla'

  return {
    slug: spec.slug,
    label: spec.label ?? spec.slug,
    expected: objetivo,
    extracted: extraido,
    ok: estado === 'ok',
    mode: 'vigencia',
    estado,
    vigencia: v.estado,
    pedir_desde: v.pedirDesde,
    ...(v.criterio ? { criterio: v.criterio } : {}),
  }
}
