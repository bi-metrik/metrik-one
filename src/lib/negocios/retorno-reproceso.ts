/**
 * A qué etapa vuelve un reproceso: la declarada, o la siguiente que SÍ le aplica al caso.
 *
 * `reproceso-actions.ts` devuelve el caso a la etapa que declara `reproceso_de` para el
 * tipo. Para una devolución DIAN, en SOENA, es Cita. Pero no todo caso lleva cita: la
 * bifurcación la decide el routing de Cartera (`requiere_cita_dian`) o el de Entrega
 * (`requiere_cita_dian_iva`), con `true` → Cita y `false` → Anexos. V0374 (Manizales) se
 * reprocesó el 2026-09-11 y quedó parado en Cita, una etapa que nunca le correspondía.
 *
 * ── La regla, sin nada de SOENA adentro ──────────────────────────────────────────────
 * 1. Las etapas que PUEDEN mandar un caso a la etapa declarada (D) son las anteriores a
 *    ella cuyo `routing.conditional` tiene alguna rama hacia D. Si no hay ninguna, D no es
 *    una bifurcación y el retorno no cambia.
 * 2. Se evalúan esas decisiones con el bolsillo que usa el motor para avanzar
 *    (`camposDeRoutingDelNegocio`: solo bloques que le aplican al caso). Solo cuenta una
 *    respuesta EXPLÍCITA: un campo ausente no es un `false` (lección del 2026-09-09,
 *    `_campo_retirado`: el ausente cae al `default`, que en Entrega es Facturación).
 *    - Si alguna manda a D → vuelve a D.
 *    - Si alguna manda a otra etapa T → vuelve a T (la decisión más cercana a D gana).
 * 3. Si ninguna decisión tiene respuesta, se prueba con la que el propio flujo habría
 *    sembrado (`derivados`, ver `derivarRespuestaDeCita`). Mismo criterio.
 * 4. Si tampoco, vuelve a D como hoy, y quien llama avisa que no se pudo confirmar.
 *
 * ── "Antes" y "después" se miden por el FLUJO, no por `orden` ───────────────────────
 * El `orden` no ordena el recorrido. En la línea GIT EV/HEV de SOENA el flujo DIAN es
 * Cita (16) → Notificación (17) → Anexos (18) → Generación (13) → Envío (14) →
 * Seguimiento (19) → Facturación (15). Comparando `orden`, un reproceso desde Seguimiento
 * archivaba Cita, Notificación, Anexos y Seguimiento pero NO Generación ni Envío (13 y 14
 * «van antes» de 16), y un caso en Generación o Envío no se podía reprocesar nunca. Medido
 * el 2026-09-14: 15 devoluciones DIAN desde Seguimiento, ninguna archivó esas dos etapas.
 * Decisión de Mauricio (2026-09-14): cuando la DIAN devuelve el caso, Generación y Envío
 * también se reabren.
 *
 * Por eso las TRES preguntas de esta operación usan el mismo vocabulario —qué decisiones
 * van antes de D, si el caso está antes del retorno y qué tramo se rehace—: el recorrido
 * del routing (`etapasAguasAbajo`, el mismo de `retorno-decision.ts`). Una línea que no
 * declara routing en ninguna etapa se sigue midiendo por `orden`, exactamente como antes.
 *
 * Puro: no toca base ni red.
 */

import { esRespuesta, type RoutingEtapa } from './dato-de-decision'
import { etapasAguasAbajo } from './retorno-decision'

export interface EtapaRetorno {
  id: string
  nombre: string
  orden: number
  config_extra: Record<string, unknown> | null
}

export function routingDeEtapa(etapa: EtapaRetorno): RoutingEtapa | null {
  const r = etapa.config_extra?.routing as RoutingEtapa | null | undefined
  return r && typeof r === 'object' ? r : null
}

/** ¿Alguna etapa de la línea declara routing? Sin ninguno, el recorrido es el `orden`. */
export function lineaConRouting(etapas: readonly EtapaRetorno[]): boolean {
  return etapas.some((e) => routingDeEtapa(e) !== null)
}

/**
 * Los `orden` que un caso puede pisar saliendo de `origenOrden`, incluida ella misma.
 *
 * Con routing en la línea, se recorren TODAS las salidas (default y ramas) con
 * `etapasAguasAbajo`. Sin routing en ninguna etapa, las de `orden` mayor o igual: es el
 * criterio de siempre y ninguna línea sin routing cambia de comportamiento.
 */
export function alcanzablesPorFlujo(etapas: readonly EtapaRetorno[], origenOrden: number): Set<number> {
  if (!lineaConRouting(etapas)) {
    return new Set(etapas.filter((e) => e.orden >= origenOrden).map((e) => e.orden))
  }
  const flujo = etapas.map((e) => ({ orden: e.orden, routing: routingDeEtapa(e) }))
  const out = etapasAguasAbajo(flujo, origenOrden)
  out.add(origenOrden)
  return out
}

export type TramoReproceso =
  | { antesDelRetorno: true }
  | { antesDelRetorno: false; etapas: EtapaRetorno[] }

/**
 * El tramo que se rehace al devolver un caso de `actualOrden` a `retornoOrden`.
 *
 * - **Antes del retorno**: la etapa actual no se alcanza desde el retorno. No hay tramo que
 *   rehacer; quien llama ofrece registrar el error sin devolver el caso.
 * - **Tramo**: toda etapa que esté en ALGÚN camino del retorno a la actual (se alcanza desde
 *   el retorno y desde ella se alcanza la actual). Así, en SOENA, volver de Seguimiento a
 *   Cita rehace Cita, Notificación, Anexos, Generación, Envío y Seguimiento, y deja fuera
 *   Facturación, que va después.
 *
 * Con un ciclo en el flujo (Notificación → Cita por PQR rechazado) la etapa del ciclo entra
 * al tramo aunque el caso esté en la misma etapa de retorno: un caso en Cita pudo haber
 * pasado ya por Notificación y volver. Si no pasó, sus bloques no tienen datos de ese ciclo
 * y el archivado los salta.
 */
export function tramoDelReproceso(
  etapas: readonly EtapaRetorno[],
  retornoOrden: number,
  actualOrden: number,
): TramoReproceso {
  const desdeRetorno = alcanzablesPorFlujo(etapas, retornoOrden)
  if (!desdeRetorno.has(actualOrden)) return { antesDelRetorno: true }
  return {
    antesDelRetorno: false,
    etapas: etapas.filter((e) => desdeRetorno.has(e.orden) && alcanzablesPorFlujo(etapas, e.orden).has(actualOrden)),
  }
}

/**
 * Las etapas ANTES de D (D no las alcanza por el flujo) que tienen alguna rama condicional
 * hacia D, la más cercana primero. Notificación también manda a Cita, pero va después: es el
 * desenlace del PQR, no una decisión de entrada.
 *
 * "La más cercana" se sigue ordenando por `orden`: en SOENA coincide con el flujo (Cartera
 * → Entrega → Cita) y no hay otra línea que declare un punto de retorno.
 */
export function decisionesHaciaDestino(etapas: readonly EtapaRetorno[], destinoOrden: number): EtapaRetorno[] {
  const despuesDeD = alcanzablesPorFlujo(etapas, destinoOrden)
  return etapas
    .filter((e) => !despuesDeD.has(e.orden))
    .filter((e) => (routingDeEtapa(e)?.conditional ?? []).some((c) => c?.etapa_orden === destinoOrden))
    .sort((a, b) => b.orden - a.orden)
}

/** Los campos de una decisión que la mandan (o no) a D. */
export function camposDeLaDecision(etapa: EtapaRetorno, destinoOrden: number): string[] {
  const conds = routingDeEtapa(etapa)?.conditional ?? []
  const campos = new Set<string>()
  for (const c of conds) {
    if (c?.etapa_orden === destinoOrden && typeof c.condition?.field === 'string') campos.add(c.condition.field)
  }
  return [...campos]
}

export interface RamaTomada {
  etapaOrden: number
  campo: string
  valor: string
  destinoOrden: number
}

/**
 * La primera rama condicional que casa con una respuesta EXPLÍCITA. A diferencia de
 * `destinoDeRouting`, nunca cae al `default`: sin respuesta, no hay rama.
 */
export function ramaExplicita(etapa: EtapaRetorno, valores: Record<string, unknown>): RamaTomada | null {
  for (const regla of routingDeEtapa(etapa)?.conditional ?? []) {
    const campo = regla?.condition?.field
    if (typeof campo !== 'string') continue
    const v = valores[campo]
    if (!esRespuesta(v)) continue
    if (String(v) === String(regla.condition.value)) {
      return { etapaOrden: etapa.orden, campo, valor: String(v), destinoOrden: regla.etapa_orden }
    }
  }
  return null
}

export interface ValoresDecision {
  /** Respuestas registradas, del bolsillo que usa el motor para avanzar. */
  respuestas: Record<string, unknown>
  /** Respuestas que el flujo habría sembrado, solo para campos sin respuesta. */
  derivados?: Record<string, unknown>
}

export type MotivoRetorno =
  | 'sin_bifurcacion'
  | 'aplica'
  | 'no_aplica'
  | 'aplica_derivado'
  | 'no_aplica_derivado'
  | 'sin_respuesta'

export interface RetornoResuelto {
  orden: number
  motivo: MotivoRetorno
  rama: RamaTomada | null
}

export function resolverRetornoReproceso(input: {
  etapas: readonly EtapaRetorno[]
  destinoOrden: number
  /** Por `orden` de cada decisión (no de su etapa fuente). */
  valores: Record<number, ValoresDecision>
}): RetornoResuelto {
  const { etapas, destinoOrden, valores } = input
  const decisiones = decisionesHaciaDestino(etapas, destinoOrden)
  if (decisiones.length === 0) return { orden: destinoOrden, motivo: 'sin_bifurcacion', rama: null }

  const existe = (orden: number) => etapas.some((e) => e.orden === orden)

  const elegir = (
    fuente: 'respuestas' | 'derivados',
    siAplica: MotivoRetorno,
    siNoAplica: MotivoRetorno,
  ): RetornoResuelto | null => {
    const ramas = decisiones
      .map((d) => ramaExplicita(d, valores[d.orden]?.[fuente] ?? {}))
      .filter((r): r is RamaTomada => r !== null)
    const haciaD = ramas.find((r) => r.destinoOrden === destinoOrden)
    if (haciaD) return { orden: destinoOrden, motivo: siAplica, rama: haciaD }
    // `decisiones` viene de la más cercana a D a la más lejana: gana la última que se tomó.
    const otra = ramas.find((r) => existe(r.destinoOrden))
    if (otra) return { orden: otra.destinoOrden, motivo: siNoAplica, rama: otra }
    return null
  }

  return (
    elegir('respuestas', 'aplica', 'no_aplica') ??
    elegir('derivados', 'aplica_derivado', 'no_aplica_derivado') ??
    { orden: destinoOrden, motivo: 'sin_respuesta', rama: null }
  )
}

/** La config que declara cómo el flujo siembra "¿requiere cita?" desde la seccional. */
interface CitaDianConfirmacion {
  enabled?: boolean
  requiere_field?: string
}

/**
 * La respuesta que el propio flujo habría sembrado para un campo de decisión sin
 * respuesta, cuando un bloque de la etapa fuente la declara con `cita_dian_confirmacion`.
 *
 * Es la misma derivación del auto-init de `getNegocioDetalle`: el flag `cita` del catálogo
 * de seccionales. No se reimplementa la regla: `requiereCita` entra por parámetro y quien
 * llama pasa `requiereCitaDian`. Devuelve solo los campos que se pudieron derivar.
 *
 * Existe porque la respuesta registrada falta en la mayoría de los casos migrados: medido
 * el 2026-09-14, de 286 negocios abiertos de SOENA entre Cita y Seguimiento, 182 no tienen
 * una respuesta aplicable. V0374 es uno de ellos.
 */
export function derivarRespuestaDeCita(input: {
  camposSinRespuesta: readonly string[]
  configsEtapaFuente: ReadonlyArray<Record<string, unknown> | null>
  seccional: string | null
  requiereCita: (seccional: string) => boolean | null
}): Record<string, string> {
  const { camposSinRespuesta, configsEtapaFuente, seccional, requiereCita } = input
  const out: Record<string, string> = {}
  if (!seccional || !seccional.trim()) return out
  for (const campo of camposSinRespuesta) {
    const declara = configsEtapaFuente.some((cfg) => {
      if (!cfg || cfg.desactivado === true) return false
      const c = cfg.cita_dian_confirmacion as CitaDianConfirmacion | undefined
      return c?.enabled === true && (c.requiere_field ?? 'requiere_cita_dian') === campo
    })
    if (!declara) continue
    const r = requiereCita(seccional)
    if (r !== null) out[campo] = r ? 'true' : 'false'
  }
  return out
}
