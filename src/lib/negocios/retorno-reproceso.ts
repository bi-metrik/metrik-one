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
 * ⚠️ El "antes de D" se mide con `orden`, igual que el resto de `reproceso-actions.ts`,
 * aunque `orden` no ordena el recorrido (ver el aviso en ese archivo). Mezclar dos
 * vocabularios en la misma operación la haría decir cosas distintas en dos pasos.
 *
 * Puro: no toca base ni red.
 */

import { esRespuesta, type RoutingEtapa } from './dato-de-decision'

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

/** Las etapas anteriores a D que tienen alguna rama condicional hacia D. */
export function decisionesHaciaDestino(etapas: readonly EtapaRetorno[], destinoOrden: number): EtapaRetorno[] {
  return etapas
    .filter((e) => e.orden < destinoOrden)
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
