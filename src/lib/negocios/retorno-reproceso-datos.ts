/**
 * Lee de la base lo que `resolverRetornoReproceso` necesita para UN negocio.
 *
 * Una lectura del bolsillo del motor por cada decisión que puede mandar el caso a la
 * etapa declarada (en SOENA, dos: Cartera y Entrega), y la config de la etapa fuente
 * solo cuando falta la respuesta. Las reglas viven en `retorno-reproceso.ts`.
 */

import { requiereCitaDian } from '@/lib/dian/seccionales'
import { camposDeRoutingDelNegocio } from './campos-de-routing-del-negocio'
import { esRespuesta } from './dato-de-decision'
import {
  camposDeLaDecision,
  decisionesHaciaDestino,
  derivarRespuestaDeCita,
  resolverRetornoReproceso,
  routingDeEtapa,
  type EtapaRetorno,
  type RetornoResuelto,
  type ValoresDecision,
} from './retorno-reproceso'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

export async function resolverRetornoDelNegocio(
  supabase: unknown,
  params: {
    negocioId: string
    lineaId: string
    etapas: readonly EtapaRetorno[]
    destinoOrden: number
    /** `negocios.metadata.seccional`: la canónica, la misma de la casilla 12 del 010. */
    seccional: string | null
  },
): Promise<RetornoResuelto> {
  const { negocioId, lineaId, etapas, destinoOrden, seccional } = params
  const valores: Record<number, ValoresDecision> = {}

  for (const decision of decisionesHaciaDestino(etapas, destinoOrden)) {
    const routing = routingDeEtapa(decision)
    const fuenteOrden = typeof routing?.source_etapa_orden === 'number' ? routing.source_etapa_orden : decision.orden
    const fuente = etapas.find((e) => e.orden === fuenteOrden)
    if (!fuente) continue

    const respuestas = await camposDeRoutingDelNegocio(supabase, negocioId, lineaId, fuente.id)
    const sinRespuesta = camposDeLaDecision(decision, destinoOrden).filter((c) => !esRespuesta(respuestas[c]))

    let derivados: Record<string, unknown> = {}
    if (sinRespuesta.length > 0 && seccional) {
      const { data } = await db(supabase)
        .from('bloque_configs')
        .select('config_extra')
        .eq('etapa_id', fuente.id)
      derivados = derivarRespuestaDeCita({
        camposSinRespuesta: sinRespuesta,
        configsEtapaFuente: ((data ?? []) as Array<{ config_extra: Record<string, unknown> | null }>).map(
          (r) => r.config_extra,
        ),
        seccional,
        requiereCita: (s) => requiereCitaDian(s).requiere_cita,
      })
    }

    valores[decision.orden] = { respuestas, derivados }
  }

  return resolverRetornoReproceso({ etapas, destinoOrden, valores })
}
