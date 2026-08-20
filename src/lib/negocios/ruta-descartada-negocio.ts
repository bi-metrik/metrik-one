import 'server-only'

/**
 * Etapas que no aplican — la parte que habla con la base.
 *
 * Las REGLAS viven en `ruta-descartada.ts` (módulo puro, con pruebas). Aquí solo se
 * resuelven contra un negocio concreto y se traducen a lo que la pantalla puede leer:
 * números de etapa y la respuesta que las dejó fuera, en las palabras que el equipo usó al
 * responderla ("Solo devolución de IVA", no `solo_iva`).
 *
 * ── El portero es estructural ─────────────────────────────────────────────────────────
 * Si la línea no tiene una sola bifurcación, esto sale antes de tocar ninguna otra tabla:
 * sin ramas no hay nada que descartar. Por eso no hay flag de configuración que encender —
 * a diferencia de la reversa de ruta, que sí lo exige porque propone MOVER casos.
 */

import { aplicaSaltoPorSaldo } from './salto-etapa'
import { etapasDescartadas } from './ruta-descartada'
import type { EtapaRuta, ValoresPorOrden } from './reversa-ruta'
import type { RoutingEtapa } from './dato-de-decision'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

/** Una etapa que este caso no va a recorrer, lista para pintar. */
export interface EtapaNoAplica {
  etapaId: string
  /** Número VISIBLE. Es el que ve el equipo; el `orden` interno no se expone. */
  numero: number
  nombre: string
  /** La etapa donde se tomó la decisión, en número visible y nombre. */
  decisionNumero: number
  decisionNombre: string
  /** La pregunta que decidió, en las palabras de la pantalla. */
  campoLabel: string
  /** La respuesta que se dio, con su etiqueta si el campo la tiene. */
  valorLabel: string
}

/** Fila cruda de `etapas_negocio` tal como la trae `getNegocioDetalle`. */
export interface EtapaRaw {
  id: string
  nombre: string
  orden: number
  numero: number
  stage: string | null
  config_extra: Record<string, unknown> | null
}

type CampoConfig = {
  slug?: unknown
  label?: unknown
  opciones?: Array<{ value?: unknown; label?: unknown }> | null
}

/** ¿Alguna etapa de la línea bifurca? Sin esto no se lee una sola tabla más. */
function hayBifurcaciones(etapas: readonly EtapaRaw[]): boolean {
  return etapas.some(e => {
    const routing = (e.config_extra?.routing ?? null) as RoutingEtapa | null
    return (routing?.conditional ?? []).length > 0
  })
}

/**
 * Las etapas que este caso no va a recorrer nunca, con el porqué en palabras.
 *
 * Devuelve una lista vacía —nunca lanza— ante cualquier ausencia de datos: esto adorna la
 * pantalla del negocio, y no hay dato que valga romperle la pantalla a nadie.
 */
export async function resolverEtapasNoAplican(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioId: string,
  etapasRaw: readonly EtapaRaw[],
  etapaActualId: string | null,
): Promise<EtapaNoAplica[]> {
  if (!etapaActualId || etapasRaw.length === 0) return []
  if (!hayBifurcaciones(etapasRaw)) return []

  const etapaActual = etapasRaw.find(e => e.id === etapaActualId)
  if (!etapaActual) return []

  const etapaIds = etapasRaw.map(e => e.id)
  const ordenPorEtapaId = new Map(etapasRaw.map(e => [e.id, e.orden]))

  // ── Qué etapas tienen casillas, y cómo se leen sus campos ───────────────
  // La misma consulta sirve para las dos cosas: una etapa sin casillas no puede probar que
  // fue recorrida (ver `EtapaRuta.tieneCasillas`), y las opciones de cada campo son lo que
  // convierte `solo_iva` en "Solo devolución de IVA".
  const { data: configsRaw } = await db(supabase)
    .from('bloque_configs')
    .select('etapa_id, config_extra')
    .in('etapa_id', etapaIds)

  const conCasillas = new Set<string>()
  /** (orden de etapa)::(slug de campo) → { label, opciones } */
  const camposPorEtapa = new Map<string, { label: string; opciones: Map<string, string> }>()

  for (const c of ((configsRaw ?? []) as Array<{ etapa_id: string; config_extra: Record<string, unknown> | null }>)) {
    if (c.config_extra?.desactivado === true) continue
    conCasillas.add(c.etapa_id)

    const orden = ordenPorEtapaId.get(c.etapa_id)
    if (orden === undefined) continue
    for (const campo of ((c.config_extra?.fields ?? []) as CampoConfig[])) {
      const slug = typeof campo?.slug === 'string' ? campo.slug : null
      if (!slug) continue
      const opciones = new Map<string, string>()
      for (const op of (campo.opciones ?? [])) {
        if (typeof op?.value === 'string' && typeof op?.label === 'string') opciones.set(op.value, op.label)
      }
      camposPorEtapa.set(`${orden}::${slug}`, {
        label: typeof campo.label === 'string' ? campo.label : slug,
        opciones,
      })
    }
  }

  const etapas: EtapaRuta[] = etapasRaw.map(e => ({
    id: e.id,
    nombre: e.nombre,
    orden: e.orden,
    numero: e.numero,
    routing: (e.config_extra?.routing ?? null) as RoutingEtapa | null,
    tieneCasillas: conCasillas.has(e.id),
    // La MISMA función que decide el salto en el motor de avance: si aquí se copiara el
    // criterio, la pantalla llamaría "no aplica" a una etapa que el motor salta por saldo.
    puedeSaltarsePorSaldo: aplicaSaltoPorSaldo({
      stage: e.stage,
      config_extra: (e.config_extra ?? null) as { saltar_si_saldo_cero?: unknown } | null,
    }),
  }))

  // ── Los hechos del caso: por dónde pasó y qué respondió ─────────────────
  // Idéntico a lo que hace la reversa de ruta, y a propósito: si las dos superficies
  // leyeran los hechos distinto, una diría "no aplica" mientras la otra propone devolver
  // el caso a esa misma etapa.
  const { data: instRaw } = await db(supabase)
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(etapa_id, bloque_definitions!inner(tipo))')
    .eq('negocio_id', negocioId)

  const recorridas = new Set<number>()
  const valores: ValoresPorOrden = {}
  for (const inst of ((instRaw ?? []) as Array<Record<string, unknown>>)) {
    const cfg = inst.bloque_configs as Record<string, unknown> | null
    const orden = ordenPorEtapaId.get((cfg?.etapa_id as string) ?? '')
    if (orden === undefined) continue
    recorridas.add(orden)
    // El motor arma su bolsillo SOLO con los bloques `datos` de la etapa fuente.
    if ((cfg?.bloque_definitions as { tipo?: string } | null)?.tipo !== 'datos') continue
    const data = inst.data as Record<string, unknown> | null
    if (!data || typeof data !== 'object') continue
    valores[orden] = { ...(valores[orden] ?? {}), ...data }
  }

  const descartadas = etapasDescartadas({
    etapas,
    valores,
    recorridas,
    etapaActualOrden: etapaActual.orden,
  })
  if (descartadas.length === 0) return []

  const porOrden = new Map(etapas.map(e => [e.orden, e]))

  return descartadas.flatMap(d => {
    const etapa = porOrden.get(d.orden)
    const decision = porOrden.get(d.motivo.decisionOrden)
    if (!etapa || !decision) return []

    // El campo se lee de la etapa FUENTE, que casi nunca es la que bifurca: en SOENA la
    // pregunta vive en Negociación y la bifurcación ocurre en Documentación.
    const routing = decision.routing
    const fuente = typeof routing?.source_etapa_orden === 'number' ? routing.source_etapa_orden : decision.orden
    const campo = camposPorEtapa.get(`${fuente}::${d.motivo.campo}`)

    return [{
      etapaId: etapa.id,
      numero: etapa.numero,
      nombre: etapa.nombre,
      decisionNumero: decision.numero,
      decisionNombre: decision.nombre,
      campoLabel: campo?.label ?? d.motivo.campo,
      valorLabel: campo?.opciones.get(d.motivo.valor) ?? d.motivo.valor,
    }]
  })
}
